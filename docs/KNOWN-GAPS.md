# Known gaps

An honest list of what this build does not do, as of 19 November 2026. Read it before putting real guests' data in.

## Fix before going live

- **Viewing is not permission-checked.** Changes are; screens are not. Any signed-in user can open guest lists, leads, Insights and Team. Only Settings is restricted to administrators.
- **No privacy tools.** No erase-a-person, no export of one person's data, no retention schedule, and the consent wording a guest agreed to is not stored. The ledger keeps names, emails and message text indefinitely.
- **Public registration has no rate limit and no confirm-your-email step.** Someone could register other people's addresses and have the system email them.
- **No backups.** With the embedded database, all data is the `.data` folder.
- **Never run in production form.** The Docker build has not been run. There is no health check, error monitoring or security headers.
- **Agents have only run against scripted stand-ins**, never a live model. Expect prompt tuning. There are no automated quality tests for agent output, no cost tracking and no way to stop a run.

## Missing features

- Contacts and Companies screens (the data exists; no screen shows a person's history across events).
- Editing an event's name, date or venue after creation; editing or removing sessions, speakers and guest details.
- Search, filters and paging on guest and lead tables.
- Calendar invitations in emails; branded HTML emails; bounce handling.
- Walk-in registration at the desk, undo check-in, QR scanning, offline mode.
- Business-card scanning; native Salesforce or HubSpot sync (signed webhooks are the bridge).
- WhatsApp delivery (queueing and opt-in are enforced; no provider is connected).
- Single sign-on, two-step sign-in, password reset by email link, event approvals.
- A page and email designer, attendee app, networking, sponsors and exhibitors, ticketing and payments, virtual sessions.
- Role-aware screens (a user sees buttons their role will be refused), a light theme, languages other than English.

## Limits of the current design

- Outside Vercel the background worker lives in the web process: correct for one server, wrong for several. Sign-in lockout and Concierge limits are counted in the database.
- Times are entered and shown in India Standard Time in several places; currency defaults to INR.
- `sys_dictionary` (custom fields) and `account` (companies) are in the data model but nothing uses them yet.
