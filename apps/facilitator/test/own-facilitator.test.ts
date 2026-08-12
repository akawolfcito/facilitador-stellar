import { describe, expect, it } from "vitest";
import {
  ForeignFacilitatorError,
  assertOwnFacilitator,
  assertSettledByUs,
} from "../src/own-facilitator.js";
import { HTTPFacilitatorClient } from "@x402/core/http";

describe("assertOwnFacilitator", () => {
  it("accepts a facilitator we control", () => {
    expect(assertOwnFacilitator("http://127.0.0.1:4402", "test")).toBe("http://127.0.0.1:4402");
    expect(assertOwnFacilitator("https://facilitator.ours.example", "test")).toBeTruthy();
  });

  it("rejects the public facilitator", () => {
    for (const url of [
      "https://x402.org/facilitator",
      "https://X402.ORG/facilitator",
      "https://www.x402.org/facilitator",
      "http://facilitator.x402.org/",
    ]) {
      expect(() => assertOwnFacilitator(url, "test"), url).toThrow(ForeignFacilitatorError);
    }
  });

  it("rejects an unset URL, which is what triggers the default fallback", () => {
    expect(() => assertOwnFacilitator(undefined, "test")).toThrow(/no facilitator URL configured/);
    expect(() => assertOwnFacilitator("", "test")).toThrow(ForeignFacilitatorError);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertOwnFacilitator("not a url", "test")).toThrow(ForeignFacilitatorError);
  });

  it("names the context so a failure says where it came from", () => {
    expect(() => assertOwnFacilitator(undefined, "upstream-e2e-proxy")).toThrow(
      /upstream-e2e-proxy/,
    );
  });
});

describe("the default this guard exists for", () => {
  it("is still x402.org in the installed @x402/core, and is still caught", () => {
    // Pinning the upstream behaviour: if this default ever changes, the guard's
    // host list needs revisiting, and this test is where that surfaces.
    const defaulted = new HTTPFacilitatorClient();
    expect(defaulted.url).toBe("https://x402.org/facilitator");
    expect(() => assertOwnFacilitator(defaulted.url, "default client")).toThrow(
      ForeignFacilitatorError,
    );
  });

  it("passing a string instead of a config silently defaults — the E-06a bug", () => {
    // TypeScript rejects this (TS2559); the cast reproduces what happens when a
    // JavaScript caller, or a `as any`, gets it wrong at runtime.
    const misconfigured = new HTTPFacilitatorClient(
      "http://127.0.0.1:4402" as unknown as { url: string },
    );
    expect(misconfigured.url).toBe("https://x402.org/facilitator");
    expect(() => assertOwnFacilitator(misconfigured.url, "misconfigured")).toThrow(
      ForeignFacilitatorError,
    );
  });
});

describe("assertSettledByUs", () => {
  const ours = ["GSIGNER1", "GSIGNER2"];

  it("accepts a transaction submitted by one of our signers", () => {
    expect(() => assertSettledByUs("GSIGNER2", ours, "test")).not.toThrow();
  });

  it("rejects a transaction submitted by anyone else", () => {
    // This is the shape of the E-06a failure: everything green, wrong source.
    expect(() => assertSettledByUs("GC6CSXBVCHANNELACCOUNT", ours, "test")).toThrow(
      /not one of our signers/,
    );
  });

  it("rejects a missing source account rather than assuming success", () => {
    expect(() => assertSettledByUs(undefined, ours, "test")).toThrow(ForeignFacilitatorError);
  });
});
