# Tool reference

Generated from the code. Every change to data goes through one of these tools, whoever makes it: a person on a screen, an API client, an agent or an outside assistant over MCP.

- **Permission**: the one permission a caller's role must include.
- **Reach**: `read` and `write` stay inside the instance. `destructive` cannot be undone. `external` is seen by people outside it; an agent calling one is held for a person's approval unless a policy says otherwise.

| Tool | Permission | Reach | What it does |
| --- | --- | --- | --- |
| `event.create` | event.write | write | Create a draft event. Kind is booth, field (field-marketing) or conference. |
| `event.get` | event.read | read | Read one event with its sessions and its numbers: the registration funnel, leads, targets, budget, pipeline and survey score. |
| `event.set_status` | event.publish | external | Move an event between draft, live, closed and archived. Going live makes it public. |
| `session.create` | session.write | write | Add a session to a conference, optionally with speakers (who must already be contacts). |
| `session.add_speaker` | session.write | write | Put an existing contact on a session as a speaker, moderator or panellist. |
| `event.public_info` | event.read | read | What the public may know about an event: name, time, venue and, for conferences, the agenda. Nothing internal. |
| `form.add_field` | event.write | write | Add a question to an event's registration form or to its lead capture screen: free text, choose one, tick box, company, phone number, web address, social profile, or terms the guest must agree to. |
| `form.remove_field` | event.write | write | Remove a question from a form. Answers already given are kept on the records. |
| `event.update` | event.write | write | Change an event's details: name, dates, venue, public description, cover image, map link, address of the public page, brief, capacity, targets, whether guests need approval, time zone and currency. Leave a field out to keep it; send null to clear one. Changing the address breaks links already sent. |
| `event.clone` | event.write | write | Start a new draft from an existing event: same type, venue, brief, capacity, targets, questions, planned budget and session outline. Guests, leads and messages are not copied. |
| `budget.set_item` | event.write | write | Add a budget line to an event, or update one: what it is, the planned amount and, once known, the actual amount. |
| `budget.remove_item` | event.write | write | Remove a budget line from an event. |
| `contact.upsert` | contact.write | write | Create a contact, or update the existing one with the same email. One person is one contact across all events. |
| `registration.create` | registration.write | write | Register a contact for an event. Registering the same person twice returns the existing registration. |
| `registration.check_in` | checkin.write | write | Check a registered guest in at the door and issue their PIN. |
| `lead.capture` | lead.write | write | Record a conversation with a contact at a booth or in the field. |
| `registration.register_guest` | registration.write | write | Self-registration from the public event page. Works only while the event is live. Never changes an existing contact's details. |
| `registration.export` | contact.read | read | List every registration for an event with contact details, for export. |
| `lead.get` | contact.read | read | Read one lead with the contact it belongs to and the event it was captured at. |
| `lead.score` | lead.write | write | Score a lead from 0 to 100 and give the reason. 70 and above is hot, 40 to 69 warm, below 40 cold. |
| `guest.import` | registration.write | write | Put a list of people on an event's guest list as invited. New people become contacts; existing contacts are never changed. Nobody is emailed by this. |
| `registration.rsvp` | registration.write | write | Record an invited guest's reply. Yes gives them a place, or a waitlist spot when the event is full. No marks them declined. |
| `registration.cancel` | registration.write | write | Cancel a guest's place. If people are waiting, the one who has waited longest is given the place and told. |
| `survey.submit` | registration.write | write | Record a guest's answer to how likely they are to recommend the event (0 to 10), with an optional comment. One answer per guest; a second replaces the first. |
| `lead.set_value` | lead.write | write | Record what a lead could be worth, as judged by the salesperson. Send null to clear it. |
| `message.send` | message.send | external | Queue an email or WhatsApp message to one contact. Refused when the contact has opted out of email, or has not opted in to WhatsApp. |
| `campaign.send` | message.send | external | Send one message to a segment of an event's guests. Use {{first_name}}, {{event_name}}, {{pass_url}} and, for invitations, {{rsvp_url}} in the text. People without consent for the channel are skipped. One approval covers the whole send. |
| `contact.unsubscribe` | consent.write | write | Record that a contact no longer wants email. Used by the unsubscribe link. |
| `task.create` | task.write | write | Create a to-do for a person or an agent, optionally tied to an event. |
| `task.set_state` | task.write | write | Mark a to-do open, in progress, done or cancelled. |
| `note.add` | note.write | write | Add a note to the activity stream of an event, lead, contact, registration or task. Use it for briefs, summaries and reasoning. |
| `agent.run` | agent.run | write | Ask an agent to work towards a goal. The run is queued and carried out in the background. |
| `user.create` | admin.manage | write | Add a person to the team with a role and a starting password. |
| `policy.set` | admin.manage | write | Set the autonomy dial for one agent on one tool: suggest, approve, or auto with an optional daily cap. |
| `user.set_password` | admin.manage | write | Give a team member a new password and sign them out everywhere. |
| `account.change_password` | account.self | write | Change your own password. Needs the current one. |
| `webhook.create` | admin.manage | write | Tell another system when things happen here. Give its address and which events it wants (for example registration.created, checkin.confirmed, lead.captured), or * for all. |
| `webhook.remove` | admin.manage | write | Stop telling another system about events here. |
| `playbook.set` | admin.manage | write | Set the organisation's playbook: brand voice, naming rules, compliance and approval policies. Every agent reads it before it works. |
| `event.cancel` | event.publish | external | Call an event off. Registration shuts, the public page says it is cancelled, and everyone invited, registered or waiting is emailed once. An optional note from the organisers is added to the email. |
| `registration.approve` | registration.write | write | Approve a guest who asked to join an event that approves each guest. They get a place, or a waitlist spot when the event is full, and are emailed. |
| `registration.decline` | registration.write | write | Turn down a guest who asked to join an event that approves each guest. They are told by email. |
| `registration.undo_check_in` | checkin.write | write | Take back a check-in made by mistake. The guest keeps their place and can be checked in again. |
| `registration.walk_in` | checkin.write | write | Register someone who turned up at the door and check them in, in one step. Never changes an existing contact's details. Works when the event is full. |
| `user.set_role` | admin.manage | write | Change a team member's role. It takes effect on their next page. |
| `user.set_active` | admin.manage | write | Switch a team member's account off or back on. Switching it off signs them out everywhere. |
| `contact.export` | admin.manage | read | Everything held about one person, found by email: their details, registrations, leads, survey answers, messages sent to them and notes about them. |
| `contact.erase` | admin.manage | destructive | Remove one person, found by email, and everything held about them: registrations, leads, survey answers, messages, notes, and their details in the ledger. This cannot be undone. |

## Roles

| Role | Permissions |
| --- | --- |
| admin | all 19 |
| organiser | event.read, event.write, event.publish, session.write, contact.read, contact.write, registration.write, checkin.write, lead.write, message.send, task.write, note.write, approval.decide, agent.run, account.self, consent.write, insights.read, audit.read |
| sales | event.read, contact.read, contact.write, lead.write, note.write, account.self, insights.read |
| desk | event.read, contact.read, checkin.write, account.self |
| public_site | registration.write, consent.write |
| system | message.send, task.write, agent.run |
| agent_builder | event.read, event.write, event.publish, session.write, task.write, note.write |
| agent_lead | event.read, contact.read, lead.write, message.send, task.write, note.write |
| agent_analyst | event.read, contact.read, note.write |
| agent_outreach | event.read, message.send, note.write |
| agent_concierge | event.read, task.write |

## Who sees which screen

Tools check a permission before changing anything. Screens check one before showing anything.

| Screen | Permission |
| --- | --- |
| Today, Events, an event's Overview and Agenda | event.read |
| An event's Guests and Leads tabs, Badges | contact.read |
| An event's Messages tab | message.send |
| An event's Insights tab, Insights | insights.read |
| An event's Setup tab | event.write |
| Door desk | checkin.write |
| Lead capture | lead.write |
| Inbox, and "Needs you" on Today | approval.decide |
| Agent runs | agent.run |
| Activity, and "Done for you" on Today | audit.read |
| Agents, Team, Settings | admin.manage |
