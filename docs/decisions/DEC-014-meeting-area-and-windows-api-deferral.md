# DEC-014: Meeting area as a top-level tab; meeting preparation read-only; DICENTIS audio settings deferred

- **Status:** accepted (decided by user 2026-10-03; structure proposed by Claude); the Windows-sidecar deferral (§2–3) superseded by DEC-021 (2026-10-07)
- **WO:** WO-046, WO-048, WO-049, WO-050
- **Supersedes:** DEC-011 in part (top-level navigation: two areas → three)

## Context
The user asked for (2026-10-03): full seat details in the room editor, interpreter desks as special devices on the room
plan with quick controls, a separate tab with all meeting settings (meetings, participants, agenda, easy seat assignment),
and audio settings "with Dante sends/receives".
Checked against the docs (DEC-013 source ranking):
- The **Conference Protocol** can read meetings, agenda, participants and participant↔seat assignments, activate/open/close
  meetings and agenda topics, and fully control interpreter desks. It **cannot** create/edit participants or agenda topics,
  assign participants to seats, or change DICENTIS audio settings (only master volume and per-seat mic sensitivity).
- Those are only in the **Windows .NET DCNM API** (`IPrepareParticipant2.AssignParticipantsToSeatsAsync`,
  `IPrepareAgendaTopic`, `IRoomAudioControl` gains/EQ/routing/VU, `IPrepareSystemChannels`,
  `IConfigInterpretation` Dante language channels, seat `DanteOut`). It runs in-process on a Windows PC with the DICENTIS
  software, so using it means a Windows "sidecar" service (DEC-013 §3).

## Decision
1. Top-level navigation has three areas: **Room** (`#/room`), **Meeting** (`#/meeting/<view>`: meeting, agenda,
   participants, seating) and **Settings** (`#/settings/<view>`). The Meetings and Participants views move from Settings
   to Meeting. Legacy links redirect.
2. **Meeting preparation is read-only for now** (user): seat↔participant assignments are shown (and highlighted on the
   room plan), not edited. No Windows component yet.
3. "Dante sends/receives" means **DICENTIS's own audio settings** (user): per-seat mic to Dante out, interpretation
   languages to Dante, room audio gains/EQ/routing, VU meters. These need the .NET API, so they are **deferred** together
   with the Windows sidecar (WO-050, draft). Until then Settings → Audio offers what the Conference Protocol allows
   (master volume, per-seat microphone sensitivity, interpretation routing overview).
4. Interpreter desks are a separate device kind on the room plan (they are not in `GetSeats`; own ids from
   `GetInterpreterSeats`), placed like seats and cameras and stored in `room.json` (`desks`).

## Consequences
- Router gets a generic area model; `ui:check` routes change.
- When the user opts in to the sidecar, WO-050 is refined (Windows host, DLL availability, licence) and the Meeting area
  gains editing.

## Alternatives considered
- Windows sidecar now: full editing, but needs a Windows machine with DICENTIS software for development and testing (user: later).
- Local-only seat assignment inside LikeABosch: rejected by the user (would diverge from DICENTIS).
- Dante Controller-style routing (Audinate's undocumented protocol): not what the user meant.
