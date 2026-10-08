# WO-066: DCN Streaming Meeting Data (DCN-SWSMD): reference, client, state, mock, domain

| | |
|---|---|
| **Status** | done |
| **Phase** | 2 Backend |
| **Depends on** | WO-062 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-05 |
| **Updated** | 2026-10-05 |

## Goal
LikeABosch follows a DCN NG meeting by reading the DCN-SW server's Streaming Meeting Data (`system: dcn-smd`,
DEC-018): seats, microphones, request lists, voting and results, participants, all in the shared domain topics, so
the discussion view, room plan and camera director work without any Windows component.

## Context
DEC-018 (decided by user 2026-10-05), DEC-010 (domain), DEC-005 (cache). Source: `docs/source/DCN-SWSMD.pdf`, text
`docs/source/dcn-swsmd.txt` (pypdf, `=== PAGE n ===`). Pattern: `backend/src/dcn/` (WO-060), `backend/src/domain/`.

## Scope
- In:
  - `docs/protocol/dcn-swsmd/README.md`: framing, encoding, configuration, topics/activities table, containers,
    known inconsistencies of the manual, open questions.
  - `backend/src/dcn-smd/`: `xml.js` (lenient parser), `frames.js` (header + message decoding, encoding detection),
    `client.js` (`DcnSmdClient`, TCP, reconnect, rejected-connection hint), `state.js` (activities → state model,
    persistence), `bridge.js`-like sync (`DcnSmdSync`: state → `smd*` topics), routes (`GET /api/dcn-smd/state`,
    `POST /api/dcn-smd/reset`, `GET /api/dcn-smd/activities`).
  - Config/manager: `system: dcn-smd`, default port 20000, no user/password required.
  - `mock/dcn-smd/server.js` (+ README, `npm run mock:dcn-smd`): framing, queue while disconnected (replay once),
    AllowedClients, UTF-16LE or UTF-8, scripted activities (meeting start, mic on/off, requests, voting with results,
    priority, service call, interpretation).
  - Domain mappers + capabilities for `dcn-smd` (read-only: no actions).
  - Tests: XML parser on the manual's examples, framing (split/merged chunks, both encodings), state reducer,
    backend against the mock (topics, domain, persistence across restart, reconnect, rejected client).
- Out: UI and launcher (WO-067).

## Acceptance criteria
- [x] All XML examples of the manual (A.2.1–A.2.6) parse, including their typos, and update the state as described (tests "all examples of the manual parse…", "the manual examples build the expected picture"; fixture `backend/test/fixtures/dcn-smd-manual-examples.json` extracted verbatim from the PDF text).
- [x] Backend with `system: dcn-smd` against the mock: `loggedIn`; activities update `smd*` and `domain.*` topics
      (speakers, requests, seats with names/persons, voting state + results, participants); domain actions → NOT_SUPPORTED (`backend/test/dcn-smd.test.js`).
- [x] State survives a backend restart (persisted) and can be reset via the API (test "the picture survives a backend restart…").
- [x] `npm test` green (199/199); `npm run e2e:mock` still green (31/31).

## Work log
- 2026-10-05 (Claude Opus): created (in-progress). Moved `DCN-SWSMD.pdf` from the repo root to `docs/source/`,
  extracted text with pypdf (scratch venv) to `docs/source/dcn-swsmd.txt` (30 pages).
- 2026-10-05 (Claude Opus): read the manual: one-way XML stream on TCP 20000 from the DCN-SW server, 8-byte header
  (topic, length), no snapshot request, server-side queue replayed to the next client, licence + AllowedClients.
  Wrote DEC-018 (user decision) and `docs/protocol/dcn-swsmd/README.md` (incl. the manual's inconsistencies:
  UTF-16LE in the C# sample vs utf-8 declaration, Timestamp/TimeStamp, Container suffixes, broken examples).
- 2026-10-05 (Claude Opus): `backend/src/dcn-smd/{xml,frames,client,state,sync,routes}.js`; config/manager
  (`dcn-smd`, port 20000, no user needed incl. auto-connect), app/server wiring, `.env.example`. The parser rebuilds
  the manual's broken examples correctly (self-closed `<Desk/>` "closed" later → following siblings re-parented;
  `</Channel` without `>`; typographic quotes). `mock/dcn-smd/server.js` + README, `npm run mock:dcn-smd`. Domain:
  `FEATURES['dcn-smd']` (read-only, `dcnStream`, `readOnly`), `dcnSmd` mappers, NOT_SUPPORTED for all actions.
  Found during the smoke run: capabilities for an unknown system fell back to the *wired* feature set (would have
  shown controls) → explicit `dcn-smd` entry. Fixed in review: a full Seat activity without `<Participant>` now
  clears the seated participant (manual p. 12).
- 2026-10-05 (Claude Opus): tests `backend/test/dcn-smd.test.js` (13). Run 1: 12/13: a missing `Percentage`
  attribute produced NaN (null after persistence) → fixed. `npm test` 199/199, `e2e:mock` 31/31. Docs
  `docs/api/dcn-smd.md`, API README, architecture.

## Decisions
- Separate system id `dcn-smd` (DEC-018); the bridge (`dcn`) is unchanged.
- Interpreter desk seats (SeatType Interpreter or a desk's seat) are not in `domain.seats`, like wired interpreter desks.
- Chairman priority (SeatPriorityButtonActivated) makes the seat a priority speaker in `domain.discussion` even if the
  active list does not (yet) contain it; seat `canPrio` = SeatType Chairman.
- Seats/participants are kept once seen (persisted); MeetingStopped clears meeting, lists and voting, not the seat names.
- Voting state: Selected → ready, Started → opened, OnHold → onHold, Resumed → opened, Stopped → done, and with
  `Approved` → accepted/rejected in the domain.

## Handoff
Done (mock-verified). On a real DCN-SW server check (added to WO-065): encoding, `TimeStamp`, element names of the
discussion lists and voting answers, whether anything is sent on connect besides the queue. UI: WO-067.
