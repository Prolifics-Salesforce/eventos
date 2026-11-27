/**
 * The single data model.
 *
 * One instance serves one organisation, so there is no tenant column anywhere.
 * Every module (registration, sessions, leads, messaging, agents) reads and
 * writes these same tables; nothing keeps a private copy of a contact or an
 * event. Three conventions hold it together, borrowed from how ServiceNow
 * structures its platform:
 *
 *  1. Every business record carries the same system fields (`record()` below):
 *     sys_id, who/when created and updated, and a `custom` bag for fields an
 *     administrator adds through sys_dictionary without a migration.
 *  2. Work is one table. A to-do, an approval and an agent run are all rows in
 *     `task`, told apart by `task_type`, so one inbox, one SLA and one audit
 *     trail cover them all.
 *  3. Platform tables are prefixed `sys_`. Business tables are not.
 */
import { sql } from "drizzle-orm";
import {
  bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** System fields shared by every business record. */
const record = () => ({
  id: uuid("sys_id").primaryKey().defaultRandom(),
  createdAt: ts("sys_created_at").notNull().defaultNow(),
  createdBy: uuid("sys_created_by"),
  updatedAt: ts("sys_updated_at").notNull().defaultNow(),
  updatedBy: uuid("sys_updated_by"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
});

/* ───────────────────────────── platform ───────────────────────────── */

export type PrincipalKind = "human" | "agent" | "service";

/** People, agents and service accounts are all users: one permission model. */
export const sysUser = pgTable("sys_user", {
  id: uuid("sys_id").primaryKey().defaultRandom(),
  kind: text("kind").$type<PrincipalKind>().notNull().default("human"),
  name: text("name").notNull(),
  email: text("email").unique(),
  /** scrypt. Only people have one; agents and services never sign in. */
  passwordHash: text("password_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("sys_created_at").notNull().defaultNow(),
});

export const sysRole = pgTable("sys_role", {
  id: uuid("sys_id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});

export const sysUserRole = pgTable(
  "sys_user_role",
  {
    userId: uuid("user_id").notNull().references(() => sysUser.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => sysRole.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/** Browser sessions. The cookie holds a random token; only its hash is stored. */
export const sysSession = pgTable("sys_session", {
  id: uuid("sys_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => sysUser.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("sys_created_at").notNull().defaultNow(),
});

export const sysApiKey = pgTable("sys_api_key", {
  id: uuid("sys_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => sysUser.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** SHA-256 of the key. The key itself is shown once and never stored. */
  hash: text("hash").notNull().unique(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("sys_created_at").notNull().defaultNow(),
});

export type AutonomyLevel = "suggest" | "approve" | "auto";

/**
 * The autonomy dial. A row overrides the default for one agent (or all agents
 * when user_id is null) on one tool (or all tools when tool is "*").
 */
export const sysPolicy = pgTable(
  "sys_policy",
  {
    id: uuid("sys_id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => sysUser.id, { onDelete: "cascade" }),
    tool: text("tool").notNull().default("*"),
    level: text("level").$type<AutonomyLevel>().notNull(),
    /** Autonomous runs allowed per rolling 24 hours; beyond it, calls are held for approval. */
    dailyCap: integer("daily_cap"),
  },
  (t) => [index("sys_policy_lookup").on(t.userId, t.tool)],
);

/** Instance settings and once-only markers (a secret, "reminder sent for event X"). */
export const sysProperty = pgTable("sys_property", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: ts("sys_created_at").notNull().defaultNow(),
});

/** Human-readable record numbers: EVT0000001, REG0000042. */
export const sysNumber = pgTable("sys_number", {
  prefix: text("prefix").primaryKey(),
  next: integer("next").notNull().default(1),
});

export type AuditStatus = "ok" | "denied" | "held" | "invalid" | "error";

/** Append-only ledger: every tool call, whoever made it and however it ended. */
export const sysAudit = pgTable(
  "sys_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorId: uuid("actor_id").notNull(),
    actorKind: text("actor_kind").$type<PrincipalKind>().notNull(),
    /** The human who approved a held agent call, when there was one. */
    approvedBy: uuid("approved_by"),
    tool: text("tool").notNull(),
    status: text("status").$type<AuditStatus>().notNull(),
    input: jsonb("input"),
    result: jsonb("result"),
    error: text("error"),
    /** The agent_run task this call belonged to. */
    runId: uuid("run_id"),
  },
  (t) => [index("sys_audit_actor").on(t.actorId, t.tool, t.at)],
);

/** Domain events. Written in the same transaction as the change that caused them. */
export const sysEvent = pgTable(
  "sys_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id"),
    at: ts("at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("sys_event_pending").on(t.id).where(sql`${t.processedAt} is null`)],
);

export type Channel = "email" | "whatsapp" | "webhook";
export type OutboxStatus = "pending" | "sending" | "sent" | "failed";

/** Everything that leaves the instance goes through here: queued, retried, traceable. */
export const sysOutbox = pgTable(
  "sys_outbox",
  {
    id: uuid("sys_id").primaryKey().defaultRandom(),
    channel: text("channel").$type<Channel>().notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    contactId: uuid("contact_id"),
    eventId: uuid("event_id"),
    status: text("status").$type<OutboxStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    sentAt: ts("sent_at"),
    lastError: text("last_error"),
    /** Stops the same message being queued twice. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: ts("sys_created_at").notNull().defaultNow(),
    createdBy: uuid("sys_created_by"),
  },
  (t) => [index("sys_outbox_due").on(t.status, t.nextAttemptAt)],
);

/** Describes fields, including custom ones kept in each record's `custom` bag. */
export const sysDictionary = pgTable(
  "sys_dictionary",
  {
    id: uuid("sys_id").primaryKey().defaultRandom(),
    tableName: text("table_name").notNull(),
    columnName: text("column_name").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull().default("string"),
    choices: jsonb("choices").$type<string[]>(),
    isCustom: boolean("is_custom").notNull().default(true),
  },
  (t) => [uniqueIndex("sys_dictionary_field").on(t.tableName, t.columnName)],
);

/** Activity stream: comments and work notes on any record. */
export const sysJournal = pgTable(
  "sys_journal",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id").notNull(),
    authorId: uuid("author_id"),
    kind: text("kind").$type<"comment" | "work_note" | "system">().notNull().default("work_note"),
    body: text("body").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("sys_journal_record").on(t.tableName, t.recordId)],
);

/* ───────────────────────────── business ───────────────────────────── */

export const account = pgTable("account", {
  ...record(),
  name: text("name").notNull(),
  domain: text("domain").unique(),
  industry: text("industry"),
});

/** One row per person, across every event, whatever role they play. */
export const contact = pgTable("contact", {
  ...record(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  /** Stored lower-case. */
  email: text("email").notNull().unique(),
  /** E.164, e.g. +919876543210. Needed for WhatsApp. */
  phone: text("phone"),
  title: text("title"),
  accountId: uuid("account_id").references(() => account.id, { onDelete: "set null" }),
  emailOptOutAt: ts("email_opt_out_at"),
  /** WhatsApp is opt-in: no timestamp, no message. */
  whatsappOptInAt: ts("whatsapp_opt_in_at"),
});

export type EventKind = "booth" | "field" | "conference";
/** cancelled: called off. The public page says so and registration is shut; reached only through event.cancel, which tells the guests. */
export type EventStatus = "draft" | "live" | "closed" | "archived" | "cancelled";

export const event = pgTable("event", {
  ...record(),
  number: text("number").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").$type<EventKind>().notNull(),
  status: text("status").$type<EventStatus>().notNull().default("draft"),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  venue: text("venue"),
  /** The organiser's goal in their own words. Agents plan from this. */
  brief: text("brief"),
  /** Places available. Beyond it, new registrations join the waitlist. Null means no limit. */
  capacity: integer("capacity"),
  targetRegistrations: integer("target_registrations"),
  targetLeads: integer("target_leads"),
  currency: text("currency").notNull().default("INR"),
  /** What guests read on the public page. Plain text; blank lines make paragraphs. */
  description: text("description"),
  /** An https address of a picture shown at the top of the public page. */
  coverImageUrl: text("cover_image_url"),
  /** An https link to a map of the venue. */
  locationUrl: text("location_url"),
  /** When true, a guest who registers waits as "pending" until someone on the team approves them. */
  requireApproval: boolean("require_approval").notNull().default(false),
});

/** What an event is expected to cost and what it did cost, line by line. Whole currency units. */
export const budgetItem = pgTable(
  "budget_item",
  {
    ...record(),
    eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    category: text("category"),
    planned: integer("planned").notNull().default(0),
    actual: integer("actual"),
  },
  (t) => [index("budget_item_event").on(t.eventId)],
);

/** One answer per guest to "how likely are you to recommend this event?" (0 to 10). */
export const surveyResponse = pgTable("survey_response", {
  ...record(),
  eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
  registrationId: uuid("registration_id").notNull().unique(),
  score: integer("score").notNull(),
  comment: text("comment"),
});

/** Other systems (a CRM, a data warehouse) that are told when things happen here. */
export const webhook = pgTable("webhook", {
  ...record(),
  url: text("url").notNull(),
  /** Signs every delivery so the receiver can check it came from this instance. */
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
});

/** Conference sessions. A booth event simply has none. */
export const eventSession = pgTable(
  "event_session",
  {
    ...record(),
    eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    abstract: text("abstract"),
    track: text("track"),
    room: text("room"),
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    capacity: integer("capacity"),
  },
  (t) => [index("event_session_event").on(t.eventId)],
);

/** A speaker is a contact with a role on a session, not a separate kind of person. */
export const sessionSpeaker = pgTable(
  "session_speaker",
  {
    sessionId: uuid("session_id").notNull().references(() => eventSession.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("speaker"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.contactId] })],
);

export type FormPurpose = "registration" | "lead";
/** terms: a statement the guest must tick to agree to. The others are text with a fitting check and keyboard. */
export type FieldType = "text" | "select" | "checkbox" | "phone" | "company" | "website" | "social" | "terms";

/** Extra questions an organiser adds to an event's registration form or lead capture. */
export const formField = pgTable(
  "form_field",
  {
    ...record(),
    eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<FormPurpose>().notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").$type<FieldType>().notNull().default("text"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("form_field_key").on(t.eventId, t.purpose, t.key)],
);

/** pending: asked for a place at an event that approves each guest, and not yet decided. */
export type RegistrationStatus = "invited" | "pending" | "registered" | "waitlisted" | "attended" | "declined" | "cancelled" | "no_show";

export const registration = pgTable(
  "registration",
  {
    ...record(),
    number: text("number").notNull().unique(),
    eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    status: text("status").$type<RegistrationStatus>().notNull().default("registered"),
    source: text("source"),
    pin: text("pin"),
    checkedInAt: ts("checked_in_at"),
    checkedInBy: uuid("checked_in_by"),
  },
  (t) => [uniqueIndex("registration_once").on(t.eventId, t.contactId)],
);

/** A conversation captured at a booth or in the field. */
export const lead = pgTable(
  "lead",
  {
    ...record(),
    number: text("number").notNull().unique(),
    eventId: uuid("event_id").notNull().references(() => event.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    capturedBy: uuid("captured_by"),
    notes: text("notes"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    score: integer("score"),
    band: text("band").$type<"hot" | "warm" | "cold">(),
    /** What sales believes this conversation could be worth, in the event's currency. Entered by a person. */
    pipelineValue: integer("pipeline_value"),
  },
  (t) => [index("lead_event").on(t.eventId)],
);

export type TaskType = "task" | "approval" | "agent_run";
export type TaskState = "open" | "in_progress" | "awaiting_approval" | "done" | "rejected" | "cancelled" | "failed";

/** All work, human or agent. Extend by adding a task_type, not a table. */
export const task = pgTable(
  "task",
  {
    ...record(),
    number: text("number").notNull().unique(),
    taskType: text("task_type").$type<TaskType>().notNull().default("task"),
    shortDescription: text("short_description").notNull(),
    description: text("description"),
    state: text("state").$type<TaskState>().notNull().default("open"),
    priority: integer("priority").notNull().default(3),
    assignedTo: uuid("assigned_to"),
    eventId: uuid("event_id").references(() => event.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    dueAt: ts("due_at"),
    /** approval: { tool, input, requestedBy, reason }. agent_run: { goal, ... }. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    closedAt: ts("closed_at"),
    closedBy: uuid("closed_by"),
  },
  (t) => [index("task_inbox").on(t.taskType, t.state), index("task_event").on(t.eventId)],
);
