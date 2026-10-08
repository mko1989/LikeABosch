# DEC-018: DCN via Streaming Meeting Data (DCN-SWSMD) as the main DCN connection

- **Status:** accepted (decided by user 2026-10-05: "for what I need this document seems to do it"; design by Claude); extended by DEC-020 (stream alongside the bridge for `system: "dcn"`)
- **WO:** WO-066 (backend), WO-067 (UI, launcher)
- **Changes:** DEC-017 is no longer the primary DCN path; the DCN-SW API bridge stays as the optional control mode.

## Context
After DEC-017 the user supplied `DCN-SWSMD.pdf` (now `docs/source/DCN-SWSMD.pdf`, text in `docs/source/dcn-swsmd.txt`):
"DCN-SWSMD Streaming Meeting Data, Interface Manual" (Bosch, 2013). It describes a stream that the **DCN-SW server**
(the Windows Conference Software connected to the DCN NG CCU) offers to any number of clients:
- TCP, default port **20000** (`TcpIpActivityTraceListener` in `Server.exe.config`, optional IP address,
  `AllowedClients` allow-list, topic/activity filters, queue sizes).
- Each message = 8-byte header (Int32 LE topic, Int32 LE message length in bytes) + an XML "activity" (.NET
  XmlSerializer output, e.g. `<SeatActivity Topic="Seat" Type="SeatUpdated">…`). 12 topics, ~50 activity types.
- **One-way**: data sent by a client is ignored. **No snapshot request**: the server queues activities while no client
  is connected and replays them to the next client; after that only new activities arrive.
- Needs **DCN-SWSMD in the CCU licence key**; enabled by default otherwise.

The user wants DCN for following the meeting (seats, microphones, requests, voting results), not for operating it.

## Decision
1. New system id **`dcn-smd`**: Node connects straight to the DCN-SW server's SWSMD port. No Windows component, no
   credentials (access control is the server's IP allow-list). Code in `backend/src/dcn-smd/`.
2. **Read-only**: all domain actions are NOT_SUPPORTED; capabilities offer no actions. Operating DCN stays with the
   DCN-SW API bridge (`system: dcn`, DEC-017), which remains supported but optional.
3. **State is reconstructed from activities** (`state.js`): meeting (sessions, participants with seats, channels,
   booths), active session (votings, groups), discussion lists, seats, voting (state, answers, total results, interim
   results), priority, service calls, interpretation desks, microphone tests. It is **persisted** to
   `<dataDir>/dcn-smd-state.json` so a backend restart keeps the picture (the server replays what happened while
   we were away). The UI shows when the data was last confirmed and lets the operator reset it.
4. **Robust parsing**: own small XML parser (no dependency). Elements are matched by name with or without the
   `Container` suffix and with optional plural wrappers (`<Participants><ParticipantContainer>`), because the manual's
   examples are not consistent. Message text encoding is detected (UTF-16LE per the C# sample, UTF-8 per the XML
   declaration).
5. Raw topics `smd*` in the state cache; domain mappers `dcn-smd` feed the shared views (discussion, room plan with
   live microphones, camera director, voting results, participants, seating). A Settings → DCN stream view shows
   meeting, voting details, service calls, interpretation and the activity log.
6. A mock SWSMD server (`mock/dcn-smd/`) emits activities as the manual describes, for tests and UI work.

## Consequences
- Deploying DCN = make sure DCN-SWSMD is licensed, allow the LikeABosch PC in `AllowedClients` if a list is set
  (or leave it empty), open TCP 20000. Nothing to install on the DCN-SW PC.
- After a first connection in the middle of a meeting LikeABosch knows only what the queue replayed; the picture
  completes as activities arrive (e.g. the discussion lists with the next change). Documented in the UI.
- Only one consumer drains the replay queue: if another SWSMD client is connected, LikeABosch sees new activities only.
- The examples in the manual contain typos (smart quotes, self-closed elements with children); parsing is lenient,
  and the real stream must be checked on site (WO-065 extended).

## Alternatives considered
- Keep only the DCN-SW API bridge (DEC-017): full control, but needs a Windows program, the Bosch DLLs and the API
  licence; more than the user needs. Kept as the optional control mode.
- Replace `system: dcn` (bridge) by SMD under the same id: would break the bridge work for no gain; two ids keep
  both paths clear.
- XML library dependency (fast-xml-parser etc.): not needed for this small, flat XML; avoids a runtime dependency (DEC-002).
