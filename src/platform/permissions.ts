/** The permission catalogue. Roles are bundles of these; tools each require exactly one. */
export const PERMISSIONS = [
  "event.read", "event.write", "event.publish", "session.write",
  "contact.read", "contact.write", "registration.write", "checkin.write",
  "lead.write", "message.send", "task.write", "note.write", "approval.decide",
  "agent.run", "admin.manage", "account.self", "consent.write",
  /** Seeing things, where seeing is not for everyone: budgets and pipeline, and the ledger of who did what. */
  "insights.read", "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];
const without = (...drop: Permission[]) => all.filter((p) => !drop.includes(p));

/** Roles created at start-up. Agents get roles exactly as people do. */
export const DEFAULT_ROLES: Record<string, Permission[]> = {
  admin: all,
  organiser: without("admin.manage"),
  sales: ["event.read", "contact.read", "contact.write", "lead.write", "note.write", "account.self", "insights.read"],
  desk: ["event.read", "contact.read", "checkin.write", "account.self"],
  /** The public registration page acts as this service account. */
  public_site: ["registration.write", "consent.write"],
  /** Built-in rules (confirmations, starting agent runs) act as this one. */
  system: ["message.send", "task.write", "agent.run"],
  agent_builder: ["event.read", "event.write", "event.publish", "session.write", "task.write", "note.write"],
  agent_lead: ["event.read", "contact.read", "lead.write", "message.send", "task.write", "note.write"],
  agent_analyst: ["event.read", "contact.read", "note.write"],
  agent_outreach: ["event.read", "message.send", "note.write"],
  /** Talks to guests on the public page: reads public event details, hands questions to the team. */
  agent_concierge: ["event.read", "task.write"],
};

/** Roles a person can be given from the Team screen. */
export const HUMAN_ROLES = ["admin", "organiser", "sales", "desk"] as const;
