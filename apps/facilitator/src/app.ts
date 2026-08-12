/**
 * The payment plane.
 *
 * Deliberately thin. Verification and settlement belong to `@x402/stellar`
 * (Apache-2.0) as RFP §3.1 requires — this file wires that scheme into the
 * standard `verify` / `settle` / `supported` surface and nothing more. The
 * value we add lives in the discovery plane, which attaches through the
 * facilitator's own `onAfterSettle` hook rather than by forking anything.
 *
 * Not derived from the OpenZeppelin Relayer x402 plugin, which is
 * AGPL-3.0-or-later and is excluded by RFP §3.6 and its Appendix.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { createEd25519Signer } from "@x402/stellar";
import Fastify, { type FastifyInstance } from "fastify";
import type { FacilitatorConfig } from "./config.js";

/** Body shared by `/verify` and `/settle`. */
interface FacilitatorRequestBody {
  paymentPayload?: PaymentPayload;
  paymentRequirements?: PaymentRequirements;
}

export interface BuiltFacilitator {
  app: FastifyInstance;
  facilitator: x402Facilitator;
  /** Addresses of the fee-sponsoring signers, for the health endpoint. */
  signerAddresses: string[];
}

/**
 * Wire the Stellar exact scheme into a facilitator and expose it over HTTP.
 *
 * Multiple signers are passed straight through to `ExactStellarScheme`, which
 * round-robins between them. That is the answer to RFP §3.5's throughput
 * question: distinct source accounts mean bursty agent traffic does not
 * serialise behind one account's sequence number.
 */
export function buildFacilitator(config: FacilitatorConfig): BuiltFacilitator {
  const signers = config.signerSecrets.map((secret) =>
    createEd25519Signer(secret, config.network),
  );

  const scheme = new ExactStellarScheme(signers, {
    rpcConfig: { url: config.rpcUrl },
    areFeesSponsored: config.areFeesSponsored,
  });

  const facilitator = new x402Facilitator().register(config.network, scheme);

  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });

  app.get("/health", async () => ({
    status: "ok",
    network: config.network,
    rpcUrl: config.rpcUrl,
    signers: signers.length,
  }));

  /**
   * RFP §3.6 makes this endpoint an acceptance criterion: it must emit the
   * Stellar `extra` contract including `areFeesSponsored`. `getSupported()`
   * derives that from the scheme's own `getExtra`, so it cannot drift from what
   * settlement actually does.
   */
  app.get("/supported", async () => facilitator.getSupported());

  app.post<{ Body: FacilitatorRequestBody }>("/verify", async (request, reply) => {
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      // Every rejection carries a non-null reason (RFP §3.3, §3.6).
      return reply
        .code(400)
        .send({ isValid: false, invalidReason: "invalid_request_body", payer: null });
    }
    return facilitator.verify(paymentPayload, paymentRequirements);
  });

  app.post<{ Body: FacilitatorRequestBody }>("/settle", async (request, reply) => {
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return reply
        .code(400)
        .send({ success: false, errorReason: "invalid_request_body", transaction: null });
    }
    return facilitator.settle(paymentPayload, paymentRequirements);
  });

  return { app, facilitator, signerAddresses: signers.map((s) => s.address) };
}
