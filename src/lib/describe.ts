/** Says what a tool call did, in the words an organiser would use. Used by Activity, Today and agent trails. */
type Input = Record<string, unknown>;
const q = (v: unknown) => (typeof v === "string" && v ? `“${v.length > 60 ? `${v.slice(0, 57)}…` : v}”` : "");
const SEGMENT: Record<string, string> = { all: "everyone registered", not_checked_in: "guests not yet checked in", checked_in: "checked-in guests", invited: "invited guests" };

const VERBS: Record<string, (i: Input) => string> = {
  "event.create": (i) => `created the event ${q(i.name)}`,
  "event.get": () => "read an event",
  "event.public_info": () => "looked up an event's public details",
  "event.set_status": (i) => `set an event to ${i.status}`,
  "session.create": (i) => `added the session ${q(i.title)}`,
  "session.add_speaker": () => "added a speaker to a session",
  "form.add_field": (i) => `added the question ${q(i.label)}`,
  "form.remove_field": () => "removed a question",
  "contact.upsert": (i) => `saved the contact ${[i.firstName, i.lastName].filter(Boolean).join(" ")}`,
  "contact.unsubscribe": () => "recorded an unsubscribe",
  "registration.create": () => "registered a guest",
  "registration.register_guest": (i) => `registered ${i.firstName ?? "a guest"} from the public page`,
  "registration.check_in": () => "checked a guest in",
  "registration.export": () => "exported the guest list",
  "lead.capture": () => "captured a lead",
  "lead.get": () => "read a lead",
  "lead.score": (i) => `scored a lead ${i.score}`,
  "message.send": (i) => `sent ${i.channel === "whatsapp" ? "a WhatsApp message" : "an email"} ${q(i.subject)}`,
  "campaign.send": (i) => `messaged ${SEGMENT[String(i.segment)] ?? "guests"} ${q(i.subject)}`,
  "task.create": (i) => `added the to-do ${q(i.shortDescription)}`,
  "task.set_state": (i) => `marked a to-do ${String(i.state).replace("_", " ")}`,
  "note.add": () => "wrote a note",
  "agent.run": (i) => `asked ${i.agent} to work on ${q(i.goal)}`,
  "user.create": (i) => `added ${i.name} to the team`,
  "user.set_password": () => "reset a password",
  "account.change_password": () => "changed their password",
  "event.update": () => "updated an event's details",
  "event.clone": (i) => `started ${q(i.name)} from an existing event`,
  "budget.set_item": (i) => `set the budget line ${q(i.label)}`,
  "budget.remove_item": () => "removed a budget line",
  "guest.import": (i) => `put ${Array.isArray(i.rows) ? i.rows.length : "some"} people on a guest list`,
  "registration.rsvp": (i) => `recorded a ${i.answer} to an invitation`,
  "registration.cancel": () => "cancelled a guest's place",
  "survey.submit": (i) => `recorded a survey answer of ${i.score}`,
  "lead.set_value": () => "set what a lead could be worth",
  "webhook.create": () => "connected another system",
  "webhook.remove": () => "disconnected another system",
  "playbook.set": () => "updated the playbook",
  "event.cancel": () => "cancelled an event",
  "campaign.unschedule": () => "stopped a scheduled message",
  "contact.update": () => "corrected a person's details",
  "registration.check_in_by_number": () => "checked a guest in from their pass",
  "account.request_reset": () => "asked for a password reset link",
  "account.reset_password": () => "set a new password from a reset link",
  "registration.approve": () => "approved a guest",
  "registration.decline": () => "turned a guest down",
  "registration.undo_check_in": () => "took back a check-in",
  "registration.walk_in": (i) => `checked in ${i.firstName ?? "a guest"} as a walk-in`,
  "user.set_role": (i) => `made a team member ${/^[aeiou]/.test(String(i.role)) ? "an" : "a"} ${i.role}`,
  "user.set_active": (i) => `switched a team member's account ${i.active ? "back on" : "off"}`,
  "contact.export": () => "exported a person's data",
  "contact.erase": () => "erased a person's data",
  "policy.set": (i) => `set ${i.tool} to ${i.level === "auto" ? "automatic" : "ask first"} for an agent`,
};

const BASE: Record<string, string> = {
  created: "create", read: "read", looked: "look", set: "set", added: "add", removed: "remove", saved: "save", recorded: "record", registered: "register",
  checked: "check", exported: "export", captured: "capture", scored: "score", sent: "send", messaged: "message", marked: "mark", wrote: "write", asked: "ask",
  reset: "reset", changed: "change", ran: "run", updated: "update", started: "start", erased: "erase", approved: "approve", turned: "turn", stopped: "stop", corrected: "correct", took: "take", made: "make", switched: "switch", put: "put", cancelled: "cancel", connected: "connect", disconnected: "disconnect",
};

export function sentence(tool: string, input: unknown, status: string): string {
  const did = (VERBS[tool] ?? (() => `ran ${tool}`))((input ?? {}) as Input).trim();
  if (status === "ok") return did;
  const [first, ...rest] = did.split(" ");
  const todo = [BASE[first] ?? first, ...rest].join(" ");
  if (status === "held") return `asked to ${todo}`;
  if (status === "denied") return `was not allowed to ${todo}`;
  return `tried to ${todo}, which did not go through`;
}

export const segmentLabel = (s: string) => SEGMENT[s] ?? s;

export function ago(date: Date, now = Date.now()): string {
  const s = Math.round((now - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** "in 18 days", "tomorrow", "today", "3 days ago". */
export function countdown(date: Date | null, now = Date.now()): string {
  if (!date) return "no date yet";
  const d = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const TOOL_LABEL: Record<string, string> = {
  "event.get": "Read the event", "event.public_info": "Read the public event details", "event.set_status": "Change the event's status", "session.create": "Add a session",
  "task.create": "Add a to-do", "note.add": "Write a note", "lead.get": "Read the lead", "lead.score": "Score the lead", "message.send": "Send a message", "campaign.send": "Message a group of guests",
};
/** An agent's recorded action ("lead.score → done") in plain words. */
export function stepLabel(line: string): string {
  const m = line.match(/^([a-z_.]+) → (.*)$/);
  if (!m) return line;
  const what = TOOL_LABEL[m[1]] ?? m[1];
  if (m[2] === "done") return what;
  const held = m[2].match(/^held for approval as (\w+)/);
  return held ? `${what}: waiting for your approval (${held[1]})` : `${what}: ${m[2]}`;
}
