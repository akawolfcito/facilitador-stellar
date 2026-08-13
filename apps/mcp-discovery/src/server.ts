/**
 * The MCP discovery server (RFP §3.3).
 *
 * An agent-facing adapter over the facilitator's existing discovery and payment
 * capabilities. It exposes exactly two tools and owns nothing else: ranking
 * belongs to `/discovery/search`, settlement to `@x402/stellar`, persistence to
 * the catalog.
 *
 * Every result — success or failure — is a single JSON object, so an agent
 * parses one shape and branches on `ok` and `code` rather than on prose.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import { bazaarPayAndCall, bazaarSearch, type Deps } from "./tools.js";

/** JSON in, JSON out — MCP content is a single text block of structured data. */
function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function buildMcpServer(deps: Deps): McpServer {
  const server = new McpServer({ name: "stellar-bazaar-discovery", version: "0.1.0" });

  server.tool(
    "bazaar_search",
    "Search the Stellar Bazaar for paid x402 resources and MCP tools by natural-language " +
      "intent. Returns payment terms and input schemas so a caller can decide whether a " +
      "result is worth paying for. Returns an abstention with a reason when nothing is " +
      "relevant enough to recommend.",
    {
      query: z.string().min(1).max(512).describe("Natural-language description of what you need"),
      network: z.string().optional().describe("CAIP-2 network filter, e.g. stellar:testnet"),
      scheme: z.string().optional().describe("Payment scheme filter, e.g. exact"),
      asset: z.string().optional().describe("Asset contract filter"),
      type: z.enum(["http", "mcp"]).optional().describe("Resource kind filter"),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional().describe("Continuation cursor from a previous search"),
    },
    async (args) => jsonResult(await bazaarSearch(deps, args)),
  );

  server.tool(
    "bazaar_pay_and_call",
    "Pay for a discovered MCP tool on Stellar and invoke it. Re-fetches live payment " +
      "requirements first and refuses to pay if they differ from what was discovered, or " +
      "if the price exceeds maxAmount. Returns the tool output plus payment evidence.",
    {
      resource: z
        .string()
        .describe("Canonical resource from a bazaar_search result, e.g. mcp://host:port/tool/name"),
      toolName: z.string().describe("Tool name from the search result"),
      arguments: z.record(z.unknown()).optional().describe("Arguments for the target tool"),
      maxAmount: z
        .string()
        .optional()
        .describe("Atomic ceiling; nothing is signed if the live price exceeds it"),
      expected: z
        .object({
          network: z.string().optional(),
          scheme: z.string().optional(),
          asset: z.string().optional(),
          payTo: z.string().optional(),
          amount: z.string().optional(),
        })
        .optional()
        .describe("Terms from the search result; a mismatch aborts before payment"),
    },
    async (args) => jsonResult(await bazaarPayAndCall(deps, args)),
  );

  return server;
}

/** Serve the MCP server over SSE. */
export async function serveMcp(deps: Deps, port: number): Promise<{ close(): Promise<void> }> {
  const server = buildMcpServer(deps);
  const app = express();
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await server.connect(transport);
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

  const listener = app.listen(port);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        listener.close(() => resolve());
      }),
  };
}
