/**
 * The security core.
 *
 * The demo buyer holds a funded key and answers anonymous requests, so the
 * claim that matters is not "we check the terms" but "it cannot sign anything
 * else". Every test below is asserted twice on purpose: once against the
 * pre-flight validator, and once against the policy the x402 client applies
 * immediately before signing. A bypass has to defeat both, and they share the
 * same predicate so they cannot drift apart.
 */

import { describe, expect, it } from "vitest";
import {
  DEMO_AMOUNT,
  DEMO_ASSET,
  DEMO_NETWORK,
  DEMO_PAY_TO,
  DEMO_RESOURCE_URL,
  type Accepts,
  demoPaymentPolicy,
  isDemoResource,
  isDemoTerms,
  validateLiveTerms,
} from "../src/invariants.js";

const GOOD: Accepts = {
  scheme: "exact",
  network: DEMO_NETWORK,
  asset: DEMO_ASSET,
  amount: DEMO_AMOUNT,
  payTo: DEMO_PAY_TO,
};

/** Assert a bad option is refused by the validator *and* by the signing policy. */
function refusedEverywhere(bad: Accepts, reason: string) {
  const verdict = validateLiveTerms(DEMO_RESOURCE_URL, [bad]);
  expect(verdict.ok, `validator accepted ${reason}`).toBe(false);
  expect(isDemoTerms(bad)).toBe(false);
  expect(demoPaymentPolicy(2, [bad]), `policy passed ${reason}`).toEqual([]);
  // And it cannot be smuggled in beside a good one: the policy keeps only the
  // good option, so the client can still sign only the demo.
  expect(demoPaymentPolicy(2, [bad, GOOD])).toEqual([GOOD]);
  return verdict;
}

describe("the demo terms, and nothing else", () => {
  it("accepts exactly the approved option", () => {
    expect(isDemoTerms(GOOD)).toBe(true);
    expect(validateLiveTerms(DEMO_RESOURCE_URL, [GOOD]).ok).toBe(true);
    expect(demoPaymentPolicy(2, [GOOD])).toEqual([GOOD]);
  });

  it("refuses a different network, pubnet included", () => {
    expect(refusedEverywhere({ ...GOOD, network: "stellar:pubnet" }, "pubnet").reason)
      .toBe("WRONG_NETWORK");
    refusedEverywhere({ ...GOOD, network: "eip155:8453" }, "base");
    refusedEverywhere({ ...GOOD, network: undefined }, "absent network");
  });

  it("refuses a different scheme", () => {
    expect(refusedEverywhere({ ...GOOD, scheme: "upto" }, "upto").reason).toBe("WRONG_SCHEME");
  });

  it("refuses a different asset", () => {
    expect(
      refusedEverywhere(
        { ...GOOD, asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
        "native XLM SAC",
      ).reason,
    ).toBe("WRONG_ASSET");
  });

  it("refuses a different payee", () => {
    expect(
      refusedEverywhere(
        { ...GOOD, payTo: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW" },
        "someone else",
      ).reason,
    ).toBe("WRONG_PAY_TO");
  });

  it("refuses any amount that is not the demo amount", () => {
    expect(refusedEverywhere({ ...GOOD, amount: "10001" }, "one unit dearer").reason)
      .toBe("WRONG_AMOUNT");
    refusedEverywhere({ ...GOOD, amount: "100000000" }, "ten thousand times dearer");
    // Cheaper is refused too. The demo costs what it costs, and an unexpected
    // discount is still the seller's terms having moved.
    refusedEverywhere({ ...GOOD, amount: "1" }, "cheaper");
    refusedEverywhere({ ...GOOD, amount: "0" }, "free");
  });

  it("compares amounts as numbers, so no string trick gets through", () => {
    // Equal as strings is not the test; equal as integers is.
    expect(isDemoTerms({ ...GOOD, amount: "010000" })).toBe(true);
    expect(demoPaymentPolicy(2, [{ ...GOOD, amount: "010000" }])).toHaveLength(1);
    // And anything that is not a plain integer is refused rather than coerced.
    for (const amount of ["1e4", "10000.0", " 10000", "10000 ", "0x2710", "", "NaN"]) {
      expect(isDemoTerms({ ...GOOD, amount }), amount).toBe(false);
      expect(demoPaymentPolicy(2, [{ ...GOOD, amount }]), amount).toEqual([]);
    }
    expect(isDemoTerms({ ...GOOD, amount: undefined })).toBe(false);
  });
});

describe("the resource is pinned too", () => {
  it("accepts only the hosted summarizer over https", () => {
    expect(isDemoResource(DEMO_RESOURCE_URL)).toBe(true);
    expect(isDemoResource("https://DEMO-API.testnet.x402seek.xyz/summarize")).toBe(true);
  });

  it("refuses another host, another path, or a downgrade", () => {
    for (const url of [
      "http://demo-api.testnet.x402seek.xyz/summarize",
      "https://evil.example/summarize",
      "https://demo-api.testnet.x402seek.xyz/anything-else",
      "https://demo-api.testnet.x402seek.xyz/summarize/../admin",
      "https://demo-api.testnet.x402seek.xyz/summarize?to=someone",
      "https://user:pass@demo-api.testnet.x402seek.xyz/summarize",
      "https://demo-api.testnet.x402seek.xyz.evil.example/summarize",
      "//demo-api.testnet.x402seek.xyz/summarize",
      "file:///etc/passwd",
      "",
    ]) {
      expect(isDemoResource(url), url).toBe(false);
      expect(validateLiveTerms(url, [GOOD]).ok, url).toBe(false);
    }
    expect(validateLiveTerms("https://evil.example/summarize", [GOOD]).reason)
      .toBe("WRONG_RESOURCE");
  });
});

describe("degenerate 402 bodies", () => {
  it("refuses an empty or missing accepts array", () => {
    expect(validateLiveTerms(DEMO_RESOURCE_URL, []).reason).toBe("NO_ACCEPTS");
    expect(validateLiveTerms(DEMO_RESOURCE_URL, undefined).reason).toBe("NO_ACCEPTS");
    expect(demoPaymentPolicy(2, [])).toEqual([]);
    expect(demoPaymentPolicy(2, undefined as unknown as Accepts[])).toEqual([]);
  });

  it("refuses when every option is malformed", () => {
    const junk = [{}, { scheme: "exact" }, { amount: "10000" }] as Accepts[];
    expect(validateLiveTerms(DEMO_RESOURCE_URL, junk).ok).toBe(false);
    expect(demoPaymentPolicy(2, junk)).toEqual([]);
  });

  it("does not trust the x402 version to vouch for the fields", () => {
    // A future version could redefine these names. Failing closed on the terms
    // is the only thing that stays correct across that.
    for (const version of [1, 2, 3, 99]) {
      expect(demoPaymentPolicy(version, [{ ...GOOD, payTo: "GSOMEONEELSE" }])).toEqual([]);
      expect(demoPaymentPolicy(version, [GOOD])).toEqual([GOOD]);
    }
  });
});

describe("the predicate takes no signer and no secret", () => {
  it("is reusable by a future wallet flow unchanged", async () => {
    // Same authority, different signer, is the whole point of keeping this file
    // free of anything that can sign. A source-level check, because the type
    // system will not notice the day someone adds a secret parameter.
    const { readFileSync } = await import("node:fs");
    // Comments stripped first: the prose in that file uses the word "secret"
    // precisely to explain why the code below it must never contain one.
    const code = readFileSync(new URL("../src/invariants.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const banned of ["secret", "Keypair", "createEd25519Signer", "signAuthEntry", "process.env"]) {
      expect(code, banned).not.toContain(banned);
    }
  });
});
