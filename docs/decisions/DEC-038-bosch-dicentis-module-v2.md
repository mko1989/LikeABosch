# DEC-038: The all-systems Companion module ships as v2 of the published `bosch-dicentis` module

- **Status:** accepted (decided by user 2026-10-14: "the devs want me to update this module with upgrades instead of
  creating a new one … without breaking any existing installs"; migration design by Claude, revisable)
- **WO:** WO-122
- **Supersedes in part:** DEC-036 points 1 (module id `bosch-discussion-system`) and 4 (old modules stay untouched).
  The rest of DEC-036 stands (network APIs only, one model, capability table; the `likeabosch` module).

## Context
DEC-036 built the combined module as a new Companion module (`bosch-discussion-system`). Bitfocus prefers updating the
published module over adding a second one for the same devices. The user's published module is
`bitfocus/companion-module-bosch-dicentis` (id `bosch-dicentis`, shortname `dicentis`, releases 1.0.0 … 1.1.2). Every
release uses the same ids: config `transport` (`websocket` | `rest`, absent before 1.1), `server_ip`, `rest_port`,
`rest_protocol`, `rest_login_path`, `rest_command_path`, `username`, `password`, `pollInterval`; actions
`custom_command`, `rest_request`, `toggle_microphone`, `activate_microphone`, `deactivate_microphone`,
`grant_interpretation`; feedbacks `mic_state`, `interpreter_state`; variables `Active_Microphone_*`,
`1st/2nd/3rd_Active_Speaker_*`, `Latest_Active_Speaker_*`. Seat options hold `<seatName>_<screenLine>` (sanitized),
interpreter options `<boothNumber>_<deskNumber>`.

## Decision
1. The combined module's code becomes **`bosch-dicentis` 2.0.0** (same id and shortname, so existing connections,
   their labels and `$(dicentis:…)` references stay). Worked on in
   `companion-module-dev/companion-module-bosch-dicentis-main` (a working copy of the Bitfocus repository);
   `companion-module-bosch-discussion-system` is not published and stays as the reference it was built in.
2. **One upgrade script** (index 0, so it runs once on every connection made with 1.x and never on new ones):
   - config: `transport: rest` → `system: wireless`, else `dicentis`; `server_ip` → `host`; `rest_port` /
     `rest_protocol` → `port` (only when not the protocol's default) / `https`; REST connections get `override: true`
     (1.x always took the session over). Old fields are dropped. A config that already has `system` is left alone.
   - actions: `toggle_microphone` / `activate_microphone` / `deactivate_microphone` → `seat_mic` (mode toggle / on /
     off); `grant_interpretation` (interpreter_seat, state) → `interpretation` (desk, state). `custom_command` and
     `rest_request` keep their ids and options (DICENTIS resp. REST systems).
   - feedbacks: `mic_state` → `seat_mic` with state `on` (1.x lit only for an open microphone);
     `interpreter_state` → `interpretation`. Inversion and button styles are Companion's and stay.
3. **Old option values resolve at run time** (an upgrade script cannot see the seats): a seat reference also matches the
   1.x key `<seatName>_<screenLine>`, and if the screen line changed since, `<seatName>_…` (longest seat name wins); an
   interpreter desk reference also matches `<boothNumber>_<deskNumber>` (the DICENTIS transport now reads the booths).
4. **The 1.x variables stay defined and filled** (button texts cannot be upgraded): `Active_Microphone_*` and
   `1st/2nd/3rd_Active_Speaker_*` from the open microphones in list order (1.x defined `2nd`/`3rd` but filled `2st`/`3st`:
   they now carry values), `Latest_Active_Speaker_*` from the last seat whose microphone opened. Dropped: the 1.x
   per-seat and per-desk variables (defined, never given a value) and the `pollInterval` setting (no polling).
5. Packaging follows the Bitfocus repository: yarn 4 (`packageManager`, `yarn.lock`), `@companion-module/tools`,
   `companion-module-build`. Tests that need LikeABosch's mocks skip when the mocks are not next to the module.

## Consequences
- Users upgrade in place; their buttons, triggers and variable texts keep working. New features (all systems, events
  instead of polling, more actions / feedbacks / variables) come with it.
- Small behaviour changes: toggle treats a muted DICENTIS speaker as speaking; mic on / off use
  `AddSeatToSpeakers` / `RemoveSeatFromDiscussionList` instead of `grantspeech` / `removespeech`.
- Two copies of the module code (bosch-dicentis and the reference bosch-discussion-system); bosch-dicentis is the one
  to change from now on.

## Alternatives considered
- **Publish `bosch-discussion-system` with `legacyIds: ['bosch-dicentis']`:** Bitfocus asked for the update instead.
- **Keep the 1.x action / feedback ids as hidden duplicates:** two definitions of the same thing; upgrade scripts are
  Companion's mechanism for renames.
