# Screens and endpoints

Generated from `src/app`.

| Address | Kind | Who can open it | File |
| --- | --- | --- | --- |
| `/` | screen | Redirects to /today | `src/app/page.tsx` |
| `/account` | screen | Signed-in team | `src/app/(console)/account/page.tsx` |
| `/activity` | screen | Signed-in team | `src/app/(console)/activity/page.tsx` |
| `/agents` | screen | Signed-in team | `src/app/(console)/agents/page.tsx` |
| `/api/health` | endpoint | Anyone (says only whether the database answers) | `src/app/api/health/route.ts` |
| `/api/mcp` | endpoint | API key | `src/app/api/mcp/route.ts` |
| `/api/tools` | endpoint | Anyone (the catalogue only, no data) | `src/app/api/tools/route.ts` |
| `/api/tools/<name>` | endpoint | API key | `src/app/api/tools/[name]/route.ts` |
| `/e/<slug>` | screen | Public | `src/app/e/[slug]/page.tsx` |
| `/e/<slug>/calendar.ics` | endpoint | Public (a live, closed or cancelled event with a date) | `src/app/e/[slug]/calendar.ics/route.ts` |
| `/e/<slug>/ask` | screen | Public | `src/app/e/[slug]/ask/page.tsx` |
| `/e/<slug>/pass/<id>` | screen | Public | `src/app/e/[slug]/pass/[id]/page.tsx` |
| `/events` | screen | Signed-in team | `src/app/(console)/events/page.tsx` |
| `/events/<id>` | screen | Signed-in team | `src/app/(console)/events/[id]/page.tsx` |
| `/events/<id>/badges` | screen | Signed-in team, phone layout | `src/app/(floor)/events/[id]/badges/page.tsx` |
| `/events/<id>/capture` | screen | Signed-in team, phone layout | `src/app/(floor)/events/[id]/capture/page.tsx` |
| `/events/<id>/desk` | screen | Signed-in team, phone layout | `src/app/(floor)/events/[id]/desk/page.tsx` |
| `/events/<id>/export` | endpoint | Signed-in team | `src/app/(console)/events/[id]/export/route.ts` |
| `/inbox` | screen | Signed-in team | `src/app/(console)/inbox/page.tsx` |
| `/insights` | screen | Signed-in team | `src/app/(console)/insights/page.tsx` |
| `/my` | screen | A guest, signed in by a link sent to their email; otherwise it offers to send one | `src/app/my/page.tsx` |
| `/my/enter/<token>` | screen | Whoever holds the link from the email | `src/app/my/enter/[token]/page.tsx` |
| `/reset` | screen | Anyone (asks for a password-reset link) | `src/app/reset/page.tsx` |
| `/reset/<token>` | screen | Whoever holds the link from the email | `src/app/reset/[token]/page.tsx` |
| `/runs` | screen | Signed-in team | `src/app/(console)/runs/page.tsx` |
| `/runs/<id>` | screen | Signed-in team | `src/app/(console)/runs/[id]/page.tsx` |
| `/settings` | screen | Signed-in team | `src/app/(console)/settings/page.tsx` |
| `/settings/person` | endpoint | Administrators (downloads one person's data) | `src/app/(console)/settings/person/route.ts` |
| `/signin` | screen | Anyone | `src/app/signin/page.tsx` |
| `/team` | screen | Signed-in team | `src/app/(console)/team/page.tsx` |
| `/today` | screen | Signed-in team | `src/app/(console)/today/page.tsx` |
| `/u/<token>` | endpoint | Public | `src/app/u/[token]/route.ts` |

"Signed-in team" means a signed-in person whose role includes the screen: see "Who sees which screen" in `docs/TOOLS.md`.
