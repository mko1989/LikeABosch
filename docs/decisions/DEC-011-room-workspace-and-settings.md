# DEC-011: Room workspace as the main screen; existing views move under Settings

- **Status:** accepted (decided by user 2026-10-03; structure proposed by Claude); navigation partly superseded by DEC-014 (Meeting area)
- **WO:** WO-033, WO-035
- **Amends:** DEC-009 (navigation), DEC-008 (Launch GUI opens the system browser)

## Decision
- Top-level navigation has two areas:
  - **Room** (`#/room`, default): top view of the meeting room. Operators place seats and cameras by drag & drop
    (edit mode), and in operate mode see live mic/speaker states, camera tally/state, and switch mics on/off by
    clicking a seat.
  - **Settings** (`#/settings/<view>`): everything that existed before (Overview, Seats & discussion, Meetings, Voting,
    Participants, Interpretation, System, Files & notes, Plugins, Connection) plus the new **Cameras & switcher** and
    **Camera automation** settings.
- The launcher's **Launch GUI opens the system browser** (no Electron window).

## Consequences
- Router supports nested routes; Settings has its own side navigation; Room uses the full width.
- Existing views are unchanged in behaviour (moved, not rewritten); `ui:check` routes are updated accordingly.
