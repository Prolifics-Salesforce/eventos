/**
 * The model behind the agents, kept behind one small interface so the runtime
 * can be tested with a scripted stand-in and the provider can be swapped.
 * Message shapes follow the Anthropic Messages API.
 */
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Message = { role: "user" | "assistant"; content: string | Block[] };
export type ModelTool = { name: string; description: string; input_schema: unknown };
export type ModelClient = (request: { system: string; messages: Message[]; tools: ModelTool[] }) => Promise<{ content: Block[]; stopReason: string | null }>;

let current: ModelClient | null | undefined;

/** Replace the model, or pass null to switch agents off. Tests use this. */
export function setModel(model: ModelClient | null): void {
  current = model;
}

export function getModel(): ModelClient | null {
  if (current !== undefined) return current;
  if (!process.env.ANTHROPIC_API_KEY) return (current = null);
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  let client: import("@anthropic-ai/sdk").default | undefined;
  return (current = async ({ system, messages, tools }) => {
    client ??= new (await import("@anthropic-ai/sdk")).default();
    const response = await client.messages.create({
      model, max_tokens: 4096, system,
      messages: messages as never, tools: tools as never,
    });
    return { content: response.content as unknown as Block[], stopReason: response.stop_reason };
  });
}

export const agentsEnabled = (): boolean => getModel() !== null;
