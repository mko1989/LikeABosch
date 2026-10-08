# WO-088: Wireless: seat configuration (names, rights, selection/subscription mode, de-init, remove, range test)

| | |
|---|---|
| **Status** | review |
| **Phase** | 3 Web UI |
| **Depends on** | WO-076 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Settings → Seats on DICENTIS Wireless: per seat name, priority, dual, identification, voting, camera/preset; the WAP's configuration ("selection") and subscription modes; de-initialise all seats; remove disconnected seats; range test; select a seat (identify).

## Context
WAP web UI code (`/js/app.js`, firmware 1.73.2081; read 2026-10-07, see DEC-024). The real WAP is offline for now (user took it out): build against the wireless mock, verify on the WAP later (e2e:wireless). `configSeatsController` / `configSeatsServices`: `PUT /seats/{id}` with `{id, <field>}` (name ≤ 32 bytes, quotes removed), `PUT /seats/{id}/selected {selected}`, `GET/PUT /seats/status {isConfigurationModeOn, isSubscriptionModeOn}` (+ `subscriptionStatus`), `PUT /seats/deinit {deinit:true}`, `PUT /seats/remove {remove:true}`, `GET/POST /seats/range-test`. Licences limit dual/identification/voting.

## Scope
- In: view `wap-seats` (feature `wapConfig`) with the table and the mode switches; de-init and remove behind a confirmation; configuration mode switched off again when leaving the view (as the web UI does).
- Out: seat camera presets on the WAP's own camera control beyond choosing camera/preset (`/cameras` is excluded, DEC-024: passwords).

## Acceptance criteria
- [x] Seat fields saved; modes toggle; de-init / remove / range test call the WAP (mock).
- [x] ui-check scenario + screenshots looked at; `npm test` green.

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("seats settings with de init, selection mode, removing etc."); scope set (ready).

- 2026-10-07 (Claude Opus): `web/js/views/wap-seats.js` (Settings → Seats): modes (configuration = seat selection, subscription +
  status/overlap note), maintenance (range test, remove disconnected seats (n), de-initialise all, both confirmed),
  table: name (web UI rule: no quotes, ≤ 32 UTF-8 bytes), priority, dual use, identification, voting, Select/Selected.
  Configuration mode is switched off on leaving the view when LikeABosch switched it on. ui-check `wap-seats`: rename
  ('Mayor "Bob"' → 'Mayor Bob'), configuration mode on → off after leaving, select seat 3, remove button count;
  restored. De-init/remove are covered by backend tests only (they would break later scenarios). Screenshot looked at.
  `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- Camera / preset per seat not offered: choosing a camera needs `/cameras`, which returns passwords (DEC-024 §2).

## Handoff
Delivered: wireless seat configuration and maintenance. Status `review`. Open: try de-init/remove/range test on the
real WAP (destructive: only with the user), check the range test result shape.
