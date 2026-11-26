# EventOS

An AI-native event platform for B2B booths, field marketing and conferences.
One instance serves one organisation, on one data model.

## Run it

```
npm install
cp .env.example .env
npm run db:seed     # creates roles, an admin, three agents; prints an API key once
npm run dev         # http://localhost:3000 lists the registered tools
npm test            # the Phase 0 exit gate, against an embedded Postgres
```

With no `DATABASE_URL`, data lives in an embedded Postgres under `./.data`.
For a real instance, `docker compose up -d db` and set `DATABASE_URL`.

Call  tools:

```
curl -X POST localhost:3000/api/tools/event.create \
  -H "authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"name":"Partner Summit","kind":"conference"}'
```

## How it is built

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | The single data model. `sys_*` tables are the platform; the rest are business records sharing the same system fields |
| `src/platform/tools.ts` | The tool registry. `invoke()` is the only way to change data: validation, permission, autonomy dial, transaction, events, audit |
| `src/platform/events.ts` | Domain events, written with the change that caused them, delivered at least once |
| `src/platform/outbox.ts` | Everything leaving the instance (email, WhatsApp, webhooks): queued, retried, reclaimed after a crash |
| `src/platform/permissions.ts` | The permission catalogue and default roles, for people and agents alike |
| `src/tools/` | The tools themselves. Add a file, import it in `index.ts` |
| `tests/gate.test.ts` | Proves the same call by a person and an agent is permissioned and audited |

## Rules of the house

1. Nothing writes to the database except a tool handler.
2. A tool declares one permission and one risk. Agents are held for approval on `external` and `destructive` tools unless a `sys_policy` row says otherwise.
3. Handlers emit events and enqueue messages through `ctx`, never directly, so they commit or roll back with the change.
4. A schema change is a new migration: edit `schema.ts`, run `npm run db:generate`, commit the SQL.

## What works today

- **Events:** booth, field and conference events; draft, live, closed, archived; copy an event's setup to start the next one.
- **Guest lists:** paste a list, send invitations with a personal reply link, public registration at `/e/<slug>` with your own questions and the agenda, places and an automatic waitlist.
- **The guest's page:** one link that is the invitation reply, the pass with QR, the waitlist notice, a way to cancel, and the post-event question.
- **On the day:** phone-first door desk and booth lead capture, check-in with PIN, printable badges.
- **Conferences:** sessions and speakers, shown on the public page.
- **Messaging:** messages to a segment of guests, a confirmation on registration, a reminder the day before. Every email carries an unsubscribe link. Email goes out over SMTP once `SMTP_URL` is set.
- **Insights:** per event and across the programme: the funnel from list to lead, budget planned and actual, cost per attendee and per lead, pipeline entered by sales, return, and guest score.
- **Agents:** Builder, Lead Intelligence, Analyst and Outreach run through the same tools as people; the Concierge answers guests on the public page. Outward-facing actions wait in the Inbox, where you can reword a draft before approving it. The Agents screen sets what each may do alone. A playbook in Settings gives every agent your organisation's rules.
- **Team:** people with roles, password change and reset. Activity is the full ledger.
- **Other systems:** signed webhooks to a CRM or warehouse (Settings), and `/api/mcp` for other assistants.

On a Mac, double-click `start.command` to install, set up and start everything.

## Documentation

- `docs/TOOLS.md`: every tool, the permission it needs and whether an agent needs approval for it. Generated from the code.
- `docs/DATA-MODEL.md`: every table and column. Generated from the code.
- `docs/ROUTES.md`: every screen and endpoint and who can open it. Generated from the code.
- `docs/KNOWN-GAPS.md`: what this build does not do. Read it before using real data.

## Sample data

`npm run db:demo` (or double-click `load-sample-data.command` on a Mac) fills an empty instance with three
events, guests, sessions, leads, an agent run and approvals waiting in the Inbox. Stop the server first.
It does nothing if the instance already has events.

## Design

One stylesheet, `src/app/globals.css`, holds the whole design system. Colour says who is acting:
iris for people, mint for agents, amber for anything waiting on a person's decision, rose for refusals.
Type is Bricolage Grotesque for headings and Instrument Sans for text, both bundled, so nothing loads
from an outside font service. The console is dark by design; there is no light theme yet.

## Settings (`.env`)

| Setting | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Switches the agents on. Without it everything else still works |
| `SMTP_URL`, `MAIL_FROM` | Sends real email. Without them, emails print in the server log |
| `APP_URL` | The public address, used in links inside emails |
| `DATABASE_URL` | A real Postgres. Without it, an embedded database in `./.data` is used |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first administrator, created by `npm run db:seed` |

## Running it for real

`docker-compose.yml` runs the app with Postgres. Set `POSTGRES_PASSWORD`, `APP_URL` and the admin
settings in `.env`, run `docker compose up -d --build`, then `docker compose exec app npm run db:seed`.
Put a reverse proxy with HTTPS in front of port 3000 and back up the `dbdata` volume.

### On Vercel

A serverless host has no long-running process, so three things work differently there:

- The build (`vercel-build`) applies migrations and creates the roles and service accounts. Web processes do neither.
- The background work (events, email, reminders, agent runs) is one pass of `/api/cron/tick`, called every minute by the
  cron in `vercel.json`. Set `CRON_SECRET`; the route refuses calls without it. Per-minute cron needs a paid Vercel plan.
- Set `DATABASE_URL` to a hosted Postgres, using its pooled address, and keep the function region next to the database.

Email and agent work therefore start within about a minute of being queued, not within seconds.

## Not here yet

WhatsApp delivery, a native Salesforce or HubSpot sync (webhooks are the bridge for now), single sign-on,
an attendee mobile app, attendee networking, sponsor and exhibitor management, ticketing and payments,
virtual and hybrid sessions, a page and email designer, QR scanning at the desk, memory across events,
a light theme, and a separate worker process for a multi-server install: outside Vercel the background
worker runs inside the web process, which is right for one server only.
