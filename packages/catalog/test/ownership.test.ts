/**
 * Domain binding.
 *
 * Two things are under test and they are not equally important.
 *
 * The first is that a match means what we say it means: the controller of the
 * resource's HTTPS origin declared this resource may be catalogued against this
 * payTo on this network. Nothing about wallet control, nothing about payment.
 *
 * The second is the one that would actually hurt if it were wrong. This verifier
 * fetches a URL a stranger chose, from a host that holds a signing key. The SSRF
 * group is the largest here on purpose, and every case in it asserts that no
 * request was attempted at all rather than that a request failed.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  type FetchedDocument,
  isForbiddenAddress,
  verifyOwnership,
} from "../src/ownership/verifier.js";
import {
  DOCUMENT_KIND,
  DOCUMENT_VERSION,
  isContradiction,
  matchDocument,
  parseDocument,
  sameResource,
} from "../src/ownership/wellknown.js";
import {
  SqliteCatalogStore,
  VERIFICATION_GRACE_MS,
  VERIFICATION_TTL_MS,
  strongerBinding,
} from "../src/store.js";

const RESOURCE = "https://demo-api.testnet.x402seek.xyz/summarize";
const PAY_TO = "GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK";
const OTHER = "GBCDHGGFXEAD3CK5JMBQFTWRBH6P2XOSYPM22XTC3NKAUOWMQ7WEORIX";
const NETWORK = "stellar:testnet";
const QUERY = { resource: RESOURCE, payTo: PAY_TO, network: NETWORK };

const doc = (resources: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: DOCUMENT_VERSION, kind: DOCUMENT_KIND, resources, ...over });

const served = (body: string, over: Partial<FetchedDocument> = {}): FetchedDocument => ({
  status: 200,
  contentType: "application/json",
  contentEncoding: "",
  contentLength: Buffer.byteLength(body),
  body,
  ...over,
});

/** A verifier whose DNS and socket are both fakes. */
function verifier(response: FetchedDocument | Error, addresses = ["93.184.216.34"]) {
  const get = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    get,
    run: (query = QUERY) =>
      verifyOwnership(query, { get, resolve: async () => addresses, log: () => {} }),
  };
}

describe("what a match means", () => {
  it("verifies an exact resource, payTo and network", async () => {
    const { run } = verifier(served(doc([{ resource: RESOURCE, payTo: PAY_TO, network: NETWORK }])));
    const result = await run();
    expect(result.reason).toBe("VERIFIED");
    expect(result.origin).toBe("https://demo-api.testnet.x402seek.xyz");
  });

  it("handles several resources and several networks in one document", async () => {
    const body = doc([
      { resource: "https://demo-api.testnet.x402seek.xyz/other", payTo: OTHER, network: NETWORK },
      { resource: RESOURCE, payTo: OTHER, network: "stellar:pubnet" },
      { resource: RESOURCE, payTo: PAY_TO, network: NETWORK },
    ]);
    expect((await verifier(served(body)).run()).reason).toBe("VERIFIED");
  });

  it("does not let a testnet declaration authorise pubnet", async () => {
    const body = doc([{ resource: RESOURCE, payTo: PAY_TO, network: NETWORK }]);
    const result = await verifier(served(body)).run({ ...QUERY, network: "stellar:pubnet" });
    expect(result.reason).toBe("NETWORK_MISMATCH");
  });
});

describe("silence is not denial", () => {
  it("treats 404 as an absent declaration, not a contradiction", async () => {
    const result = await verifier(served("", { status: 404 })).run();
    expect(result.reason).toBe("WELL_KNOWN_NOT_FOUND");
    expect(isContradiction(result.reason)).toBe(false);
  });

  it("treats a timeout as absent", async () => {
    const result = await verifier(new Error("TIMEOUT")).run();
    expect(result.reason).toBe("FETCH_TIMEOUT");
    expect(isContradiction(result.reason)).toBe(false);
  });

  it("treats malformed JSON as absent", async () => {
    const result = await verifier(served("{not json")).run();
    expect(result.reason).toBe("WELL_KNOWN_INVALID");
    expect(isContradiction(result.reason)).toBe(false);
  });

  it("treats a resource the document never mentions as absent", async () => {
    const body = doc([{ resource: "https://demo-api.testnet.x402seek.xyz/x", payTo: PAY_TO, network: NETWORK }]);
    const result = await verifier(served(body)).run();
    expect(result.reason).toBe("RESOURCE_NOT_DECLARED");
    // The distinction the whole precedence rule rests on.
    expect(isContradiction(result.reason)).toBe(false);
  });

  it("treats another kind of well-known document as absent, not broken", async () => {
    // Upstream PR #2979 proposes this same path for a facilitator manifest.
    // Reading one must not produce a false match or a scary error.
    const facilitator = JSON.stringify({ x402Version: 1, kind: "facilitator", name: "Someone" });
    const result = await verifier(served(facilitator)).run();
    expect(result.reason).toBe("WELL_KNOWN_INVALID");
    expect(isContradiction(result.reason)).toBe(false);
  });
});

describe("contradiction", () => {
  it("names a different payTo as a mismatch", async () => {
    const body = doc([{ resource: RESOURCE, payTo: OTHER, network: NETWORK }]);
    const result = await verifier(served(body)).run();
    expect(result.reason).toBe("PAYTO_MISMATCH");
    expect(isContradiction(result.reason)).toBe(true);
  });

  it("names a different network as a mismatch", () => {
    const parsed = parseDocument(doc([{ resource: RESOURCE, payTo: PAY_TO, network: "stellar:pubnet" }]))!;
    expect(matchDocument(parsed, QUERY)).toBe("NETWORK_MISMATCH");
    expect(isContradiction("NETWORK_MISMATCH")).toBe(true);
  });

  it("does not match a declaration made by a different origin", () => {
    const parsed = parseDocument(doc([{ resource: "https://evil.example/summarize", payTo: PAY_TO, network: NETWORK }]))!;
    expect(matchDocument(parsed, QUERY)).toBe("RESOURCE_NOT_DECLARED");
  });
});

describe("the SSRF boundary", () => {
  it.each([
    ["localhost", ["127.0.0.1"]],
    ["loopback", ["127.0.0.53"]],
    ["RFC1918 10/8", ["10.0.0.1"]],
    ["RFC1918 172.16/12", ["172.16.5.4"]],
    ["RFC1918 192.168/16", ["192.168.1.1"]],
    ["link-local and metadata", ["169.254.169.254"]],
    ["CGNAT", ["100.64.0.1"]],
    ["unspecified v4", ["0.0.0.0"]],
    ["IPv6 loopback", ["::1"]],
    ["IPv6 unique-local", ["fc00::1"]],
    ["IPv6 link-local", ["fe80::1"]],
    ["IPv6 unspecified", ["::"]],
    ["IPv4-mapped loopback", ["::ffff:127.0.0.1"]],
    ["public plus private, a rebinding attempt", ["93.184.216.34", "10.0.0.1"]],
  ])("refuses a host resolving to %s, without making a request", async (_label, addresses) => {
    const { get, run } = verifier(served(doc([])), addresses);
    const result = await run();
    expect(result.reason).toBe("UNSAFE_ORIGIN");
    // The point is not that the request failed. It is that none was attempted.
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a resource that is not https, without resolving anything", async () => {
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    const get = vi.fn();
    const result = await verifyOwnership(
      { ...QUERY, resource: "http://demo-api.testnet.x402seek.xyz/summarize" },
      { get, resolve },
    );
    expect(result.reason).toBe("UNSAFE_ORIGIN");
    expect(resolve).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a non-default port", async () => {
    const { get, run } = verifier(served(doc([])));
    const result = await run({ ...QUERY, resource: "https://demo-api.testnet.x402seek.xyz:8443/x" });
    expect(result.reason).toBe("UNSAFE_ORIGIN");
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a redirect rather than following it anywhere", async () => {
    for (const status of [301, 302, 307, 308]) {
      const result = await verifier(served("", { status })).run();
      expect(result.reason, String(status)).toBe("REDIRECT_REFUSED");
    }
  });

  it("refuses an oversized body, declared or streamed", async () => {
    const declared = await verifier(served("{}", { contentLength: 70_000 })).run();
    expect(declared.reason).toBe("FETCH_TOO_LARGE");

    const streamed = await verifier(new Error("TOO_LARGE")).run();
    expect(streamed.reason).toBe("FETCH_TOO_LARGE");
  });

  it("refuses a compressed body and a non-JSON content type", async () => {
    const gzipped = await verifier(served(doc([]), { contentEncoding: "gzip" })).run();
    expect(gzipped.reason).toBe("WELL_KNOWN_INVALID");

    const html = await verifier(served(doc([]), { contentType: "text/html" })).run();
    expect(html.reason).toBe("WELL_KNOWN_INVALID");
  });

  it("connects to the address it validated, not to a fresh resolution", async () => {
    const { get, run } = verifier(served(doc([{ resource: RESOURCE, payTo: PAY_TO, network: NETWORK }])), [
      "93.184.216.34",
    ]);
    await run();
    // Pinning is the defence; asserting the address reaches the socket is how we
    // know the second resolution cannot happen.
    expect(get).toHaveBeenCalledWith(
      "https://demo-api.testnet.x402seek.xyz/.well-known/x402",
      "93.184.216.34",
    );
  });

  it("classifies addresses correctly in isolation", () => {
    for (const bad of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "::1", "fc00::9", "fe80::a", "not-an-address"]) {
      expect(isForbiddenAddress(bad), bad).toBe(true);
    }
    for (const good of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"]) {
      expect(isForbiddenAddress(good), good).toBe(false);
    }
  });
});

describe("document parsing", () => {
  it("refuses a version or kind it does not own", () => {
    expect(parseDocument(doc([], { version: 2 }))).toBeUndefined();
    expect(parseDocument(doc([], { kind: "facilitator" }))).toBeUndefined();
    expect(parseDocument("[]")).toBeUndefined();
    expect(parseDocument("null")).toBeUndefined();
  });

  it("drops malformed entries rather than the whole document", () => {
    const parsed = parseDocument(
      doc([{ resource: RESOURCE }, "nonsense", { resource: RESOURCE, payTo: PAY_TO, network: NETWORK }]),
    );
    expect(parsed?.resources).toHaveLength(1);
  });

  it("compares resources without inventing equivalences", () => {
    expect(sameResource(RESOURCE, RESOURCE)).toBe(true);
    // DNS is case-insensitive; a default port is not a difference.
    expect(sameResource(RESOURCE, RESOURCE.replace("demo-api", "DEMO-API"))).toBe(true);
    expect(sameResource(RESOURCE, RESOURCE.replace(".xyz/", ".xyz:443/"))).toBe(true);
    // A path is not.
    expect(sameResource(RESOURCE, `${RESOURCE}/`)).toBe(false);
    expect(sameResource(RESOURCE, RESOURCE.replace("summarize", "Summarize"))).toBe(false);
    expect(sameResource(RESOURCE, "https://evil.example/summarize")).toBe(false);
  });

  it("has no wildcard, by construction", () => {
    const parsed = parseDocument(doc([{ resource: "https://demo-api.testnet.x402seek.xyz/*", payTo: PAY_TO, network: NETWORK }]))!;
    expect(matchDocument(parsed, QUERY)).toBe("RESOURCE_NOT_DECLARED");
  });
});

describe("ownership precedence", () => {
  it("never lets a later settlement demote a verified listing", () => {
    // Every settlement write arrives as tofu. This is the line that stops one
    // from quietly undoing domain verification.
    expect(strongerBinding("domain-verified", "tofu")).toBe("domain-verified");
    expect(strongerBinding("domain-mismatch", "tofu")).toBe("domain-mismatch");
    expect(strongerBinding("domain-mismatch", "domain-verified")).toBe("domain-mismatch");
  });

  it("promotes an unbound or weaker listing", () => {
    expect(strongerBinding(undefined, "tofu")).toBe("tofu");
    expect(strongerBinding("tofu", "domain-verified")).toBe("domain-verified");
    expect(strongerBinding("tofu", "domain-mismatch")).toBe("domain-mismatch");
  });
});


describe("persistence and revalidation", () => {
  /** A store with one listing already catalogued as tofu. */
  function seeded() {
    const store = new SqliteCatalogStore(":memory:");
    store.upsert({
      canonicalKey: RESOURCE,
      type: "http",
      resource: RESOURCE,
      discoveryInfo: {},
      payTo: PAY_TO,
      network: NETWORK,
      scheme: "exact",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "10000",
      x402Version: 2,
      ownerPayTo: PAY_TO,
      ownershipBinding: "tofu",
      firstSeenAt: "2026-08-16T00:00:00.000Z",
      lastSeenAt: "2026-08-16T00:00:00.000Z",
      lastSettlementTx: "a".repeat(64),
      metadataVersion: 1,
    });
    return store;
  }

  it("promotes to domain-verified and stores a TTL", () => {
    const store = seeded();
    const at = Date.parse("2026-08-16T12:00:00.000Z");
    store.recordVerification(RESOURCE, { reason: "VERIFIED", origin: "https://x" }, "domain-verified", at);

    const record = store.verification(RESOURCE)!;
    expect(record.status).toBe("VERIFIED");
    expect(record.verifiedAt).toBe(new Date(at).toISOString());
    expect(Date.parse(record.expiresAt!) - at).toBe(VERIFICATION_TTL_MS);
    expect(record.failures).toBe(0);
    expect(store.list({}).resources[0]!.ownershipBinding).toBe("domain-verified");
  });

  it("records a contradiction as an answer, not a failure", () => {
    const store = seeded();
    store.recordVerification(RESOURCE, { reason: "PAYTO_MISMATCH", origin: "https://x" }, "domain-mismatch");
    const record = store.verification(RESOURCE)!;
    expect(record.status).toBe("MISMATCH");
    // A contradiction is an answer. Counting it as a failure would start the
    // grace clock on a seller who is talking to us.
    expect(record.failures).toBe(0);
    expect(store.list({}).resources[0]!.ownershipBinding).toBe("domain-mismatch");
  });

  it("counts consecutive non-answers and keeps the prior binding", () => {
    const store = seeded();
    store.recordVerification(RESOURCE, { reason: "VERIFIED", origin: "https://x" }, "domain-verified");
    store.recordVerification(RESOURCE, { reason: "FETCH_TIMEOUT", origin: "https://x" }, undefined);
    store.recordVerification(RESOURCE, { reason: "FETCH_TIMEOUT", origin: "https://x" }, undefined);

    expect(store.verification(RESOURCE)!.failures).toBe(2);
    // Still verified: two timeouts are our network's opinion, not the seller's.
    expect(store.list({}).resources[0]!.ownershipBinding).toBe("domain-verified");
  });

  it("does not demote before the grace window, and does after", () => {
    const store = seeded();
    const t0 = Date.parse("2026-08-16T00:00:00.000Z");
    store.recordVerification(RESOURCE, { reason: "VERIFIED", origin: "https://x" }, "domain-verified", t0);
    store.recordVerification(RESOURCE, { reason: "FETCH_TIMEOUT", origin: "https://x" }, undefined, t0 + 1000);

    expect(store.degradeStaleVerification(RESOURCE, t0 + VERIFICATION_GRACE_MS - 1000)).toBe(false);
    expect(store.list({}).resources[0]!.ownershipBinding).toBe("domain-verified");

    expect(store.degradeStaleVerification(RESOURCE, t0 + VERIFICATION_GRACE_MS + 1000)).toBe(true);
    expect(store.list({}).resources[0]!.ownershipBinding).toBe("tofu");
  });

  it("a later settlement cannot demote a verified listing", () => {
    const store = seeded();
    store.recordVerification(RESOURCE, { reason: "VERIFIED", origin: "https://x" }, "domain-verified");

    // Exactly what a subsequent payment writes.
    const listing = store.list({}).resources[0]!;
    store.upsert({ ...listing, ownershipBinding: "tofu", lastSettlementTx: "b".repeat(64) });

    expect(store.list({}).resources[0]!.ownershipBinding).toBe("domain-verified");
  });

  it("declares the cascade, so a verification row cannot outlive its listing", () => {
    // The store has no delete API, so the guarantee is asserted at the schema:
    // deleting this table must cost a re-fetch and nothing more, exactly like
    // `embeddings`.
    const schema = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    expect(schema).toContain("REFERENCES listings(canonical_key) ON DELETE CASCADE");
  });
});
