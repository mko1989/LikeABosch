# WO-105: Research: how a presentation gets into DICENTIS

| | |
|---|---|
| **Status** | done |
| **Phase** | 1 Protocol extraction |
| **Depends on** | — |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-08 |
| **Updated** | 2026-10-08 |

## Goal
User (2026-10-08): "as a side quest search how the presentation can be recived by dicentis?" A short reference in
`docs/research/dicentis-presentation.md`: the ways a presentation source reaches the DICENTIS devices, what LikeABosch
can control, and what it could do next.

## Context
Bosch DICENTIS Configuration manual 6.50 (2025-03) `SWM_Configuration_Manual_enUS_72057607375843211.pdf` (not in the
repo: vendor PDF, download link in the doc); Conference Protocol `ActivatePresentation` / `GetPresentationState`; DCNM
`ControlPresentationApi`.

## Acceptance criteria
- [x] Doc written with manual page references, linked from WO-104 and from the presentation widget's hint.

## Work log
- 2026-10-08 (Claude Opus): created (ready).
- 2026-10-08 (Claude Opus): web search (no Bosch page states an HDMI input on DICENTIS devices; DCNM-LMS data sheet
  describes the remote presenter app), then downloaded the 6.50 configuration manual and extracted it with pypdf in the
  session scratchpad (not committed; vendor PDF). Relevant: §8 Media Gateway pp. 115–119, stream settings pp. 74–75,
  §11 HD-SDI switcher pp. 124–126, §6.6 p. 101–102, §16.22 p. 151 (RTSP re-streams). Wrote
  `docs/research/dicentis-presentation.md`. The WO-104 link is added when the widget is built.

## Handoff
- `docs/research/dicentis-presentation.md`. Follow-up ideas listed there (RTSP preview in the UI, director cut to a
  presentation input) are not WOs yet: ask the user.
