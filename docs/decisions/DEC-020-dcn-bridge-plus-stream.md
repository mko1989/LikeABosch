# DEC-020: DCN control via the bridge plus the meeting data stream at the same time

- **Status:** accepted (decided by user 2026-10-05: "Bridge + stream together" for live interpreter desks; design by Claude)
- **WO:** WO-073 (backend + settings), WO-074 (interpreter desks)
- **Extends:** DEC-017 (bridge), DEC-018 (stream). DEC-018's "one or the other" is lifted for `system: "dcn"`; the
  read-only `dcn-smd` system stays as it is.

## Context
The DCN-SW API (bridge) controls microphones, meetings and votings but knows interpreter desks only as configuration
(`config.MeetingApi.RetrieveMeetingDesks`: BoothId, output languages; no seat, no on-air state). The Streaming Meeting
Data (DCN-SWSMD) carries the live interpretation state (desk ↔ seat, translating, source and output channel/language)
but is read-only. Until now LikeABosch had exactly one upstream connection, so a DCN user had to choose.

## Decision
1. With `system: "dcn"`, the backend opens a **second, optional connection**: a `DcnSmdClient` to the DCN-SW server's
   SWSMD port, feeding the existing `DcnSmdSync` (`smd*` topics) next to the `dcn*` topics from the bridge.
2. Settings (connection manager, launcher, web Connection view): `smdStream` (bool, default **true**), `smdHost`
   (default empty = the bridge host, since the bridge runs on the DCN-SW PC), `smdPort` (default 20000).
   Environment: `DICENTIS_SMD_STREAM`, `DICENTIS_SMD_HOST`, `DICENTIS_SMD_PORT`.
3. The main connection state is the bridge's. The stream is secondary: its state and last error are reported in
   `/api/connection` as `stream`, it reconnects by itself, and its failure never fails or disconnects the bridge.
4. Domain mappers for `dcn` may read `smd*` topics where the bridge has nothing (interpreter desks first, WO-074).
   Control always goes through the bridge; the read-only refusal applies only to the `dcn-smd` system.

## Consequences
- One more TCP connection from LikeABosch to the DCN-SW PC (port 20000); the DCN-SW server must allow the LikeABosch
  machine (AllowedClients in Server.exe.config, if configured) and the CCU licence must include DCN-SWSMD. Without
  them the stream just stays "reconnecting" and the desks show no live state.
- The stream's persisted state (`dcn-smd-state.json`) is shared with the `dcn-smd` system.

## Alternatives considered
- Static desks from the bridge only (no live state): rejected by the user.
- Make the bridge forward the stream: the bridge would need to parse SWSMD; the Node client already does.
