import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, redact } from "../src/config.js";

/** A syntactically valid Stellar secret: `S` + 55 base32 characters. */
const SECRET = `S${"A".repeat(55)}`;
const SECRET_2 = `S${"B".repeat(55)}`;

const base = { SIGNER_SECRET_KEYS: SECRET } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("defaults to testnet with its canonical RPC URL", () => {
    const config = loadConfig(base);
    expect(config.network).toBe("stellar:testnet");
    expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.port).toBe(4402);
    expect(config.areFeesSponsored).toBe(true);
  });

  it("accepts pubnet under either spelling and picks its RPC URL", () => {
    for (const spelling of ["pubnet", "mainnet", "stellar:pubnet"]) {
      const config = loadConfig({ ...base, STELLAR_NETWORK: spelling });
      expect(config.network).toBe("stellar:pubnet");
      expect(config.rpcUrl).toBe("https://mainnet.sorobanrpc.com");
    }
  });

  it("rejects an unknown network rather than silently defaulting", () => {
    expect(() => loadConfig({ ...base, STELLAR_NETWORK: "futurenet" })).toThrow(ConfigError);
  });

  it("lets an explicit RPC URL override the default", () => {
    expect(loadConfig({ ...base, STELLAR_RPC_URL: "https://rpc.example" }).rpcUrl).toBe(
      "https://rpc.example",
    );
  });

  it("parses several comma-separated signers, for channel-account throughput", () => {
    expect(loadConfig({ SIGNER_SECRET_KEYS: `${SECRET}, ${SECRET_2}` }).signerSecrets).toEqual([
      SECRET,
      SECRET_2,
    ]);
  });

  it("requires at least one signer", () => {
    expect(() => loadConfig({})).toThrow(/SIGNER_SECRET_KEYS is required/);
    expect(() => loadConfig({ SIGNER_SECRET_KEYS: "  ,  " })).toThrow(ConfigError);
  });

  it("rejects a malformed secret at boot, and never echoes its value", () => {
    const bad = "SNOTAREALKEY";
    try {
      loadConfig({ SIGNER_SECRET_KEYS: bad });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(bad);
      expect((error as Error).message).toContain("[0]");
    }
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadConfig({ ...base, PORT: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(ConfigError);
  });

  it("allows fee sponsorship to be switched off explicitly", () => {
    expect(loadConfig({ ...base, ARE_FEES_SPONSORED: "false" }).areFeesSponsored).toBe(false);
    expect(loadConfig({ ...base, ARE_FEES_SPONSORED: "true" }).areFeesSponsored).toBe(true);
  });
});

describe("redact", () => {
  it("never carries secret material into a loggable object", () => {
    const redacted = redact(loadConfig({ SIGNER_SECRET_KEYS: `${SECRET},${SECRET_2}` }));
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(redacted.signerSecrets).toBe("2 signer(s)");
  });
});
