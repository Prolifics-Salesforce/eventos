"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { SESSION_MAX_AGE, signIn, signOut } from "@/platform/auth";
import { servicePrincipal } from "@/platform/seed";
import { limitClear, limitCount, limitHit } from "@/platform/limits";
import { askConcierge } from "@/agents/concierge";
import { eq } from "drizzle-orm";
import { event } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { decideApproval, invoke, type InvokeResult } from "@/platform/tools";
import { deliverSoon } from "@/lib/deliver";
import { requirePrincipal, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_TIMEZONE, zonedToIso } from "@/lib/when";
import "@/tools";

const text = (form: FormData, key: string) => {
  const value = String(form.get(key) ?? "").trim();
  return value === "" ? undefined : value;
};

/** The event's own questions arrive as `answer.<key>` fields. */
function answersFrom(form: FormData): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [name, value] of form.entries()) if (name.startsWith("answer.") && typeof value === "string") answers[name.slice(7)] = value;
  return answers;
}

/** What to tell the person when a tool call did not go through. */
function explain(result: InvokeResult): string {
  switch (result.status) {
    case "invalid": return result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    case "denied": return result.reason;
    case "error": return result.message;
    case "pending_approval": return `Held for approval as ${result.approval.number}`;
    default: return "";
  }
}

/** Finish an action: back to `path`, with the reason on the URL when it failed, or `ok` text when it worked. */
function done(path: string, result: InvokeResult, ok?: string): never {
  deliverSoon();
  const join = path.includes("?") ? "&" : "?";
  if (result.status !== "ok") redirect(`${path}${join}notice=${encodeURIComponent(explain(result))}`);
  revalidatePath(path.split("?")[0]);
  redirect(ok ? `${path}${join}ok=${encodeURIComponent(ok)}` : path);
}

/** Where to go back to. Only paths inside the console are accepted, never a full URL. */
function returnTo(form: FormData, fallback: string): string {
  const value = text(form, "returnTo");
  return value && /^\/(events|inbox|runs|agents|team)[\w\-/?=&%.+]*$/.test(value) ? value : fallback;
}

// Five wrong passwords for one email locks sign-in for that email for 15 minutes. Counted in the database, so every process agrees.
export async function signInAction(form: FormData) {
  const email = (text(form, "email") ?? "").toLowerCase().slice(0, 200);
  const db = await getDb();
  const key = `signin:${email}`;
  if ((await limitCount(db, key)) >= 5) redirect("/signin?notice=" + encodeURIComponent("Too many attempts. Try again in 15 minutes."));
  const token = await signIn(db, email, String(form.get("password") ?? ""));
  if (!token) {
    await limitHit(db, key, 15 * 60_000);
    redirect("/signin?notice=" + encodeURIComponent("That email and password do not match"));
  }
  await limitClear(db, key);
  // Secure whenever the site is served over HTTPS; plain http://localhost still works for local runs.
  const secure = (await headers()).get("x-forwarded-proto") === "https" || (process.env.APP_URL ?? "").startsWith("https://");
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MAX_AGE });
  redirect("/");
}

export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await signOut(await getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}

export async function createEventAction(form: FormData) {
  const principal = await requirePrincipal();
  const timezone = text(form, "timezone") ?? DEFAULT_TIMEZONE;
  const startsAt = text(form, "startsAt");
  const result = await invoke<{ id: string }>(await getDb(), principal, "event.create", {
    name: text(form, "name"), kind: text(form, "kind"), venue: text(form, "venue"), brief: text(form, "brief"),
    timezone, startsAt: startsAt ? zonedToIso(startsAt, timezone) : undefined,
  });
  if (result.status === "ok") {
    revalidatePath("/events");
    redirect(`/events/${result.output.id}`);
  }
  done("/events", result);
}

export async function setStatusAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "event.set_status", { eventId, status: text(form, "status") }));
}

export async function addGuestAction(form: FormData) {
  const principal = await requirePrincipal();
  const db = await getDb();
  const eventId = text(form, "eventId")!;
  const person = await invoke<{ id: string }>(db, principal, "contact.upsert", {
    email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"),
    phone: text(form, "phone"), whatsappOptIn: form.get("whatsappOptIn") === "on" || undefined,
  });
  if (person.status !== "ok") done(returnTo(form, `/events/${eventId}`), person);
  done(returnTo(form, `/events/${eventId}`), await invoke(db, principal, "registration.create", { eventId, contactId: person.output.id, source: "staff" }));
}

export async function checkInAction(form: FormData) {
  const principal = await requirePrincipal();
  const result = await invoke<{ pin: string }>(await getDb(), principal, "registration.check_in", { registrationId: text(form, "registrationId") });
  done(returnTo(form, `/events/${text(form, "eventId")}`), result, result.status === "ok" ? `Checked in. PIN ${result.output.pin}` : undefined);
}

export async function addSessionAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const timezone = text(form, "timezone") ?? DEFAULT_TIMEZONE;
  const startsAt = text(form, "startsAt");
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "session.create", {
    eventId, title: text(form, "title"), track: text(form, "track"), room: text(form, "room"),
    startsAt: startsAt ? zonedToIso(startsAt, timezone) : undefined,
  }));
}

export async function captureLeadAction(form: FormData) {
  const principal = await requirePrincipal();
  const db = await getDb();
  const eventId = text(form, "eventId")!;
  const person = await invoke<{ id: string }>(db, principal, "contact.upsert", {
    email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"),
  });
  const back = returnTo(form, `/events/${eventId}`);
  if (person.status !== "ok") done(back, person);
  done(back, await invoke(db, principal, "lead.capture", { eventId, contactId: person.output.id, notes: text(form, "notes"), answers: answersFrom(form) }), `Captured ${text(form, "firstName")}`);
}

export async function addSpeakerAction(form: FormData) {
  const principal = await requirePrincipal();
  const db = await getDb();
  const eventId = text(form, "eventId")!;
  const person = await invoke<{ id: string }>(db, principal, "contact.upsert", {
    email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"), title: text(form, "title"),
  });
  if (person.status !== "ok") done(returnTo(form, `/events/${eventId}`), person);
  done(returnTo(form, `/events/${eventId}`), await invoke(db, principal, "session.add_speaker", { sessionId: text(form, "sessionId"), contactId: person.output.id }));
}

export async function taskStateAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "task.set_state", { taskId: text(form, "taskId"), state: text(form, "state") }));
}

export async function addTaskAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "task.create", { eventId, shortDescription: text(form, "shortDescription") }));
}

export async function runAgentAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId");
  const result = await invoke<{ id: string }>(await getDb(), principal, "agent.run", { agent: text(form, "agent"), goal: text(form, "goal"), eventId });
  if (result.status === "ok") redirect(`/runs/${result.output.id}`);
  done(eventId ? `/events/${eventId}` : "/runs", result);
}

export async function createUserAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/team", await invoke(await getDb(), principal, "user.create", {
    name: text(form, "name"), email: text(form, "email"), role: text(form, "role"), password: String(form.get("password") ?? ""),
  }), "Added to the team");
}

export async function setPolicyAction(form: FormData) {
  const principal = await requirePrincipal();
  const cap = text(form, "dailyCap");
  done("/agents", await invoke(await getDb(), principal, "policy.set", {
    agentId: text(form, "agentId"), tool: text(form, "tool"), level: text(form, "level"), dailyCap: cap ? Number(cap) : undefined,
  }), "Saved");
}

export async function decideAction(form: FormData) {
  const principal = await requirePrincipal();
  const decision = text(form, "decision") === "approve" ? "approve" : "reject";
  // The approver may have reworded the message; only those words are passed on.
  const edits = { subject: form.has("subject") ? String(form.get("subject")) : undefined, body: form.has("body") ? String(form.get("body")).replace(/\r\n/g, "\n") : undefined };
  done(returnTo(form, "/inbox"), await decideApproval(await getDb(), principal, text(form, "taskId")!, decision, edits));
}

const REGISTRATIONS_PER_HOUR = 10;

/** The public registration form. Runs as the Public site service account, never as a person. */
export async function registerGuestAction(form: FormData) {
  const slug = text(form, "eventSlug")!;
  const path = `/e/${slug}`;
  // A filled-in hidden field means a bot; answer as if it worked.
  if (text(form, "website")) redirect(`${path}?done=1`);
  const db = await getDb();
  // One visitor address may register 10 times an hour, so the form cannot be used to flood other people's inboxes.
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if ((await limitHit(db, `register:${address.slice(0, 80)}`, 3600_000)) > REGISTRATIONS_PER_HOUR) redirect(`${path}?notice=${encodeURIComponent("Too many registrations from this connection. Please try again in an hour.")}`);
  const result = await invoke<{ status: string }>(db, await servicePrincipal(db, "Public site"), "registration.register_guest", {
    eventSlug: slug, email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"),
    phone: text(form, "phone"), whatsappOptIn: form.get("whatsappOptIn") === "on", answers: answersFrom(form),
  });
  deliverSoon();
  redirect(result.status === "ok" ? `${path}?done=${result.output.status === "waitlisted" ? "wait" : "1"}` : `${path}?notice=${encodeURIComponent(explain(result))}`);
}

export async function addFieldAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const options = (text(form, "options") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "form.add_field", {
    eventId, purpose: text(form, "purpose"), label: text(form, "label"), type: text(form, "type"), options, required: form.get("required") === "on",
  }));
}

export async function removeFieldAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "form.remove_field", { fieldId: text(form, "fieldId") }));
}

export async function campaignAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const result = await invoke<{ queued: number; skipped: number }>(await getDb(), principal, "campaign.send", {
    eventId, segment: text(form, "segment"), channel: text(form, "channel"), subject: text(form, "subject"), body: text(form, "body"), key: text(form, "key"),
  });
  done(returnTo(form, `/events/${eventId}`), result, result.status === "ok" ? `Queued for ${result.output.queued} guest(s); ${result.output.skipped} skipped for lack of consent${text(form, "key") && result.output.queued === 0 ? ". Everyone on the list has already had this invitation." : ""}` : undefined);
}

export async function resetPasswordAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/team", await invoke(await getDb(), principal, "user.set_password", { userId: text(form, "userId"), password: String(form.get("password") ?? "") }), "Password reset. They have been signed out.");
}

export async function changePasswordAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/account", await invoke(await getDb(), principal, "account.change_password", {
    current: String(form.get("current") ?? ""), password: String(form.get("password") ?? ""),
  }), "Password changed");
}

// One visitor address may ask the Concierge 30 questions an hour. Counted in the database, so every process agrees.
const CONCIERGE_COOKIE = "eventos_chat";

export async function askConciergeAction(form: FormData) {
  const slug = text(form, "eventSlug")!;
  const path = `/e/${slug}/ask`;
  const db = await getDb();
  const [target] = await db.select().from(event).where(eq(event.slug, slug));
  if (!target || target.status !== "live") redirect(`/e/${slug}`);

  const address = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if ((await limitHit(db, `ask:${address.slice(0, 80)}`, 3600_000)) > 30) redirect(`${path}?notice=${encodeURIComponent("Too many questions for now. Please try again later.")}`);

  const jar = await cookies();
  let chat = jar.get(CONCIERGE_COOKIE)?.value;
  if (!chat || !/^[0-9a-f-]{36}$/.test(chat)) {
    chat = randomUUID();
    jar.set(CONCIERGE_COOKIE, chat, { httpOnly: true, sameSite: "lax", path: `/e/${slug}`, maxAge: 86_400 });
  }
  const result = await askConcierge(db, target.id, chat, text(form, "question") ?? "");
  redirect(result.ok ? path : `${path}?notice=${encodeURIComponent(result.reason)}`);
}

const num = (form: FormData, key: string) => {
  const value = text(form, key);
  return value === undefined ? null : Number(value);
};

export async function updateEventAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "event.update", {
    eventId, capacity: num(form, "capacity"), targetRegistrations: num(form, "targetRegistrations"), targetLeads: num(form, "targetLeads"),
  }), "Saved");
}

export async function updateLocaleAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "event.update", { eventId, timezone: text(form, "timezone"), currency: text(form, "currency")?.toUpperCase() }), "Saved");
}

export async function cloneEventAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const startsAt = text(form, "startsAt");
  const db = await getDb();
  // The date typed is wall-clock time where the event happens, which is the zone the copy inherits.
  const [source] = await db.select({ timezone: event.timezone }).from(event).where(eq(event.id, eventId));
  const result = await invoke<{ id: string }>(db, principal, "event.clone", { eventId, name: text(form, "name"), startsAt: startsAt ? zonedToIso(startsAt, source?.timezone ?? DEFAULT_TIMEZONE) : undefined });
  if (result.status === "ok") redirect(`/events/${result.output.id}?ok=${encodeURIComponent("Draft created from the other event")}`);
  done(returnTo(form, `/events/${eventId}`), result);
}

export async function budgetItemAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "budget.set_item", {
    eventId, itemId: text(form, "itemId"), label: text(form, "label"), planned: num(form, "planned") ?? 0, actual: num(form, "actual"),
  }));
}

export async function removeBudgetAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "budget.remove_item", { itemId: text(form, "itemId") }));
}

/** Splits one line of comma-separated text, honouring "quoted, values". */
function csvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { cells.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  return [...cells, cell.trim()];
}

export async function importGuestsAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const lines = String(form.get("list") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(csvLine);
  // With a header row, columns are matched by name; without one, the order is email, first name, last name, job title, phone.
  const header = lines[0]?.some((c) => /e-?mail/i.test(c)) ? lines.shift()!.map((c) => c.toLowerCase()) : null;
  const col = (names: RegExp, fallback: number) => (header ? header.findIndex((h) => names.test(h)) : fallback);
  const at = { email: col(/e-?mail/, 0), first: col(/first|given|^name$/, 1), last: col(/last|sur|family/, 2), title: col(/title|role|designation/, 3), phone: col(/phone|mobile/, 4) };
  const rows = lines.map((c) => ({ email: c[at.email] ?? "", firstName: c[at.first] ?? "", lastName: c[at.last] || undefined, title: c[at.title] || undefined, phone: c[at.phone] || undefined }));
  const result = await invoke<{ invited: number; alreadyOnList: number; invalid: string[] }>(await getDb(), principal, "guest.import", { eventId, rows });
  done(returnTo(form, `/events/${eventId}`), result, result.status === "ok"
    ? `${result.output.invited} added to the list${result.output.alreadyOnList ? `, ${result.output.alreadyOnList} already on it` : ""}${result.output.invalid.length ? `, ${result.output.invalid.length} skipped as not valid` : ""}. Nobody has been emailed yet.` : undefined);
}

export async function cancelRegistrationAction(form: FormData) {
  const principal = await requirePrincipal();
  const result = await invoke<{ promoted: string | null }>(await getDb(), principal, "registration.cancel", { registrationId: text(form, "registrationId") });
  done(returnTo(form, `/events/${text(form, "eventId")}`), result, result.status === "ok" ? (result.output.promoted ? "Cancelled. The next person on the waitlist now has the place." : "Cancelled") : undefined);
}

export async function leadValueAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "lead.set_value", { leadId: text(form, "leadId"), pipelineValue: num(form, "pipelineValue") }));
}

export async function playbookAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/settings", await invoke(await getDb(), principal, "playbook.set", { text: String(form.get("text") ?? "").replace(/\r\n/g, "\n") }), "Playbook saved. Agents use it from their next run.");
}

export async function webhookCreateAction(form: FormData) {
  const principal = await requirePrincipal();
  const events = (text(form, "events") ?? "*").split(/[\s,]+/).filter(Boolean);
  const result = await invoke<{ secret: string }>(await getDb(), principal, "webhook.create", { url: text(form, "url"), events });
  // The signing secret is shown once: it rides in a one-minute cookie rather than in the address bar.
  if (result.status === "ok") (await cookies()).set("eventos_flash", result.output.secret, { httpOnly: true, sameSite: "strict", path: "/settings", maxAge: 60 });
  done("/settings", result, "Connected");
}

export async function webhookRemoveAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/settings", await invoke(await getDb(), principal, "webhook.remove", { webhookId: text(form, "webhookId") }), "Disconnected");
}

/* The guest's own page. The link is the credential, so these run as the Public site account. */

async function guestPath(db: Awaited<ReturnType<typeof getDb>>, registrationId: string) {
  const { registration } = await import("@/db/schema");
  const [row] = await db.select({ slug: event.slug }).from(registration).innerJoin(event, eq(event.id, registration.eventId)).where(eq(registration.id, registrationId));
  if (!row) redirect("/");
  return `/e/${row.slug}/pass/${registrationId}`;
}

export async function rsvpAction(form: FormData) {
  const db = await getDb();
  const registrationId = text(form, "registrationId") ?? "";
  const path = await guestPath(db, registrationId);
  const result = await invoke(db, await servicePrincipal(db, "Public site"), "registration.rsvp", { registrationId, answer: text(form, "answer"), answers: answersFrom(form) });
  deliverSoon();
  redirect(result.status === "ok" ? path : `${path}?notice=${encodeURIComponent(explain(result))}`);
}

export async function guestCancelAction(form: FormData) {
  const db = await getDb();
  const registrationId = text(form, "registrationId") ?? "";
  const path = await guestPath(db, registrationId);
  const result = await invoke(db, await servicePrincipal(db, "Public site"), "registration.cancel", { registrationId });
  deliverSoon();
  redirect(result.status === "ok" ? path : `${path}?notice=${encodeURIComponent(explain(result))}`);
}

export async function surveyAction(form: FormData) {
  const db = await getDb();
  const registrationId = text(form, "registrationId") ?? "";
  const path = await guestPath(db, registrationId);
  const result = await invoke(db, await servicePrincipal(db, "Public site"), "survey.submit", { registrationId, score: Number(text(form, "score")), comment: text(form, "comment") });
  redirect(result.status === "ok" ? `${path}?thanks=1` : `${path}?notice=${encodeURIComponent(explain(result))}`);
}

/** Remove a person and everything held about them. The tick box on the form is the confirmation. */
export async function erasePersonAction(form: FormData) {
  const principal = await requirePrincipal();
  const result = await invoke<{ registrations: number; leads: number; messages: number }>(await getDb(), principal, "contact.erase", { email: text(form, "email"), confirm: form.get("confirm") === "on" });
  done("/settings", result, result.status === "ok" ? `Removed, with ${result.output.registrations} registration(s), ${result.output.leads} lead(s) and ${result.output.messages} message(s).` : undefined);
}
