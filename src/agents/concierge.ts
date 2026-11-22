/**
 * The Concierge answers a guest's question on an event's public page.
 * Unlike the other agents it replies live, so it is kept on a short lead:
 * two tools, four steps, public information only, and limits on how much
 * one visitor can ask.
 */
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysJournal } from "@/db/schema";
import { servicePrincipal } from "@/platform/seed";
import { CONCIERGE } from "./definitions";
import { getModel, type Message } from "./model";
import { runLoop } from "./runtime";

export const MAX_QUESTIONS = 12;
export const MAX_QUESTION_LENGTH = 500;
export type Turn = { who: "guest" | "concierge"; text: string };

const where = (conversationId: string) => and(eq(sysJournal.tableName, "concierge"), eq(sysJournal.recordId, conversationId));

export async function conversation(db: Db, conversationId: string): Promise<Turn[]> {
  const rows = await db.select().from(sysJournal).where(where(conversationId)).orderBy(asc(sysJournal.id));
  return rows.map((r) => ({ who: r.kind === "comment" ? "guest" : "concierge", text: r.body }));
}

export async function askConcierge(db: Db, eventId: string, conversationId: string, question: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const model = getModel();
  if (!model) return { ok: false, reason: "The assistant is not available right now." };
  const text = question.trim().slice(0, MAX_QUESTION_LENGTH);
  if (text.length < 2) return { ok: false, reason: "Type a question first." };
  const [asked] = await db.select({ n: count() }).from(sysJournal).where(and(where(conversationId), eq(sysJournal.kind, "comment")));
  if (asked.n >= MAX_QUESTIONS) return { ok: false, reason: "That is the limit for one conversation. Please contact the organisers for anything else." };

  const agent = await servicePrincipal(db, "Concierge");
  const history = await conversation(db, conversationId);
  const messages: Message[] = [
    { role: "user", content: `Event id: ${eventId}. Today is ${new Date().toISOString().slice(0, 10)}.` },
    { role: "assistant", content: "Understood. I will answer guests' questions about this event." },
    ...history.map((t): Message => ({ role: t.who === "guest" ? "user" : "assistant", content: t.text })),
    { role: "user", content: text },
  ];
  await db.insert(sysJournal).values({ tableName: "concierge", recordId: conversationId, kind: "comment", body: text });
  let answer: string;
  try {
    const outcome = await runLoop({ db, agent, model, system: CONCIERGE.system, messages, toolNames: CONCIERGE.tools, maxSteps: 4 });
    answer = outcome.text || "I could not find that. I have passed your question to the organisers.";
  } catch (error) {
    console.error("[concierge]", error);
    answer = "Sorry, I could not answer just now. Please try again in a moment.";
  }
  await db.insert(sysJournal).values({ tableName: "concierge", recordId: conversationId, kind: "work_note", authorId: agent.id, body: answer.slice(0, 4000) });
  return { ok: true };
}
