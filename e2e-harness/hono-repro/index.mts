/**
 * Controlled reproducer for the Hono + fetch empty-body failure.
 *
 * Observed in the upstream e2e suite: running *only* hono with *only* the fetch
 * client, 8 of 13 runs failed with `SyntaxError: Unexpected end of JSON input`.
 * The upstream harness restarts a whole process per run, which makes it slow and
 * tells us nothing about the response itself. This drives the same stock
 * middleware in-process and records what actually came back on the wire.
 *
 * Everything under test is stock: `paymentMiddleware` from `@x402/hono`,
 * `@x402/express` and `@x402/fastify` as controls, `wrapFetchWithPayment` from
 * `@x402/fetch` as the buyer. Only the measurement is ours.
 *
 * Variables, changed one at a time:
 *
 *   framework   hono | express | fastify        (control: is it hono-specific?)
 *   warmup      none | unpaid-first             (control: is it cold start?)
 *   client      fetch                           (the reported failing client)
 *
 * Usage: pnpm --filter @stellar-bazaar/hono-repro repro [iterations]
 */

import { serve, type ServerType } from "@hono/node-server";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { wrapFetchWithPayment } from "@x402/fetch";
import { paymentMiddleware as honoPaymentMiddleware } from "@x402/hono";
import { paymentMiddleware as expressPaymentMiddleware } from "@x402/express";
import { paymentMiddleware as fastifyPaymentMiddleware } from "@x402/fastify";
import { USDC_TESTNET_ADDRESS, createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ExactStellarClient } from "@x402/stellar/exact/client";
import { ExactStellarScheme as ExactStellarServer } from "@x402/stellar/exact/server";
import { buildFacilitator } from "@stellar-bazaar/facilitator/app";
import { loadConfig } from "@stellar-bazaar/facilitator/config";
import { Hono } from "hono";
import express from "express";
import Fastify from "fastify";

const NETWORK = "stellar:testnet" as const;
const FACILITATOR_PORT = 4520;
const SERVER_PORT = 4521;
const PAID_PATH = "/paid";
const BODY = { message: "Protected endpoint accessed successfully" };

type Framework = "hono" | "express" | "fastify" | "hono-upstream-shape";
type Warmup = "none" | "unpaid-first";

function loadEnvFile(): Record<string, string> {
  const raw = readFileSync(new URL("../../apps/e2e-stellar/.env.e2e", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const env = loadEnvFile();
const facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}`;

interface Stoppable {
  close(): Promise<void>;
}

/** Route config shared by all three frameworks, so only the adapter differs. */
function routes(): Record<string, unknown> {
  return {
    [`GET ${PAID_PATH}`]: {
      accepts: {
        payTo: env.E2E_SELLER_ADDRESS!,
        scheme: "exact",
        network: NETWORK,
        // Canonical testnet USDC, the same asset the upstream suite prices in.
        price: { asset: USDC_TESTNET_ADDRESS, amount: "10000" },
      },
      serviceName: "Repro",
      description: "Reproducer endpoint",
    },
  };
}

function resourceServer(): x402ResourceServer {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }));
  server.register(NETWORK, new ExactStellarServer());
  return server;
}

async function startHono(): Promise<Stoppable> {
  const app = new Hono();
  // hono and express return a middleware handler; fastify registers on the app.
  app.use(honoPaymentMiddleware(routes() as never, resourceServer()));
  app.get(PAID_PATH, (c) => c.json(BODY));
  const server: ServerType = serve({ fetch: app.fetch, port: SERVER_PORT });
  await new Promise((r) => setTimeout(r, 150));
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function startExpress(): Promise<Stoppable> {
  const app = express();
  app.use(expressPaymentMiddleware(routes() as never, resourceServer()));
  app.get(PAID_PATH, (_req, res) => void res.json(BODY));
  const server = app.listen(SERVER_PORT);
  await new Promise((r) => setTimeout(r, 150));
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function startFastify(): Promise<Stoppable> {
  const app = Fastify({ logger: false });
  fastifyPaymentMiddleware(app, routes() as never, resourceServer());
  app.get(PAID_PATH, async () => BODY);
  await app.listen({ port: SERVER_PORT, host: "127.0.0.1" });
  return { close: () => app.close() };
}

/**
 * Byte-for-byte the upstream e2e server's shape: middleware mounted with
 * `app.use("*", ...)` and, critically, **no settling delay before the first
 * request**. `paymentMiddleware` defaults `syncFacilitatorOnStart` to true, so
 * it kicks off a `/supported` call to the facilitator at construction — and
 * that sync is not part of anything the harness waits on.
 */
async function startHonoUpstreamShape(): Promise<Stoppable> {
  const app = new Hono();
  app.use("*", honoPaymentMiddleware(routes() as never, resourceServer()));
  app.get(PAID_PATH, (c) => c.json(BODY));
  const server: ServerType = serve({ fetch: app.fetch, port: SERVER_PORT });
  // No delay: fire as soon as the listener exists, exactly as the harness does
  // once its readiness probe returns.
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}

const STARTERS: Record<Framework, () => Promise<Stoppable>> = {
  hono: startHono,
  express: startExpress,
  fastify: startFastify,
  "hono-upstream-shape": startHonoUpstreamShape,
};

interface Observation {
  framework: Framework;
  warmup: Warmup;
  iteration: number;
  ok: boolean;
  status: number | null;
  contentLength: string | null;
  transferEncoding: string | null;
  connection: string | null;
  bodyBytes: number | null;
  bodyPreview: string;
  paymentResponsePresent: boolean;
  settlementSuccess: boolean | null;
  transaction: string | null;
  parseError: string | null;
  msFromServerStart: number;
  msRequest: number;
}

/**
 * One cold-started server, one paid request, everything about the response
 * recorded before anything tries to parse it.
 */
async function observe(
  framework: Framework,
  warmup: Warmup,
  iteration: number,
): Promise<Observation> {
  const startedAt = performance.now();
  const server = await STARTERS[framework]();
  const url = `http://127.0.0.1:${SERVER_PORT}${PAID_PATH}`;

  const base: Observation = {
    framework,
    warmup,
    iteration,
    ok: false,
    status: null,
    contentLength: null,
    transferEncoding: null,
    connection: null,
    bodyBytes: null,
    bodyPreview: "",
    paymentResponsePresent: false,
    settlementSuccess: null,
    transaction: null,
    parseError: null,
    msFromServerStart: 0,
    msRequest: 0,
  };

  try {
    if (warmup === "unpaid-first") {
      // A plain 402, consumed and discarded, before the paid request.
      const warm = await fetch(url);
      await warm.text();
    }

    const buyer = createEd25519Signer(env.E2E_BUYER_SECRET!, NETWORK);
    const client = x402Client.fromConfig({
      schemes: [{ network: NETWORK, client: new ExactStellarClient(buyer) }],
    });
    const fetchWithPay = wrapFetchWithPayment(fetch, client);

    const requestStart = performance.now();
    const response = await fetchWithPay(url, { method: "GET" });
    base.msFromServerStart = requestStart - startedAt;
    base.msRequest = performance.now() - requestStart;

    base.status = response.status;
    base.contentLength = response.headers.get("content-length");
    base.transferEncoding = response.headers.get("transfer-encoding");
    base.connection = response.headers.get("connection");

    const settleHeader =
      response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
    base.paymentResponsePresent = settleHeader !== null;
    if (settleHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8")) as {
          success?: boolean;
          transaction?: string;
        };
        base.settlementSuccess = decoded.success ?? null;
        base.transaction = decoded.transaction ?? null;
      } catch {
        /* header shape is not what this experiment measures */
      }
    }

    // Read bytes first. `response.json()` is what fails upstream, so the byte
    // count is the observation and the parse is a derived detail.
    const bytes = Buffer.from(await response.arrayBuffer());
    base.bodyBytes = bytes.byteLength;
    base.bodyPreview = bytes.subarray(0, 120).toString("utf8");

    try {
      JSON.parse(bytes.toString("utf8"));
      base.ok = bytes.byteLength > 0 && response.status === 200;
    } catch (error) {
      base.parseError = error instanceof Error ? error.message : String(error);
    }
  } catch (error) {
    base.parseError = error instanceof Error ? error.message : String(error);
  } finally {
    await server.close();
    // Let the listener release the port before the next cold start.
    await new Promise((r) => setTimeout(r, 120));
  }

  return base;
}

async function main(): Promise<void> {
  const iterations = Number(process.argv[2] ?? "30");

  const config = loadConfig({
    PORT: String(FACILITATOR_PORT),
    STELLAR_NETWORK: "testnet",
    SIGNER_SECRET_KEYS: env.E2E_FACILITATOR_SECRET,
    STELLAR_RPC_URL: env.STELLAR_RPC_URL,
    CATALOG_PATH: ":memory:",
  });
  const facilitator = buildFacilitator(config);
  await facilitator.app.listen({ port: FACILITATOR_PORT, host: "127.0.0.1" });

  const observations: Observation[] = [];
  const experiments: Array<{ framework: Framework; warmup: Warmup; n: number }> = [
    { framework: "hono-upstream-shape", warmup: "none", n: iterations },
    { framework: "hono-upstream-shape", warmup: "unpaid-first", n: Math.ceil(iterations / 2) },
  ];

  for (const experiment of experiments) {
    console.log(`\n${experiment.framework} / warmup=${experiment.warmup} / ${experiment.n} runs`);
    let failures = 0;
    for (let i = 1; i <= experiment.n; i++) {
      const observation = await observe(experiment.framework, experiment.warmup, i);
      observations.push(observation);
      if (!observation.ok) failures++;
      console.log(
        `  ${String(i).padStart(2)} ${observation.ok ? "PASS" : "FAIL"} ` +
          `status=${observation.status} bytes=${observation.bodyBytes} ` +
          `content-length=${observation.contentLength ?? "-"} ` +
          `te=${observation.transferEncoding ?? "-"} ` +
          `settled=${observation.settlementSuccess ?? "-"} ` +
          `${observation.parseError ? `err=${observation.parseError.slice(0, 60)}` : ""}`,
      );
    }
    console.log(
      `  → ${experiment.n - failures}/${experiment.n} pass, ` +
        `${((failures / experiment.n) * 100).toFixed(1)}% failure`,
    );
  }

  await facilitator.app.close();

  const summary = experiments.map((experiment) => {
    const rows = observations.filter(
      (o) => o.framework === experiment.framework && o.warmup === experiment.warmup,
    );
    const failed = rows.filter((o) => !o.ok);
    return {
      framework: experiment.framework,
      warmup: experiment.warmup,
      runs: rows.length,
      passed: rows.length - failed.length,
      failed: failed.length,
      failureRate: rows.length > 0 ? failed.length / rows.length : 0,
      emptyBodyFailures: failed.filter((o) => o.bodyBytes === 0).length,
      settledDespiteFailure: failed.filter((o) => o.settlementSuccess === true).length,
    };
  });

  const out = new URL("../../artifacts/e2e/hono-fetch-repro.json", import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      { generatedAt: new Date().toISOString(), node: process.version, summary, observations },
      null,
      2,
    )}\n`,
  );

  console.log("\nsummary");
  for (const row of summary) {
    console.log(
      `  ${row.framework.padEnd(8)} warmup=${row.warmup.padEnd(13)} ` +
        `${row.passed}/${row.runs} pass  ${(row.failureRate * 100).toFixed(1)}% fail  ` +
        `empty-body=${row.emptyBodyFailures}  settled-anyway=${row.settledDespiteFailure}`,
    );
  }
  console.log(`\nwrote artifacts/e2e/hono-fetch-repro.json`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
