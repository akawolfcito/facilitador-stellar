/**
 * Does the facilitator this seller depends on actually work right now?
 *
 * What this is not: a retry that keeps the seller alive. That already works,
 * and it works upstream. `@x402/fastify` starts `initialize()` when the
 * middleware is registered, swallows the rejection, and retries on the next
 * request to a paid route. A facilitator that is down at boot therefore costs a
 * 500 on the first request and nothing else; when it returns, the following
 * request gets its 402 with no restart. That was measured before this file
 * existed, and it is the reason there is no retry ladder wrapped around
 * `startSeller`. Wrapping one there would have delayed listen() to fix a
 * problem that was not there.
 *
 * What was there: `/health` returned `{"status":"ok"}` the entire time. An
 * operator reading that during an outage learns nothing, and a platform reading
 * it keeps routing traffic at a seller that can only answer 500. So this probe
 * exists to answer readiness honestly, separately from liveness, and to say so
 * out loud in the logs while it waits.
 *
 * It also keeps probing after the first success. Readiness that is latched
 * "true" forever describes the past, and the question an operator is asking is
 * about the present.
 */

/** The ladder, then a hold. Fast enough to catch a restart, slow enough to be free. */
export const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** Where the ladder stops climbing. One probe every thirty seconds, forever. */
export const BACKOFF_CAP_MS = 30_000;

/** How long a single probe may take before it is abandoned. */
export const PROBE_TIMEOUT_MS = 5_000;

/** After this many failures, log once a minute instead of once an attempt. */
const VERBOSE_ATTEMPTS = 5;
const QUIET_LOG_INTERVAL_MS = 60_000;

export function backoffFor(attempt: number): number {
  return BACKOFF_STEPS_MS[attempt - 1] ?? BACKOFF_CAP_MS;
}

export interface FacilitatorReadiness {
  /** The facilitator answered and advertises the network and scheme we sell in. */
  ready: boolean;
  /** Probes made since the last state change. Reset when readiness flips. */
  attempts: number;
  /** Why the last probe did not succeed. Absent while ready. */
  lastError?: string;
  /** When readiness was last achieved. Absent while not ready. */
  readySince?: string;
}

export interface Cancellable {
  cancel(): void;
}

export interface BootstrapDeps {
  fetch?: typeof fetch;
  now?: () => number;
  log?: (record: Record<string, unknown>) => void;
  schedule?: (fn: () => void, ms: number) => Cancellable;
  /**
   * Called once each time readiness is regained.
   *
   * The seller uses it to spend the one wasted request that `@x402/fastify`
   * costs on recovery, so a visitor does not. Failures here are logged and
   * otherwise ignored: a warm-up that does not work leaves exactly the
   * behaviour that existed before it.
   */
  onReady?: () => void | Promise<void>;
}

export interface FacilitatorProbe {
  readiness(): FacilitatorReadiness;
  stop(): void;
}

interface ProbeConfig {
  facilitatorUrl: string;
  network: string;
}

function defaultSchedule(fn: () => void, ms: number): Cancellable {
  const handle = setTimeout(fn, ms);
  // The loop must never be the reason a process refuses to exit.
  handle.unref?.();
  return { cancel: () => clearTimeout(handle) };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Poll the facilitator's capability endpoint until it can serve what we sell,
 * and keep checking afterwards.
 *
 * `stop()` cancels the pending timer and aborts a probe still in flight, so a
 * SIGTERM does not wait out a five second fetch.
 */
export function startFacilitatorBootstrap(
  config: ProbeConfig,
  deps: BootstrapDeps = {},
): FacilitatorProbe {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((record) => console.log(JSON.stringify(record)));
  const schedule = deps.schedule ?? defaultSchedule;

  const url = `${config.facilitatorUrl.replace(/\/$/, "")}/supported`;
  const state: FacilitatorReadiness = { ready: false, attempts: 0 };

  let stopped = false;
  let timer: Cancellable | undefined;
  let inFlight: AbortController | undefined;
  let lastQuietLogAt = 0;

  /** Log every early attempt, then thin out. An outage should not bury the log. */
  function report(record: Record<string, unknown>): void {
    if (state.attempts <= VERBOSE_ATTEMPTS) {
      log(record);
      lastQuietLogAt = now();
      return;
    }
    if (now() - lastQuietLogAt >= QUIET_LOG_INTERVAL_MS) {
      log({ ...record, throttled: true });
      lastQuietLogAt = now();
    }
  }

  async function askFacilitator(): Promise<void> {
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await doFetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`facilitator /supported returned ${response.status}`);

      const body = (await response.json()) as { kinds?: { network?: string; scheme?: string }[] };
      const serves = (body.kinds ?? []).some(
        (kind) => kind.network === config.network && kind.scheme === "exact",
      );
      if (!serves) {
        throw new Error(
          `facilitator does not advertise ${config.network} exact; it cannot settle this resource`,
        );
      }
    } finally {
      clearTimeout(timeout);
      inFlight = undefined;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = schedule(() => void probe(), backoffFor(state.attempts));
  }

  async function probe(): Promise<void> {
    if (stopped) return;
    const wasReady = state.ready;
    state.attempts += 1;

    try {
      await askFacilitator();
      if (stopped) return;

      if (!wasReady) {
        state.ready = true;
        state.readySince = new Date(now()).toISOString();
        delete state.lastError;
        state.attempts = 0;
        log({
          event: "facilitator_ready",
          url,
          network: config.network,
          readySince: state.readySince,
        });
        void Promise.resolve()
          .then(() => deps.onReady?.())
          .catch((cause) => log({ event: "facilitator_ready_hook_failed", error: describe(cause) }));
      }
    } catch (error) {
      if (stopped) return;
      state.lastError = describe(error);

      if (wasReady) {
        // Drop back to the bottom of the ladder: a facilitator that just
        // disappeared is the case where checking again soon is worth most.
        state.ready = false;
        delete state.readySince;
        state.attempts = 1;
        log({ event: "facilitator_lost", url, error: state.lastError });
      } else {
        report({
          event: "facilitator_probe_failed",
          url,
          attempts: state.attempts,
          error: state.lastError,
          retryInMs: backoffFor(state.attempts),
        });
      }
    }

    scheduleNext();
  }

  void probe();

  return {
    readiness: () => ({ ...state }),
    stop() {
      stopped = true;
      timer?.cancel();
      timer = undefined;
      inFlight?.abort();
    },
  };
}
