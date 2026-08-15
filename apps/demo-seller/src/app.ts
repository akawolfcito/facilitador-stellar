/**
 * One paid HTTP resource, for demonstrating the payment loop end to end.
 *
 * Everything protocol-facing is stock upstream — `paymentMiddleware` from
 * `@x402/fastify`, `declareDiscoveryExtension` from `@x402/extensions/bazaar`,
 * `ExactStellarScheme` from `@x402/stellar/exact/server` — wired the same way
 * `apps/e2e-stellar/src/catalog-seller.ts` wires it. Nothing about x402 seller
 * behaviour is reimplemented here; what is new is only that it can be operated
 * as a service instead of started by a test harness.
 *
 * One resource, on purpose. The point is proof of the loop, not catalog
 * breadth — the facilitator's catalog already has breadth, and it gets it the
 * only way it can: by being paid for.
 */

import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/fastify";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type BootstrapDeps,
  type FacilitatorProbe,
  type FacilitatorReadiness,
  startFacilitatorBootstrap,
} from "./bootstrap.js";
import type { SellerConfig } from "./config.js";

/** Path of the single paid resource. */
export const RESOURCE_PATH = "/summarize";

/** Longest input accepted, so a request cannot be made arbitrarily expensive. */
export const MAX_TEXT_LENGTH = 4_000;

/**
 * Condense text to its opening words and a count.
 *
 * Deliberately trivial and deterministic: the same input always produces the
 * same output, there is no model, no network call and no state. A demo resource
 * should be honest about what it does — this one does exactly what it says,
 * which a canned "weather forecast" returning a fixed temperature would not.
 *
 * Same function as the MCP tool in `apps/e2e-stellar/src/mcp-tool-server.ts`,
 * kept here rather than imported so a public service does not depend on a test
 * harness workspace.
 */
export function summarize(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, 8).join(" ");
  return `${head}${words.length > 8 ? "…" : ""} (${words.length} words)`;
}

/**
 * Typed explicitly: `DeclareDiscoveryExtensionInput` is a union, and inference
 * picks the MCP branch for a bare literal — which has no `method`.
 */
const DISCOVERY: DeclareQueryDiscoveryExtensionConfig = {
  method: "GET",
  input: { text: "the quick brown fox jumped over the lazy dog" },
  inputSchema: {
    properties: {
      text: {
        type: "string",
        description: `Text to summarize, up to ${MAX_TEXT_LENGTH} characters`,
      },
    },
    required: ["text"],
  },
  output: { example: { summary: "the quick brown fox jumped over the lazy… (9 words)" } },
};

/**
 * Readiness the seller can report before anything has probed the facilitator.
 *
 * `buildSeller` is used directly by tests that never start a probe, so the
 * default is "not ready, and it has not looked yet", which is the truth.
 */
const UNPROBED: FacilitatorReadiness = { ready: false, attempts: 0 };

export function buildSeller(
  config: SellerConfig,
  readiness: () => FacilitatorReadiness = () => UNPROBED,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    // A summarisation request is a query string; nothing here needs a large
    // body, and a bounded one is one less thing to reason about.
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
    keepAliveTimeout: 30_000,
  });

  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  );
  server.register(config.network, new ExactStellarScheme());

  /**
   * The advertised resource URL is configured, not derived from the request.
   *
   * Behind a proxy the derived value would be the internal origin, and the
   * facilitator keys its catalog — and binds ownership — on exactly this
   * string. Getting it from configuration is what makes a hosted listing point
   * at somewhere a reviewer can actually reach.
   */
  const resourceUrl = `${config.publicBaseUrl}${RESOURCE_PATH}`;

  paymentMiddleware(
    app,
    {
      [`GET ${RESOURCE_PATH}`]: {
        accepts: {
          payTo: config.payTo,
          scheme: "exact",
          network: config.network,
          price: { asset: config.asset, amount: config.amount },
        },
        resource: resourceUrl,
        serviceName: "Text Summarizer",
        description:
          "Condense a passage of text into one short line: its opening words and a word count. " +
          "Deterministic — the same text always returns the same summary.",
        tags: ["summarization", "text", "nlp"],
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(DISCOVERY),
      },
    } as never,
    server,
  );

  app.get(RESOURCE_PATH, async (request, reply) => {
    const { text } = request.query as { text?: string };
    if (typeof text !== "string" || text.trim() === "") {
      return reply.code(400).send({ error: "text is required" });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return reply
        .code(400)
        .send({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` });
    }
    return { summary: summarize(text) };
  });

  /**
   * Liveness. Unpaid on purpose: a health check must not need a wallet.
   *
   * This stays 200 for as long as the process serves requests, including while
   * the facilitator is unreachable, because the process is not what is broken
   * then. It carries `ready` so a human reading it during an outage learns the
   * thing the old `{"status":"ok"}` hid.
   */
  app.get("/health", async () => {
    const state = readiness();
    return {
      status: "ok",
      ready: state.ready,
      service: "x402seek-demo-seller",
      network: config.network,
      resource: resourceUrl,
      price: { asset: config.asset, amount: config.amount },
      facilitator: state.ready
        ? { status: "ready", since: state.readySince }
        : { status: "unavailable", attempts: state.attempts, error: state.lastError },
    };
  });

  /**
   * Readiness. 503 until the facilitator has been shown to serve our network
   * and scheme, because until then this seller cannot issue a payable 402.
   *
   * Deliberately not wired to the paid route. `@x402/fastify` retries its own
   * facilitator initialisation on the next request, and a gate here would
   * intercept the request that triggers that retry, replacing a self-healing
   * path with one that waits for this probe instead.
   */
  app.get("/ready", async (_request, reply) => {
    const state = readiness();
    if (state.ready) return { ready: true, since: state.readySince };
    return reply.code(503).send({
      ready: false,
      error: "FACILITATOR_UNAVAILABLE",
      attempts: state.attempts,
      detail: state.lastError,
    });
  });

  return app;
}

/**
 * Absorb the one request that recovery costs.
 *
 * `@x402/fastify` holds the promise from its first `initialize()`. When that
 * one rejected, the next request to a paid route awaits the same rejected
 * promise, answers 500, and only then clears it; the request after that
 * succeeds. Measured, not assumed. So on regaining readiness the seller makes
 * that request against itself, through the full hook chain, and throws the
 * answer away.
 *
 * `inject` opens no socket and sends no payment header, so this is a 402 the
 * seller asks itself for. Bounded at three tries: if it is not serving 402 by
 * then, waiting longer will not change that.
 */
export async function warmUpPaidRoute(
  app: FastifyInstance,
  log: (record: Record<string, unknown>) => void = (r) => console.log(JSON.stringify(r)),
): Promise<number | undefined> {
  let status: number | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await app.inject({ method: "GET", url: RESOURCE_PATH });
    status = response.statusCode;
    if (status === 402) break;
  }
  log({ event: "paid_route_warm", status });
  return status;
}

export interface StartedSeller {
  app: FastifyInstance;
  address: string;
  readiness(): FacilitatorReadiness;
  stop(): Promise<void>;
}

/**
 * Listen first, probe alongside.
 *
 * The probe is never awaited before `listen`. A seller that waits for its
 * facilitator before opening a port is a seller that cannot answer `/health`
 * during the outage it is waiting on, which is exactly when someone wants to
 * ask it something.
 */
export async function startSeller(
  config: SellerConfig,
  deps: BootstrapDeps = {},
): Promise<StartedSeller> {
  // `app` is referenced by the readiness hook below, which cannot run before
  // the probe's first result, which cannot happen before this returns.
  let app: FastifyInstance;
  const probe: FacilitatorProbe = startFacilitatorBootstrap(
    { facilitatorUrl: config.facilitatorUrl, network: config.network },
    { ...deps, onReady: deps.onReady ?? (async () => void (await warmUpPaidRoute(app))) },
  );
  app = buildSeller(config, probe.readiness);

  try {
    const address = await app.listen({ port: config.port, host: "0.0.0.0" });
    return {
      app,
      address,
      readiness: probe.readiness,
      stop: async () => {
        probe.stop();
        await app.close();
      },
    };
  } catch (error) {
    // A port that will not bind is fatal, but it must not leave a retry loop
    // running behind the thrown error.
    probe.stop();
    throw error;
  }
}
