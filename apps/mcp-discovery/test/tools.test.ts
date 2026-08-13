/**
 * MCP adapter unit tests.
 *
 * These cover what can be decided without a chain: search translation,
 * abstention passthrough, endpoint parsing and the pre-flight checks that must
 * refuse *before* anything is signed. The paid path itself is covered by the
 * live testnet E2E (E-23), because a mocked settlement would prove nothing.
 */

import { describe, expect, it } from "vitest";
import { bazaarPayAndCall, bazaarSearch, endpointFromResource, type Deps } from "../src/tools.js";
import { safeReason } from "../src/errors.js";

const DEPS: Deps = {
  facilitatorUrl: "http://facilitator.test",
  buyerSecret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  network: "stellar:testnet",
};

/** A `/discovery/search` response body, as our facilitator emits it. */
function wire(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    resources: [
      {
        resource: "mcp://127.0.0.1:4531/tool/summarize_text",
        type: "mcp",
        toolName: "summarize_text",
        serviceName: "Text Summarizer",
        description: "Condense a passage of text.",
        ownerPayTo: "GSELLER",
        ownershipBinding: "tofu",
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CUSDC",
            amount: "10000",
            payTo: "GSELLER",
          },
        ],
        extensions: {
          bazaar: { info: { input: { type: "mcp", inputSchema: { type: "object" } } } },
        },
      },
    ],
    partialResults: false,
    pagination: { limit: 10, cursor: null },
    ...overrides,
  };
}

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("bazaar_search", () => {
  it("translates a discovery hit into everything an agent needs to decide", async () => {
    const result = await bazaarSearch({ ...DEPS, fetchImpl: fetchReturning(wire()) }, {
      query: "condense text",
    });

    expect(result.ok).toBe(true);
    if (!("results" in result)) return;
    const hit = result.results[0]!;
    expect(hit.toolName).toBe("summarize_text");
    expect(hit.network).toBe("stellar:testnet");
    expect(hit.amount).toBe("10000");
    expect(hit.payTo).toBe("GSELLER");
    expect(hit.inputSchema).toEqual({ type: "object" });
    // The binding is never hidden from the party being asked to spend.
    expect(hit.ownershipBinding).toBe("tofu");
  });

  it("passes the engine's abstention through with its reason", async () => {
    const body = {
      resources: [],
      abstained: { reason: "BELOW_RELEVANCE_THRESHOLD", topScore: 0.03, threshold: 0.22 },
    };
    const result = await bazaarSearch({ ...DEPS, fetchImpl: fetchReturning(body) }, {
      query: "book me a dentist",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("BELOW_RELEVANCE_THRESHOLD");
    expect(result.reason).toContain("0.0300");
  });

  it("reports NO_MATCH for an empty catalog rather than an empty success", async () => {
    const result = await bazaarSearch({ ...DEPS, fetchImpl: fetchReturning({ resources: [] }) }, {
      query: "anything",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_MATCH");
  });

  it("reports DISCOVERY_UNAVAILABLE when the catalog is down", async () => {
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await bazaarSearch({ ...DEPS, fetchImpl: failing }, { query: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DISCOVERY_UNAVAILABLE");
  });

  it("reports DISCOVERY_UNAVAILABLE on a non-200", async () => {
    const result = await bazaarSearch({ ...DEPS, fetchImpl: fetchReturning({}, 503) }, {
      query: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DISCOVERY_UNAVAILABLE");
  });

  it("filters by asset and says so when nothing is priced in it", async () => {
    const result = await bazaarSearch({ ...DEPS, fetchImpl: fetchReturning(wire()) }, {
      query: "x",
      asset: "CSOMETHINGELSE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_ASSET");
  });

  it("forwards filters and cursor to the discovery endpoint verbatim", async () => {
    let seen = "";
    const spy = (async (url: string) => {
      seen = String(url);
      return new Response(JSON.stringify(wire()), { status: 200 });
    }) as unknown as typeof fetch;

    await bazaarSearch({ ...DEPS, fetchImpl: spy }, {
      query: "a b",
      network: "stellar:testnet",
      scheme: "exact",
      type: "mcp",
      limit: 5,
      cursor: "abc",
    });

    // One search stack, not two: the adapter passes through, it does not rank.
    expect(seen).toContain("/discovery/search?");
    expect(seen).toContain("query=a+b");
    expect(seen).toContain("network=stellar%3Atestnet");
    expect(seen).toContain("type=mcp");
    expect(seen).toContain("limit=5");
    expect(seen).toContain("cursor=abc");
  });
});

describe("endpointFromResource", () => {
  it("accepts a dialable mcp:// URL with an authority", () => {
    expect(endpointFromResource("mcp://127.0.0.1:4531/tool/x")).toEqual({
      base: "http://127.0.0.1:4531",
    });
    expect(endpointFromResource("mcp://host.example/tool/x")).toEqual({
      base: "http://host.example",
    });
  });

  it("refuses the spec's authority-less form, which cannot be reached", () => {
    // `mcp://tool/{toolName}` parses with host "tool" — an identity, not an
    // address. The Bazaar spec has no field for an MCP endpoint; see the note
    // on `endpointFromResource`.
    expect(endpointFromResource("mcp://tool/summarize_text")).toBeUndefined();
  });

  it("refuses non-mcp schemes and malformed input", () => {
    expect(endpointFromResource("https://evil.example/tool/x")).toBeUndefined();
    expect(endpointFromResource("not a url")).toBeUndefined();
    expect(endpointFromResource("")).toBeUndefined();
  });
});

describe("pre-flight refusals happen before anything is signed", () => {
  it("refuses an unreachable resource without touching the network", async () => {
    const result = await bazaarPayAndCall(DEPS, {
      resource: "mcp://tool/summarize_text",
      toolName: "summarize_text",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_RESOURCE");
      expect(result.paid).toBeUndefined();
    }
  });

  it("refuses an http(s) resource, which would be an SSRF vector", async () => {
    // The adapter only ever dials a host taken from an `mcp://` URL. It will
    // not be steered into fetching an arbitrary http(s) endpoint.
    for (const resource of [
      "http://169.254.169.254/latest/meta-data",
      "https://internal.example/admin",
      "file:///etc/passwd",
    ]) {
      const result = await bazaarPayAndCall(DEPS, { resource, toolName: "x" });
      expect(result.ok, resource).toBe(false);
      if (!result.ok) expect(result.code, resource).toBe("INVALID_RESOURCE");
    }
  });
});

describe("error messages are safe to hand to an agent", () => {
  it("drops anything that looks like a path, a secret or credentials", () => {
    expect(safeReason(new Error("ENOENT /Users/me/project/src/db.sqlite"), "fallback")).toBe(
      "fallback",
    );
    expect(
      safeReason(new Error(`bad key SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), "fallback"),
    ).toBe("fallback");
    expect(safeReason(new Error("failed https://user:pw@host/x"), "fallback")).toBe("fallback");
  });

  it("keeps a short, harmless first line", () => {
    expect(safeReason(new Error("tool returned an error\n  at foo"), "fallback")).toBe(
      "tool returned an error",
    );
  });

  it("falls back for non-Error throws", () => {
    expect(safeReason("boom", "fallback")).toBe("fallback");
    expect(safeReason(undefined, "fallback")).toBe("fallback");
  });
});
