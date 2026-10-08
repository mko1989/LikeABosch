# DEC-013: Product name LikeABosch; newer vendor docs (CHM) and how they rank

| | |
|---|---|
| **Status** | accepted (user + Claude); §3 superseded by DEC-021 (2026-10-07) |
| **Date** | 2026-10-03 |
| **Work orders** | WO-043, WO-044 |

## 1. Product name
The app is called **LikeABosch** (user, 2026-10-03), not a generic "DICENTIS client". Used in the web UI title/header,
`document.title` and the launcher. "DICENTIS" is still used where it names the Bosch system being controlled.

## 2. Source ranking for the Conference Protocol
The user supplied `ConferenceProtocol.chm` (DICENTIS 7.0 edition, Electro-Voice/Dynacord 2026). Ranking when sources disagree:
1. Behaviour observed on a real server (e2e runs, recorded in `extractionNotes`), because that is what the app talks to.
2. The 7.0 CHM, which replaces the older PDF as the documentation reference.
3. The PDF (`docs/source/ConferenceProtocol.pdf`), kept for page references (`sourcePages`).
Operations newer than the server we can test (6.50) stay in the spec but are marked with their version and remain unverified
until a newer server is available.

## 3. DCNM .NET API is out of scope
`DcnmApiDocumentation.chm` documents `Bosch.Dcnm.Interfaces.Api`, a Windows .NET assembly that connects as a DICENTIS
device. It cannot be used from Node without a .NET sidecar on Windows. It is kept as reference only (notably DICENTIS's
own camera model: `IControlCamera.CameraActiveStateChanged`, "make your own external video switcher"). Our camera
automation (DEC-012) remains independent of it. Revisit only if a feature exists solely in that API.
