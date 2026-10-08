# How a presentation gets into DICENTIS (WO-105)

Source: Bosch **DICENTIS Configuration manual 6.50 (2025-03)**,
`SWM_Configuration_Manual_enUS_72057607375843211.pdf`
(<https://assets.catalog.boschbuildingtechnologies.com/public/documents/SWM_Configuration_Manual_enUS_72057607375843211.pdf>,
not stored in the repo) and the DCNM-LMS data sheet. Page numbers = printed manual pages.

## Short answer
DICENTIS has **no HDMI/VGA input of its own** (multimedia devices have network + audio line-in only). A presentation
reaches the system as a **video stream over the network** or through an **external HD-SDI switcher**; DICENTIS then
switches between the camera picture and the presentation when *presentation mode* is on and distributes it to the
multimedia devices, interpreter desks with video (DCNM-IDESKVID, HDMI out) and the Meeting Application.

## The ways in
| Path | How | Where in the manual |
|---|---|---|
| **Local presentation source via an H.264 encoder** (Media Gateway) | HDMI/SDI from the presenter's laptop → a 3rd-party H.264 encoder (Bosch names Epiphan as an example for cameras) → RTP or RTSP stream (RFC 3984, unicast/multicast) → the **Media Gateway** takes it as an input; "Configuration: What is the stream for the local presentation". Media Gateway web page: `https://<server>:31416/Mediagateway`, needs "Configure system" rights; up to 10 H.264 inputs, ≤ 1080p. Recommended stream: 720p50/60 (1080p only if there are no multimedia devices), 2 Mbit/s target, 2.5 max, GOP 15, no B-frames. | §8 Media Gateway, pp. 115–119; stream settings pp. 74–75 |
| **External HD-SDI switcher** (TV One C2-xxxx / CORIOmatrix, Kramer MV-6) | The presentation is an input of the switcher (TV One: `RGB` = VGA port or `DVI`; CORIOmatrix: `Slot_<x>_in_<y>`; Kramer: none). Configured in `C:\Program Files\Bosch\DICENTIS\Configuration\Config.xml` → `<PresentationConfig><PresentationSources><VideoSwitchInput>`. In presentation mode the switcher shows the presentation instead of the speaker camera. Needs the "Bosch DICENTIS Ext.VideoSwitcher" service. | §11 External HD-SDI switcher, pp. 124–126 |
| **Remote presenter (screen share)** — DCNM-LMS/Presenter, hybrid meetings | A small app on the presenter's PC connects to the DICENTIS server and streams the screen to all multimedia devices; remote participants (Bosch Cloud) can share too. Local + remote control needs DCNM-DEMO/Premium/Ultimate licences; CRN/RENTAL only local. | DCNM-LMS data sheet; §6.6 p. 101–102; Media Gateway concept p. 116 |

## Turning it on/off
- *Presentation mode* (Premium/Ultimate licences): Meeting Application menu → Presentation On/Off (§5.2.6, p. 47),
  Synoptic taskbar (§6.6, p. 101), multimedia device, **Conference Protocol** `ActivatePresentation` /
  `DeactivatePresentation` / `GetPresentationState` (+ event `presentationStateChanged`) — used by LikeABosch today —
  and the DCNM API `ControlPresentationApi` (Activate/Deactivate/RequestPresentationStateAsync, `IsPresentationActive`).
- Interpreter desks with video can toggle Video / Presentation on their external monitor (DCNM-IDESKVID, p. 87).

## Getting the picture back out
The DICENTIS VideoSwitcher service re-streams both pictures (§16.22, p. 151):
- camera: `rtsp://<DICENTIS server>:9554/stream2` (camera control must be enabled)
- presentation: `rtsp://<DICENTIS server>:9554/stream1` (presentation stream must be enabled)

## What this means for LikeABosch
- We can already switch presentation mode (wired); the Room presentation widget (WO-104) shows it and the stream
  address above.
- Possible follow-ups (not planned): show the RTSP presentation stream in the UI (needs an RTSP→browser gateway such as
  WebRTC/HLS; a runtime dependency → DEC); when presentation mode is on, let the camera director cut the ATEM to a
  configured "presentation" input instead of the speaker shot.
