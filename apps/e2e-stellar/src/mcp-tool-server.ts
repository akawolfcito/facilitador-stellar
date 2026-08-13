/**
 * A paid MCP tool: `summarize_text`.
 *
 * The business logic is deliberately trivial and deterministic — the payment
 * and discovery lifecycle is what is under test, not summarisation.
 *
 * Everything protocol-facing is stock: `createPaymentWrapper` from `@x402/mcp`
 * gates the tool behind an x402 402, and `declareDiscoveryExtension` from
 * `@x402/extensions/bazaar` declares the metadata that gets cataloged when a
 * payment settles.
 *
 * The `resource.url` carries an authority — `mcp://host:port/tool/summarize_text`
 * rather than the spec's authority-less `mcp://tool/{toolName}` — because the
 * Bazaar spec provides no field for an MCP server's reachable endpoint, and
 * without one a discovered tool cannot be invoked. See
 * `endpointFromResource` in @stellar-bazaar/mcp-discovery for the reasoning.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createPaymentWrapper } from "@x402/mcp";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import express from "express";
import { z } from "zod";

export const TOOL_NAME = "summarize_text";

export interface ToolServerConfig {
  port: number;
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  asset: string;
  amount: string;
}

/** Deterministic stand-in for a real summariser. */
export function summarize(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, 8).join(" ");
  return `${head}${words.length > 8 ? "…" : ""} (${words.length} words)`;
}

export async function startToolServer(
  config: ToolServerConfig,
): Promise<{ resourceUrl: string; close(): Promise<void> }> {
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  );
  resourceServer.register(config.network, new ExactStellarScheme());
  // createPaymentWrapper uses the raw resource server, which does not lazily
  // initialise, so requirements must be buildable before the first call.
  await resourceServer.initialize();

  const paymentRequirements = await resourceServer.buildPaymentRequirements({
    payTo: config.payTo,
    scheme: "exact",
    network: config.network,
    price: { asset: config.asset, amount: config.amount },
  } as never);

  const resourceUrl = `mcp://127.0.0.1:${config.port}/tool/${TOOL_NAME}`;

  const paid = createPaymentWrapper(resourceServer, {
    accepts: paymentRequirements,
    resource: {
      url: resourceUrl,
      description: "Summarize a block of text into a single short line.",
      serviceName: "Text Summarizer",
      tags: ["summarization", "text", "nlp"],
    },
    extensions: declareDiscoveryExtension({
      toolName: TOOL_NAME,
      description:
        "Condense a passage of text into one short summary line. Accepts plain text and " +
        "returns a single sentence with a word count.",
      transport: "sse",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to summarize, as plain UTF-8" },
        },
        required: ["text"],
      },
      output: { example: { summary: "the quick brown fox jumped over… (12 words)" } },
    }),
  });

  const mcpServer = new McpServer({ name: "summarizer", version: "0.1.0" });

  mcpServer.tool(
    TOOL_NAME,
    "Summarize a block of text into a single short line.",
    { text: z.string() },
    paid(async (args: { text?: unknown }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ summary: summarize(String(args?.text ?? "")) }),
        },
      ],
    })) as never,
  );

  const app = express();
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await mcpServer.connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : [...transports.values()][0];
    if (!transport) {
      res.status(400).json({ error: "no active session" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  const listener = app.listen(config.port);
  return {
    resourceUrl,
    close: () =>
      new Promise<void>((resolve) => {
        listener.close(() => resolve());
      }),
  };
}
