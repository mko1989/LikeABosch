# WO-075: Wireless: full REST API verified on a real WAP (e2e:wireless)

| | |
|---|---|
| **Status** | done |
| **Phase** | 4 Hardening |
| **Depends on** | WO-014, WO-015, WO-017, WO-027 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Every endpoint of the DICENTIS Wireless REST API v1.7 is exercised against a real DCNM-WAP, the four open questions in
`docs/protocol/wireless-rest/README.md` are answered, and the spec notes, the client, the poller and the mock follow
the real behaviour. Takes over the wireless part of WO-028.

## Context
- User, 2026-10-07: a DICENTIS Wireless system is connected (WAP on the office LAN, user `admin`, empty password;
  host passed via env, not written to files). "check the full api".
- `docs/protocol/wireless-rest/{swagger.yaml,README.md}`, `backend/src/wireless/*`, `mock/wireless/server.js`,
  `scripts/e2e-wired.mjs` (pattern for the new script), DEC-006 (mock fidelity: fix mock + spec + regression test).

## Scope
- In: raw probes of all 32 operations (incl. error cases, session transport, long-poll, expiry, 409 on double login);
  `scripts/e2e-wireless.mjs` running through our backend (passthrough + domain API + state cache), writes restored at
  the end; `npm run e2e:wireless` / `e2e:wireless:mock`; fixes in client/poller/mock/README/tests from the findings.
- Out: wireless UI changes beyond bug fixes (new WO if needed); powering the system **Off** (state 2) is not sent:
  it may switch the WAP off with no way back over the API.

## Acceptance criteria
- [x] Every swagger operation called at least once on the real WAP; results in `data/e2e-wireless-*.md`
  (last run `data/e2e-wireless-2026-10-07T10-52-15.md`: 22/22 checks, 32/32 operations).
- [x] Open questions 1–4 answered in `docs/protocol/wireless-rest/README.md` (with observed values).
- [x] Response shapes compared with the swagger definitions (`ok*` in the report); deviations listed in the README.
- [x] Mock behaves like the WAP for every deviation found (except the two timing effects listed in the mock README);
  `npm run e2e:wireless:mock` 22/22.
- [x] `npm test` passes (211/211). `npm run ui:check` passes; wireless screenshots checked.
- [x] WAP state restored after the run (check "state restored": identification, voting parameters, participants,
  power, discussion mode; speakers/waiting list emptied as they were).

## Work log
- 2026-10-07 (Claude Opus): created, in-progress. First raw probes (curl):
  - WAP: `DCNM-WAP`, firmware 1.73.2081, API versions 1.1–1.7, nginx 1.5.6, country PL. 2 of ~30 seats connected.
  - **Open question 1 answered:** login returns the session id as cookie `sid` **and** in the body (`{"id":1,"sid":"…"}`,
    the body `sid` is not in the swagger). Requests are accepted with `Cookie: sid=…` or header **`Bosch-Sid`**
    (listed in CORS `Access-Control-Allow-Headers`); the swagger's header `sid` gives **401**. Our client sends the
    cookie, so it works.
  - All 12 GETs answer 200. `/seats` has fields not in the swagger (`unitId`, `unitType`, `unitProps`, `hasDisplay`,
    `extra_seat`, `signalLevel`); `batteryStatus`/`batteryCharges`/`signalStatus`/`signalLevel` are `null` on
    disconnected seats; `cameraPrepos` is `-1` (swagger: "0 means none"). `participantId` 65535 = no participant.
- 2026-10-07 (Claude Opus): raw probes of all 32 operations (curl/node, scratchpad), every write restored and re-read:
  - **Session:** one session per user. A second login → **409** `User already logged in`; `override: true` kicks the old
    session (old sid → 401 with an **empty body**). Wrong password / unknown user → 401 `{error:{code,description}}`.
    `POST /logout` → 200, sid invalid afterwards.
  - **Open question 2 answered (long-poll):** `?isPolling=true` is a real long-poll. The WAP holds the request until that
    resource changes (released within ~0.1 s, e.g. `/speakers` after `POST /speakers`, `/system/status` after a power
    change) or **~50 s** pass, then answers 200 with the current data. Unrelated resources are not released. Our poller
    aborted long-polls after 35 s → raise to > 50 s.
  - **Writes are asynchronous:** a GET 20 ms after a POST sometimes returns the old list; ~0.5 s later it is updated.
  - **Errors:** `{error:{code, description, details?}}`, `description` = HTTP reason phrase. Non-numeric path ids → 404
    (no details); unknown seat in path → 400 `Invalid seat id`; seat not connected or unknown in a body → 400
    `Invalid seat id N`; not in list → 400 `Speaker not found in speakers list` / `Waiter not found in waiting list`
    (once 500 when repeated within ms).
  - **Speakers:** `POST /speakers` with no body or `[]` = "shift": moves the first waiter to the speakers (400
    `No waiter to shift`). A JSON non-array → 400 `Invalid request body type`. Adding when the list is full (Open
    mode, maxOpenMics 1) **replaces** the oldest speaker (no error). Waiting-list entries are moved to speakers.
  - **Waiting list:** `POST /waiting-list` → **500** (no details) in discussion modes Override/Voice/PTT; works only in
    Open mode. A seat that is already speaking is ignored (200).
  - **Priority:** no chairman seat on this system → `POST /priority` / `DELETE /priority/{id}` → 400
    `Seat is not a chairman seat`. Success path not verifiable here.
  - **Participants:** create needs **all three** of `name`, `seatId`, `nfc` (400 `Missing field 'nfc'` …); returns
    `{"id": n}`. Name max **32** chars (400 `Value out of range for field 'name'`), UTF-8 ok; `seatId` -1 = none,
    unknown seat → 400 `Unknown seat id`, seat taken → 400 `Seat already assigned`; `nfc` "" = none, bad format → 400
    `NFC id has incorrect formatting`, duplicate → 400 `NFC already assigned` (swagger says 409). PUT accepts partial
    bodies. Unknown id: GET → 400 `Invalid participant id`, PUT/DELETE → 400 `Unknown participant id`. With
    identification off, speakers show the seat name and `participantId` 65535.
  - **Identification:** `identification_mode` 0–3, else 400 `Value out of range…`.
  - **Voting:** state machine 0→1, 1→2, 2→1, 1→0, 2→0; everything else 400 `Cannot change state from A to B`
    (incl. 0→2 and same state). Results always contain `present` and `notVoted` besides the answers, and an
    `individuals` array (empty without identification). Parameters changed while open are **stored** (200) and apply to
    the next round; the open round keeps its mode/subject; results keep the last round after closing.
    `interimResultsMode 0` without individuals → 400; deprecated `individuals` + `resultsSettings` together → 400;
    individuals without participants/identification → 400; subject > 141 → 400; `PUT /voting {}` and
    `PUT /voting/state {}` → 200 no-op.
  - **Power:** Standby (1) → all seats disconnect at once, `/speakers/available` empty; On (0) → seats back within ~2 s.
    Off (2) not sent (scope). Out-of-range → 400. PUT answers `{}`.
  - **Licence:** the WAP has `DCNM-DEMO` plus small feature counts (`/licensing/features`), no seat has voting or
    priority enabled, so casting votes and priority calls cannot be verified on this system.
- 2026-10-07 (Claude Opus): **undocumented endpoints.** The WAP's own web UI (`/js/app.js`) uses 68 endpoints, 36 more
  than the swagger: `/discuss` (discussion mode 0 Open, 1 Override, 2 Voice, 3 PTT; maxOpenMics, waitingListSize,
  autoShift, priorityOption, …), `/audio`, `/audio/master` (volume), `/audio/equalizer/…`, `/cameras`, `/camera`
  (switcher/overview), `/system`, `/system/settings`, `/system/battery`, `/seats/status|battery-signal|nfc-reader|
  range-test|…`, `/network…`, `/redundancy/…`, `/licensing…`, `/users`, `/logging`, `/diagnostics`, `/upgrades`,
  `/date-time`, `/country`. Read-only GETs answered 200 (recorder endpoints 404). **`/cameras` returns camera
  passwords and `/network` the Wi-Fi WPA key in clear text** (values not recorded anywhere). Only `PUT /discuss` was
  written (Override → Open → original body restored, verified) to test the waiting list. Using them in LikeABosch is
  out of scope here → follow-up WO.
- 2026-10-07 (Claude Opus): idle session expiry measured (separate untouched session, login without override once a
  minute): still alive after 9 min, expired at 10 min (**open question 3**).
- 2026-10-07 (Claude Opus): mock reworked to the observed behaviour (validation and messages, shift, replace-when-full,
  discussion modes via undocumented `/discuss`, voting state machine + round snapshot, standby, WAP seat fields, `{id}`
  on create, `sid` in the login body, `Bosch-Sid`, bare 401/404/500, one long-poll per path and session, identification
  needs participants). Client: cookie + `Bosch-Sid` (no `sid` header); sid from the body as fallback; a 401 whose
  re-login gets 409 (session taken over) → `disconnected` instead of retrying forever. Spec validator tolerates `null`.
  Domain: voting shows the round's subject/answers while open; request-to-speak 500 → clear message about Open mode.
  Tests: new regression tests in `wireless-client.test.js` for every finding.
- 2026-10-07 (Claude Opus): `scripts/e2e-wireless.mjs` + `scripts/e2e-wireless-mock.mjs`, `npm run e2e:wireless[:mock]`.
- 2026-10-07 (Claude Opus): real runs. Run 1: `GET /system-info` timed out right after login. Run 3: login timed out.
  Investigation (scratchpad probes):
  - **Logout and a new login of the same user are processed only after the old session's held long-polls time out
    (~48 s)**, also when the client closed its sockets (3 scenarios, each 48 s). → client `loginTimeoutMs` 60 s; logout
    on shutdown stays fire-and-forget (2 s).
  - **A request can be parked ~50 s behind long-polls** when it arrives while several long-polls are set up after a
    burst (reproduced twice with login → 10 parallel GETs → 9 long-polls → GET). Not with keep-alive off either; not
    with 10 long-polls added one by one; not in three other orderings, so it is a race inside the WAP. Mitigation:
    6 long-polled topics (participants, identification, voting parameters now plain GET every 5 s), staggered loop
    start (150 ms), GETs retried once after a 10 s timeout, writes get 60 s (no false 504 for a parked write).
  - Only one long-poll per path and session is held; a second releases the first (the poller and the e2e share the
    session, so the e2e pauses the poller for the two long-poll measurements).
  - Chunked request bodies → 500 `Critical error while processing request` (fetch sends Content-Length: fine).
  - Identification modes 0–2 need participants (400 `Cannot set this identification mode without participants.`).
- 2026-10-07 (Claude Opus): runs after the fixes: 22/22 (`…10-49-18`), 21/21 `--quick` (`…10-51-01`), 22/22
  (`…10-52-15`): long-poll released ~0.1–0.6 s after a change, held 50.1 s without one; burst of 30 GETs while
  polling: slowest 450 ms. WAP state restored and verified each time.
- 2026-10-07 (Claude Opus): `ui:check` found the voting view counting the WAP's `present` row as votes → the wireless
  mapper drops `present`; and "Not voted" showed 500 % (share of cast votes) → now share of everyone eligible. Participant
  name input limited to 32. ui:check passes, screenshots checked (wireless voting, participants).

## Decisions
- Off (power state 2) is never sent by tests: it may switch the WAP off without a way back over the API.
- The e2e never deletes participants it did not create; "delete all" only when the list was empty at the start.
- The e2e changes the undocumented `/discuss` (to Open) only to test the waiting list, and restores the exact body.
- Fewer long-polls + GET retry instead of a request queue in the client: simplest change that removed the parked
  requests in three real runs; a queue (max N in flight) stays an option if it shows up again.
- Values from undocumented endpoints are never written to reports or docs (camera passwords, WPA key); only keys.

## Handoff
- Delivered: verified wireless API (22/22, 32/32 on DCNM-WAP fw 1.73.2081), answered open questions, "Observed
  behaviour" + undocumented endpoint list in `docs/protocol/wireless-rest/README.md`, faithful mock, `e2e:wireless`
  and `e2e:wireless:mock`, client/poller/domain/UI fixes, regression tests.
- Not verifiable on this WAP (no chairman seat, no voting-enabled seats, DCNM-DEMO licence): priority call success
  path, casting votes / non-zero results, individual results. Run `npm run e2e:wireless` again on a licensed system
  with a chairman device (the suite covers these automatically when such seats are connected).
- Not simulated by the mock: the ~48 s logout/login delay and parked requests (timing effects of the WAP).
- Follow-up: WO-076 (draft): use the undocumented WAP endpoints (discussion mode settings, master volume, audio,
  cameras, battery/diagnostics) in LikeABosch.
- WO-028: its wireless items are done here.
