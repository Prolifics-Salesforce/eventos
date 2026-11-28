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
import { currentGuest, GUEST_COOKIE, GUEST_MAX_AGE, guestCookieValue } from "@/lib/guest";
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
  return value && /^\/(events|inbox|runs|agents|team|today)[\w\-/?=&%.+]*$/.test(value) ? value : fallback;
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
  const result = await invoke<{ pin: string; vip?: boolean }>(await getDb(), principal, "registration.check_in", { registrationId: text(form, "registrationId") });
  done(returnTo(form, `/events/${text(form, "eventId")}`), result, result.status === "ok" ? `${result.output.vip ? "VIP guest. Let their host know. " : ""}Checked in. PIN ${result.output.pin}` : undefined);
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
  const due = text(form, "dueAt");
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "task.create", {
    eventId, shortDescription: text(form, "shortDescription"), dueAt: due ? zonedToIso(due, text(form, "timezone") ?? DEFAULT_TIMEZONE) : undefined,
  }));
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
  const result = await invoke<{ status: string; registrationId?: string }>(db, await servicePrincipal(db, "Public site"), "registration.register_guest", {
    eventSlug: slug, email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"),
    phone: text(form, "phone"), whatsappOptIn: form.get("whatsappOptIn") === "on", answers: answersFrom(form),
    referredBy: /^REG\d{1,12}$/i.test(text(form, "ref") ?? "") ? text(form, "ref") : undefined,
  });
  deliverSoon();
  // Someone who has just registered is shown their pass straight away, rather than being told to wait for an email.
  if (result.status === "ok" && result.output.registrationId) redirect(`${path}/pass/${result.output.registrationId}?welcome=1`);
  const outcome = result.status === "ok" ? ({ waitlisted: "wait", pending: "pending", existing: "already" } as Record<string, string>)[result.output.status] ?? "1" : "";
  redirect(result.status === "ok" ? `${path}?done=${outcome}` : `${path}?notice=${encodeURIComponent(explain(result))}`);
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
    sendAt: text(form, "sendAt") ? zonedToIso(text(form, "sendAt")!, text(form, "timezone") ?? DEFAULT_TIMEZONE) : undefined,
  });
  // Ticking "keep this message" saves it for next time as well as sending it.
  if (result.status === "ok" && text(form, "templateName")) {
    await invoke(await getDb(), principal, "template.save", { name: text(form, "templateName"), subject: text(form, "subject"), body: text(form, "body") });
  }
  done(returnTo(form, `/events/${eventId}`), result, result.status === "ok" ? `${text(form, "sendAt") ? "Scheduled" : "Queued"} for ${result.output.queued} guest(s); ${result.output.skipped} skipped for lack of consent${text(form, "key") && result.output.queued === 0 ? ". Everyone on the list has already had this invitation." : ""}` : undefined);
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
    requireApproval: form.get("requireApproval") === "on",
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

/** The Details form on an event's Setup tab. An emptied box clears that detail; name and address cannot be emptied. */
export async function updateDetailsAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const timezone = text(form, "timezone") ?? DEFAULT_TIMEZONE;
  const when = (key: string) => { const v = text(form, key); return v ? zonedToIso(v, timezone) : null; };
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "event.update", {
    eventId, name: text(form, "name"), slug: text(form, "slug"), startsAt: when("startsAt"), endsAt: when("endsAt"), hostName: text(form, "hostName") ?? null, onlineUrl: text(form, "onlineUrl") ?? null,
    venue: text(form, "venue") ?? null, locationUrl: text(form, "locationUrl") ?? null, coverImageUrl: text(form, "coverImageUrl") ?? null,
    description: text(form, "description")?.replace(/\r\n/g, "\n") ?? null, brief: text(form, "brief")?.replace(/\r\n/g, "\n") ?? null,
  }), "Saved");
}

export async function cancelEventAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const back = returnTo(form, `/events/${eventId}`);
  if (form.get("confirm") !== "on") redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent("Tick the box to confirm the cancellation.")}`);
  const result = await invoke<{ told: number }>(await getDb(), principal, "event.cancel", { eventId, message: text(form, "message") });
  done(back, result, result.status === "ok" ? `The event is cancelled. ${result.output.told} guest(s) are being emailed.` : undefined);
}

export async function decideGuestAction(form: FormData) {
  const principal = await requirePrincipal();
  const approve = text(form, "decision") === "approve";
  const result = await invoke<{ status: string }>(await getDb(), principal, approve ? "registration.approve" : "registration.decline", { registrationId: text(form, "registrationId") });
  done(returnTo(form, `/events/${text(form, "eventId")}`), result, result.status === "ok" ? (approve ? (result.output.status === "waitlisted" ? "Approved. The event is full, so they are on the waitlist." : "Approved. They have been emailed their pass.") : "Turned down. They have been told.") : undefined);
}

export async function undoCheckInAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "registration.undo_check_in", { registrationId: text(form, "registrationId") }), "Check-in taken back");
}

export async function walkInAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const result = await invoke<{ pin: string; alreadyCheckedIn: boolean }>(await getDb(), principal, "registration.walk_in", {
    eventId, email: text(form, "email"), firstName: text(form, "firstName"), lastName: text(form, "lastName"),
  });
  done(returnTo(form, `/events/${eventId}/desk`), result, result.status === "ok" ? `${result.output.alreadyCheckedIn ? "Already checked in" : "Checked in"}. PIN ${result.output.pin}` : undefined);
}

export async function setRoleAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/team", await invoke(await getDb(), principal, "user.set_role", { userId: text(form, "userId"), role: text(form, "role") }), "Role changed");
}

export async function setActiveAction(form: FormData) {
  const principal = await requirePrincipal();
  const active = text(form, "active") === "true";
  done("/team", await invoke(await getDb(), principal, "user.set_active", { userId: text(form, "userId"), active }), active ? "Account switched back on" : "Account switched off. They have been signed out.");
}

/** The Emails form on an event's Setup tab. */
export async function updateEmailsAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "event.update", {
    eventId, reminders: form.get("reminders") === "on", feedbackEmail: form.get("feedbackEmail") === "on",
    confirmationNote: text(form, "confirmationNote")?.replace(/\r\n/g, "\n") ?? null,
  }), "Saved");
}

export async function unscheduleAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const result = await invoke<{ stopped: number }>(await getDb(), principal, "campaign.unschedule", { eventId, key: text(form, "key") });
  done(returnTo(form, `/events/${eventId}`), result, result.status === "ok" ? `Stopped. ${result.output.stopped} message(s) will not be sent.` : undefined);
}

/** One correction to a guest's details, from the Guests tab. */
export async function updateGuestAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "contact.update", {
    contactId: text(form, "contactId"), firstName: text(form, "firstName"), lastName: text(form, "lastName") ?? null,
    email: text(form, "email"), phone: text(form, "phone") ?? null, title: text(form, "title") ?? null,
  }), "Saved");
}

const BULK: Record<string, { tool: string; done: string }> = {
  approve: { tool: "registration.approve", done: "approved" }, decline: { tool: "registration.decline", done: "turned down" },
  check_in: { tool: "registration.check_in", done: "checked in" }, cancel: { tool: "registration.cancel", done: "cancelled" },
};

/** The same thing done to every ticked guest. Each one goes through its tool, so each is checked and recorded on its own. */
export async function bulkGuestsAction(form: FormData) {
  const principal = await requirePrincipal();
  const back = returnTo(form, `/events/${text(form, "eventId")}`);
  const join = back.includes("?") ? "&" : "?";
  const choice = BULK[text(form, "bulk") ?? ""];
  const ids = form.getAll("ids").map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!choice || ids.length === 0) redirect(`${back}${join}notice=${encodeURIComponent(choice ? "Tick at least one guest first." : "Choose what to do with the ticked guests.")}`);
  const db = await getDb();
  let worked = 0;
  const refused = new Map<string, number>();
  for (const registrationId of ids) {
    const result = await invoke<{ changed?: boolean; alreadyCheckedIn?: boolean }>(db, principal, choice.tool, { registrationId });
    // "Nothing to do" (already checked in, not waiting for approval) is not a failure, but it is not counted as done either.
    if (result.status === "ok" && result.output.changed !== false && result.output.alreadyCheckedIn !== true) worked++;
    else { const why = result.status === "ok" ? "nothing to change" : explain(result); refused.set(why, (refused.get(why) ?? 0) + 1); }
  }
  deliverSoon();
  revalidatePath(back.split("?")[0]);
  const skipped = [...refused].map(([why, n]) => `${n} skipped (${why})`).join(", ");
  redirect(`${back}${join}ok=${encodeURIComponent(`${worked} ${choice.done}${skipped ? `; ${skipped}` : ""}.`)}`);
}

/** A pass scanned at the door. Goes back to the desk with the camera still on, ready for the next guest. */
export async function scanCheckInAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const result = await invoke<{ name: string; pin: string; alreadyCheckedIn: boolean; vip?: boolean }>(await getDb(), principal, "registration.check_in_by_number", { eventId, number: text(form, "number") });
  done(`/events/${eventId}/desk?scan=1`, result, result.status === "ok" ? `${result.output.vip ? "VIP guest. Let their host know. " : ""}${result.output.name}: ${result.output.alreadyCheckedIn ? "already checked in" : "checked in"}. PIN ${result.output.pin}` : undefined);
}

/* Forgotten passwords. Nobody is signed in, so these run as the Public site account. */

export async function requestResetAction(form: FormData) {
  const db = await getDb();
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  // Five requests an hour from one connection: enough for a typo or two, not enough to fill someone's inbox.
  if ((await limitHit(db, `reset:${address.slice(0, 80)}`, 3600_000)) <= 5) {
    await invoke(db, await servicePrincipal(db, "Public site"), "account.request_reset", { email: text(form, "email") ?? "" });
    deliverSoon();
  }
  redirect("/reset?sent=1");
}

export async function completeResetAction(form: FormData) {
  const token = text(form, "token") ?? "";
  const db = await getDb();
  const result = await invoke(db, await servicePrincipal(db, "Public site"), "account.reset_password", { token, password: String(form.get("password") ?? "") });
  if (result.status === "ok") redirect("/signin?ok=" + encodeURIComponent("Password changed. Sign in with the new one."));
  // A password that is too short keeps the link alive; a dead link sends them to ask for another.
  redirect(result.status === "invalid" ? `/reset/${encodeURIComponent(token)}?notice=${encodeURIComponent("Use at least 10 characters.")}` : `/reset?notice=${encodeURIComponent(explain(result))}`);
}

/* A guest's own page. Guests have no password: a link sent to their email signs them in. */

export async function guestLinkAction(form: FormData) {
  const db = await getDb();
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  // Five requests an hour from one connection.
  if ((await limitHit(db, `guestlink:${address.slice(0, 80)}`, 3600_000)) <= 5) {
    const result = await invoke<{ link?: string }>(db, await servicePrincipal(db, "Public site"), "guest.request_link", { email: text(form, "email") ?? "" });
    deliverSoon();
    // No mail server on this site: the link cannot be emailed, so the guest is taken straight to it.
    if (result.status === "ok" && result.output.link) redirect(`${result.output.link}?direct=1`);
  }
  redirect("/my?sent=1");
}

export async function guestEnterAction(form: FormData) {
  const db = await getDb();
  const result = await invoke<{ contactId: string }>(db, await servicePrincipal(db, "Public site"), "guest.sign_in", { token: text(form, "token") ?? "" });
  if (result.status !== "ok") redirect(`/my?notice=${encodeURIComponent(result.status === "error" ? result.message : "That link is not valid. Ask for a new one.")}`);
  const secure = (await headers()).get("x-forwarded-proto") === "https" || (process.env.APP_URL ?? "").startsWith("https://");
  (await cookies()).set(GUEST_COOKIE, await guestCookieValue(db, result.output.contactId), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: GUEST_MAX_AGE });
  redirect("/my");
}

export async function guestSignOutAction() {
  (await cookies()).delete(GUEST_COOKIE);
  redirect("/my");
}

/** A signed-in guest joining another event with the details already held for them. */
export async function guestRegisterAction(form: FormData) {
  const guest = await currentGuest();
  if (!guest) redirect("/my");
  const slug = text(form, "eventSlug") ?? "";
  const db = await getDb();
  const result = await invoke<{ status: string; registrationId?: string }>(db, await servicePrincipal(db, "Public site"), "registration.register_guest", {
    eventSlug: slug, email: guest.email, firstName: guest.firstName, lastName: guest.lastName ?? undefined, phone: guest.phone ?? undefined,
    whatsappOptIn: Boolean(guest.whatsappOptInAt), answers: {},
  });
  deliverSoon();
  if (result.status === "ok" && result.output.registrationId) redirect(`/e/${slug}/pass/${result.output.registrationId}?welcome=1`);
  if (result.status === "ok") redirect("/my");
  // The event asks questions this page cannot answer for them: send them to its own form.
  if (result.status === "error" && (result.code === "missing_answer" || result.code === "bad_answer")) redirect(`/e/${slug}`);
  redirect(`/my?tab=discover&notice=${encodeURIComponent(explain(result))}`);
}

export async function guestProfileAction(form: FormData) {
  const guest = await currentGuest();
  if (!guest) redirect("/my");
  const db = await getDb();
  const result = await invoke(db, await servicePrincipal(db, "Public site"), "guest.update_profile", {
    contactId: guest.id, firstName: text(form, "firstName"), lastName: text(form, "lastName") ?? null, title: text(form, "title") ?? null,
    phone: text(form, "phone") ?? null, emailUpdates: form.get("emailUpdates") === "on", whatsappOptIn: form.get("whatsappOptIn") === "on",
  });
  redirect(result.status === "ok" ? `/my?tab=profile&ok=${encodeURIComponent("Saved")}` : `/my?tab=profile&notice=${encodeURIComponent(explain(result))}`);
}

/* Sessions on the agenda */

export async function updateSessionAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const startsAt = text(form, "startsAt");
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "session.update", {
    sessionId: text(form, "sessionId"), title: text(form, "title"), track: text(form, "track") ?? null, room: text(form, "room") ?? null,
    startsAt: startsAt ? zonedToIso(startsAt, text(form, "timezone") ?? DEFAULT_TIMEZONE) : null,
  }), "Session saved");
}

export async function removeSessionAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "session.remove", { sessionId: text(form, "sessionId") }), "Session removed");
}

export async function removeSpeakerAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "session.remove_speaker", { sessionId: text(form, "sessionId"), contactId: text(form, "contactId") }), "Speaker removed");
}

export async function setVipAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "registration.set_vip", { registrationId: text(form, "registrationId"), vip: text(form, "vip") === "true" }));
}

/** A reminder to yourself to get back to a lead, due at the end of the day chosen. */
export async function followUpAction(form: FormData) {
  const principal = await requirePrincipal();
  const eventId = text(form, "eventId")!;
  const day = text(form, "dueOn");
  done(returnTo(form, `/events/${eventId}`), await invoke(await getDb(), principal, "task.create", {
    eventId, leadId: text(form, "leadId"), assignedTo: principal.id, shortDescription: text(form, "shortDescription"),
    dueAt: day ? zonedToIso(`${day}T18:00`, text(form, "timezone") ?? DEFAULT_TIMEZONE) : undefined,
  }), "Follow-up added");
}

export async function removeTemplateAction(form: FormData) {
  const principal = await requirePrincipal();
  done(returnTo(form, `/events/${text(form, "eventId")}`), await invoke(await getDb(), principal, "template.remove", { templateId: text(form, "templateId") }), "Saved message deleted");
}

/* The team */

export async function inviteUserAction(form: FormData) {
  const principal = await requirePrincipal();
  const result = await invoke<{ link?: string }>(await getDb(), principal, "user.invite", { name: text(form, "name"), email: text(form, "email"), role: text(form, "role") });
  deliverSoon();
  // With no mail server the link cannot be emailed, so it is shown once to the administrator to pass on.
  if (result.status === "ok" && result.output.link) (await cookies()).set("eventos_flash", result.output.link, { httpOnly: true, sameSite: "strict", path: "/team", maxAge: 60 });
  done("/team", result, result.status === "ok" ? (result.output.link ? "Invited" : "Invited. They have been emailed a link to choose their password.") : undefined);
}

export async function setEmailAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/team", await invoke(await getDb(), principal, "user.set_email", { userId: text(form, "userId"), email: text(form, "email") }), "Email changed");
}

export async function apiKeyCreateAction(form: FormData) {
  const principal = await requirePrincipal();
  const result = await invoke<{ key: string }>(await getDb(), principal, "apikey.create", { name: text(form, "name") });
  if (result.status === "ok") (await cookies()).set("eventos_flash", result.output.key, { httpOnly: true, sameSite: "strict", path: "/settings", maxAge: 60 });
  done("/settings", result, "Key created");
}

export async function apiKeyRevokeAction(form: FormData) {
  const principal = await requirePrincipal();
  done("/settings", await invoke(await getDb(), principal, "apikey.revoke", { keyId: text(form, "keyId") }), "Key revoked");
}
