/**
 * The tool registry as a Model Context Protocol server, so an outside
 * assistant can work in this instance with an API key. It gets exactly the
 * tools its key's roles permit, and every call is audited like any other.
 * Stateless JSON-RPC over HTTP POST: initialize, ping, tools/list, tools/call.
 */
import { z } from "zod";
import "@/tools";
import { getDb } from "@/db/client";
import { deliverSoon } from "@/lib/deliver";
import { principalForApiKey } from "@/platform/principal";
import { invoke, listTools } from "@/platform/tools";

export const dynamic = "force-dynamic";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const wire = (name: string) => name.replace(/\./g, "-");
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(request: Request) {
  const key = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const db = await getDb();
  const principal = key ? await principalForApiKey(db, key) : null;
  if (!principal) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown or missing API key" } }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });

  const mine = () => listTools().filter((t) => principal.permissions.has(t.permission));
  const handle = async (message: Rpc): Promise<object | null> => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
    if (message.id === undefined) return null; // a notification: nothing to answer
    switch (message.method) {
      case "initialize": {
        const asked = String(message.params?.protocolVersion ?? "");
        return reply({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "eventos", version: "0.1.0" },
          instructions: "Tools for running B2B events. Actions seen outside the organisation may be held for a person to approve.",
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: mine().map((t) => ({ name: wire(t.name), description: t.description, inputSchema: z.toJSONSchema(t.input, { io: "input" }) })) });
      case "tools/call": {
        const tool = mine().find((t) => wire(t.name) === message.params?.name);
        if (!tool) return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
        const result = await invoke(db, principal, tool.name, message.params?.arguments ?? {});
        deliverSoon();
        return reply({ content: [{ type: "text", text: JSON.stringify(result.status === "ok" ? result.output : result) }], isError: result.status !== "ok" && result.status !== "pending_approval" });
      }
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
    }
  };

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(handle))).filter(Boolean);
    return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
  }
  const single = await handle(body);
  return single ? Response.json(single) : new Response(null, { status: 202 });
}

/** This server keeps no stream open; clients that ask for one are told so. */
export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
