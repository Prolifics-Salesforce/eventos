# Known gaps

An honest list of what this build does not do, as of 19 November 2026. Read it before putting real guests' data in.

## Fix before going live

- **Privacy is partly covered.** An administrator can download or erase one person's data (Settings). There is still no retention schedule, and the consent wording a guest agreed to is not stored. Until someone is erased, the ledger keeps their name, email and message text.
- **Public registration has no confirm-your-email step.** One connection is limited to 10 registrations an hour, but someone could still register another person's address and have the system email them once.
- **Erasing a guest does not move the waitlist up.** Cancel their place first if the event is full.
- **No backups.** With the embedded database, all data is the `.data` folder.
- **The Docker build has not been run.** `/api/health` and security headers exist, and errors are written to the server log as JSON, but no monitoring service is connected to raise an alert.
- **Agents have only run against scripted stand-ins**, never a live model. Expect prompt tuning. There are no automated quality tests for agent output, no cost tracking and no way to stop a run.

## Missing features

- Contacts and Companies screens (the data exists; no screen shows a person's history across events).
- Editing a guest's answers to the event's questions (their name, email, phone and title can be corrected).
- Uploading a cover picture: the public page shows one from a web address, but there is no file storage yet.
- Search, filters and paging on the lead table (the guest table has them).
- Calendar invitations attached to emails (the confirmation links to a calendar file instead); an email designer (emails go out as plain text plus a simple branded HTML version; `ORG_NAME` and `BRAND_COLOR` set the name and colour); rewording the confirmation beyond adding a note; bounce handling.
- A scheduled message is sent to whoever matched when it was scheduled, not when it goes out. It cannot be edited, only stopped and written again.
- Offline mode at the desk. The camera scanner has been tested for everything except the camera itself: it has not been pointed at a real pass on a real phone.
- Business-card scanning; native Salesforce or HubSpot sync (signed webhooks are the bridge).
- WhatsApp delivery (queueing and opt-in are enforced; no provider is connected).
- Single sign-on, two-step sign-in, event approvals.
- A page and email designer, attendee app, networking, sponsors and exhibitors, ticketing and payments, virtual sessions.
- A light theme, languages other than English.

## Limits of the current design

- Outside Vercel the background worker lives in the web process: correct for one server, wrong for several. Sign-in lockout and Concierge limits are counted in the database.
- Each event has its own time zone and currency (Setup tab). Screens that span events (Today, Activity) use `APP_TIMEZONE`, and new events start with `APP_TIMEZONE` and `APP_CURRENCY`; both default to India.
- Role-aware screens are in: a person is shown only the screens and tabs their role includes. Individual buttons inside a screen are not yet hidden.
- `sys_dictionary` (custom fields) and `account` (companies) are in the data model but nothing uses them yet.
