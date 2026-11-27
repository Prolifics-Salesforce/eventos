# EventOS gap analysis and build plan

Written 27 November 2026. Compares EventOS (this repo, branch `Dev-1`) with Luma and Cvent.

**Sources.** Luma: its pricing page, the full help-centre index, and a signed-in walk through the host
screens using a private test event (create form, Overview, Guests, Registration, Blasts, Insights, More,
check-in, and the calendar's People, Insights and Settings tabs). Cvent: its public product pages only
(product map, onsite check-in, attendee hub, lead capture); no account, so depth there is marketing-level.
The "AWS event platform" has not been researched yet: it is not clear which product is meant.

**How to read the status column**

| Status | Meaning |
| --- | --- |
| Done | Works today, covered by code in this repo |
| Partial | Some of it exists; the missing part is named |
| Change | Exists but should work differently |
| Missing | Nothing in the repo |

---

## 1. Feature-by-feature comparison

### Event setup and the event page

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Create event (name, time, venue) | Yes | Yes | Done | `event.create` |
| Event types | One type | Many | Done | booth, field, conference |
| Draft / live / closed / archived | Public or private only | Yes | Done | `event.set_status` |
| Clone an event | Yes | Yes | Done | `event.clone` copies questions, budget, sessions |
| Edit name, dates, timezone after creation | Yes | Yes | Partial | `event.update` only takes venue, brief, capacity, targets; the screen only offers capacity and targets |
| Cancel an event and notify guests | Yes | Yes | Missing | Archiving hides it but tells nobody |
| Cover image | Yes | Yes | Missing | No file storage at all yet |
| Themes, colours, fonts | Yes | Page designer | Missing | One fixed dark design |
| Rich-text description | Yes | Yes | Missing | `brief` is internal and plain text; nothing public |
| Location with map, hidden until approved | Yes | Yes | Missing | Venue is a single text line |
| Online and hybrid events (Zoom, Meet link) | Yes | Full virtual platform | Missing | |
| Custom URL slug | Plus plan | Yes | Partial | Slug is generated from the name and cannot be changed |
| Embed register button or page on another site | Yes | Yes | Missing | |
| Per-event hosts and co-hosts shown on the page | Yes | Yes | Missing | Roles are instance-wide, not per event |
| Recurring / multi-date events | Workarounds | Yes | Missing | |
| Timezone handling | Per event | Per event | Change | Column exists, but several screens and actions hard-code `Asia/Kolkata` |
| Currency | Per calendar | Per event | Change | Column exists, default `INR`, no way to set it |

### Registration and tickets

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Public registration page | Yes | Yes | Done | `/e/<slug>` |
| Custom questions | 8 types | Many, with logic | Partial | text, select, checkbox. Missing: phone, company, website, social profile, terms with signature |
| Capacity and waitlist with auto-promotion | Yes | Yes | Done | |
| Require approval before a place is given | Yes | Yes | Missing | No "pending" status |
| Registration open / closed switch | Yes | Yes | Partial | Tied to event status; no separate switch or close date |
| Ticket types (free, paid, limited, timed) | Yes | Yes | Missing | |
| Payments, refunds, taxes, invoices | Stripe | Yes | Missing | |
| Coupons and unlock codes | Yes | Yes | Missing | |
| Group registration (several tickets at once) | Yes | Yes | Missing | |
| Ticket transfer | Yes | Yes | Missing | |
| Invitations with a personal reply link | Yes | Yes | Done | `guest.import` + `campaign.send` + `registration.rsvp` |
| Guest can cancel their own place | Yes | Yes | Done | |
| Confirmation email | Yes, with calendar invite | Yes | Partial | Plain-text email; no calendar invite |
| Customise the confirmation email | Yes | Yes | Missing | Wording is fixed in `src/rules/index.ts` |
| Bot and abuse protection | Yes | Yes | Partial | Honeypot only; no rate limit, no confirm-your-email |
| Guest sign-in / one-click RSVP for returning guests | Yes | Yes | Missing | |

### Guest management

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Guest list per event | Yes | Yes | Done | Guests tab |
| Import a list | CSV, contacts | Yes | Done | Paste CSV |
| Export CSV | Yes | Yes | Done | |
| Search, filter, sort, paging | Yes | Yes | Missing | Whole list rendered at once |
| Bulk actions | Yes | Yes | Missing | |
| Edit a guest's details or status | Yes | Yes | Partial | Staff can cancel; cannot edit name, email or answers |
| Contacts across events (a person's history) | Calendar People | Yes | Partial | `contact` table is shared; no screen |
| Companies / accounts | No | Yes | Partial | `account` table exists, unused |
| Tags, segments, memberships | Yes | Yes | Missing | |
| Show the guest list on the public page | Yes | Yes | Missing | |

### Messaging

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Message a segment of guests | Yes | Yes | Done | `campaign.send`, four segments |
| Merge fields | Yes | Yes | Done | first name, event name, pass link |
| Unsubscribe link and header | Yes | Yes | Done | |
| Automatic reminders | 1 day and 1 hour, switchable | Configurable | Partial | 1 day only; not switchable or editable |
| Schedule a message for later | Yes | Yes | Missing | |
| Post-event feedback email | Yes, scheduled | Yes | Partial | Survey lives on the pass page; nothing emails it |
| HTML / branded email | Yes | Designer | Missing | Plain text only |
| SMS | Yes | Yes | Missing | |
| WhatsApp | Yes | Via partners | Partial | Opt-in and queue work; no provider connected |
| Push notifications | Yes (app) | Yes (app) | Missing | |
| Newsletters to all contacts | Yes | Yes | Missing | |
| Delivery, open and bounce tracking | Yes | Yes | Partial | Sent / failed only |
| Custom sending domain | Enterprise | Yes | Partial | Whatever `SMTP_URL` and `MAIL_FROM` give |

### On the day

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Check-in by search | Yes | Yes | Done | Door desk |
| QR code on the guest's pass | Yes | Yes | Done | |
| Scan the QR with a camera | Yes | Yes | Missing | Staff must type the number |
| Undo a check-in | Yes | Yes | Missing | |
| Walk-in registration at the desk | Yes | Yes | Missing | |
| Check-in staff role | Plus plan | Yes | Done | `desk` role |
| Printable badges | Yes | On-demand printers | Done | Browser print, fixed layout |
| Badge designer, print on arrival, kiosks | No | Yes | Missing | |
| Session check-in and capacity control | No | Yes | Missing | |
| Apple / Google Wallet pass | Yes | Yes | Missing | |
| Offline mode | App | Yes | Missing | |

### Conferences

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Sessions, tracks, rooms | No | Yes | Done | |
| Speakers on sessions | No | Yes | Done | |
| Edit or remove sessions and speakers | n/a | Yes | Missing | Create only |
| Session registration and personal agenda | No | Yes | Missing | |
| Speaker portal, call for papers | No | Yes | Missing | |
| Sponsors and exhibitors | No | Yes | Missing | |
| Attendee app, networking, 1:1 meetings | Chat only | Yes | Missing | |
| Polls, Q&A, gamification | No | Yes | Missing | |

### Leads, budget and return (EventOS's own ground)

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Booth lead capture with custom questions | No | Yes | Done | Phone screen |
| Badge or business-card scan into a lead | No | Yes | Missing | |
| Lead scoring | No | Yes | Done | Manual or by the Lead Intelligence agent |
| Pipeline value per lead | No | Via CRM | Done | |
| Budget, planned versus actual | No | Yes | Done | |
| Cost per attendee, cost per lead, return | No | Yes | Done | |
| Lead follow-up drafted for approval | No | No | Done | |
| Exhibitor lead capture for third parties | No | Yes | Missing | |

### Insights

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Registration funnel | Basic | Yes | Done | |
| Portfolio view across events | Calendar insights | Yes | Done | |
| NPS / feedback score | Yes | Yes | Done | |
| Page views, traffic sources, cities | Yes | Yes | Missing | |
| UTM tracking links | Yes | Yes | Missing | |
| Referral links per guest | Yes | No | Missing | |
| Meta pixel, Google Analytics | Plus plan | Yes | Missing | |

### AI

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| Agents that plan, score, write and report | No | CventIQ assistants | Done | Never run against a live model (see `KNOWN-GAPS.md`) |
| Approval inbox and autonomy dial | No | No | Done | |
| Guest-facing assistant | No | Yes | Done | Concierge |
| MCP server for outside assistants | Yes | No | Done | `/api/mcp` |
| Organisation playbook | No | No | Done | |

### Integrations, team and security

| Feature | Luma | Cvent | EventOS | Notes for EventOS |
| --- | --- | --- | --- | --- |
| REST API | Plus plan | Yes | Done | `/api/tools/<name>` |
| Webhooks | Yes | Yes | Done | Signed, retried |
| Zapier | Plus plan | Yes | Missing | Webhooks are the bridge |
| HubSpot / Salesforce sync | Yes | Yes | Missing | |
| Calendar sync (iCal feed) | Yes | Yes | Missing | |
| Roles and permissions | Admins, managers | Yes | Partial | Changes are checked; screens are not |
| Add people, reset passwords | Yes | Yes | Done | |
| Change a role, deactivate a person | Yes | Yes | Missing | |
| Audit log | Yes | Yes | Done | Every tool call |
| Two-step sign-in, passkeys | Yes | Yes | Missing | |
| Single sign-on | Enterprise | Yes | Missing | |
| Password reset by email | Code sign-in | Yes | Missing | Admin resets by hand |
| Privacy tools (erase, export one person) | Yes | Yes | Missing | |
| Public calendar of all events, discovery | Yes | No | Missing | No public index of events |
| Mobile apps | Yes | Yes | Missing | |
| Light theme, other languages | Yes | Yes | Missing | |

---

## 2. Summary by status

**Done (keep, polish only).** Event lifecycle and cloning; public registration with custom questions;
capacity and waitlist; invitations and RSVP; guest pass with QR; door desk and PIN; badges; sessions and
speakers; lead capture, scoring and pipeline value; budget and return; segment campaigns with unsubscribe;
insights per event and across events; agents, approval inbox, autonomy dial, playbook, Concierge; roles,
audit ledger; API, webhooks, MCP; CSV import and export.

**Partial (finish these).** Event editing; question types; confirmation email (no calendar invite, fixed
wording); reminders (one, not configurable); feedback (no email); WhatsApp (no provider); email tracking;
guest editing; contacts and companies (data, no screens); slug (not editable); abuse protection;
permission checks on screens.

**Change (works, but wrongly).** Hard-coded India timezone in screens and actions; currency fixed at INR;
any signed-in user can read every guest list, lead and the team list; plain-text-only email; background
work shares the web process outside Vercel.

**Missing.** Everything marked Missing above. The largest blocks are: ticketing and payments; the visual
event page (cover image, description, themes); guest table tools; registration approval; scheduled
messages and SMS; QR scanning and walk-ins; page analytics, UTM and referrals; CRM sync; sign-in security;
and the conference layer (session registration, sponsors, attendee app).

---

## 3. Build plan

Each phase leaves the product shippable. Sizes are relative: S is a day or two, M about a week, L several
weeks.

### Phase 0 — Make it safe for real guests (from `KNOWN-GAPS.md`)

| Item | Size | State on branch `phase-0` |
| --- | --- | --- |
| Permission check on every screen, not only on changes | S | Done |
| Rate limit on public registration | S | Done (10 an hour per connection) |
| Confirm-your-email on public registration | M | Not done: it adds a step for every guest, so it needs a decision first |
| Erase a person, export a person | M | Done |
| Health check, security headers | S | Done |
| Error monitoring | S | Errors are logged as JSON; no monitoring service connected |
| Remove hard-coded `Asia/Kolkata`; time zone and currency editable per event | S | Done |
| Run the agents against a live model and tune the prompts | M | Not done: needs an `ANTHROPIC_API_KEY` |

### Phase 1 — Luma parity for the core flow

| Item | Size |
| --- | --- |
| Edit event: name, dates, timezone, slug; cancel event with a notice to guests | S |
| Public event page: cover image, rich description, location with map link, host names (needs file storage) | M |
| More question types: phone, company, website, social profile, terms | S |
| Require-approval registration (new `pending` status, approve / decline in the guest table) | M |
| Guest table: search, filters, paging, bulk actions, edit a guest | M |
| Calendar invite (.ics) on confirmation; editable confirmation wording | S |
| HTML email template with the organisation's name and colour | M |
| Reminders: 1 day and 1 hour, switchable per event; scheduled messages | M |
| Post-event feedback email, scheduled | S |
| Desk: camera QR scan, undo check-in, walk-in registration | M |
| Team: change role, deactivate; password reset by email | S |

### Phase 2 — Growth and money

| Item | Size |
| --- | --- |
| Ticket types (free and paid, limits, sale window) | L |
| Stripe checkout, refunds, receipts; coupons and unlock codes | L |
| Group registration | M |
| Page views, sources, UTM links; referral link per guest | M |
| Embed button and embeddable page | S |
| Public index page listing live events, with tags | S |
| Contacts and Companies screens (history across events) | M |

### Phase 3 — Channels and connected systems

| Item | Size |
| --- | --- |
| WhatsApp and SMS provider (the queue and consent rules already exist) | M |
| Bounce handling and open tracking | M |
| HubSpot and Salesforce sync | L |
| Zapier app (thin layer over webhooks and the API) | M |
| Online and hybrid events: join link, Zoom / Meet creation, online attendance | M |
| iCal feed of all events | S |

### Phase 4 — Enterprise and conferences

| Item | Size |
| --- | --- |
| Two-step sign-in, then single sign-on | L |
| Session editing, session registration, personal agenda, session check-in | L |
| Sponsors and exhibitors, with their own lead capture | L |
| Badge or business-card scan into a lead | M |
| Badge designer and print-on-arrival | M |

### Later, or deliberately out of scope

Native mobile apps, wallet passes, memberships and newsletters, attendee networking and chat, polls and
Q&A, a virtual event platform, venue sourcing, room blocks and travel. These are where Luma (community)
and Cvent (enterprise suite) are strongest and furthest from what EventOS is for.

---

## 4. Open questions

1. Which product is "the event platform in AWS"? It has not been researched.
2. Are paid tickets needed? B2B booths and field events are usually free; Phase 2's two largest items
   depend on the answer.
3. Is the aim one organisation per deployment (today's design) or many organisations on one site, as Luma
   does with calendars? The second is a data-model change and would come before everything else.
