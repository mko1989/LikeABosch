# LikeABosch

Node.js backend + browser UI acting as a client for Bosch **DICENTIS** conference systems
(wired DICENTIS server via the Conference Protocol; DICENTIS Wireless via its REST API).

Status: Room workspace (top view, drag & drop, live mics) + PTZ camera automation (VISCA/Avonic, Panasonic AW, ONVIF → Blackmagic ATEM) working against simulated devices; full wired DICENTIS API verified end to end on a real 6.50 server; wireless backend + UI against the mock; Electron launcher (opens the browser).
Next: verify cameras/ATEM on hardware (WO-041), plugins view, security + packaging.

```
npm install && npm test          # backend, mock, launcher libs, web store
npm run mock:wired               # mock DICENTIS server (admin/admin) on wss://127.0.0.1:31416
npm run mock:wireless            # mock DICENTIS Wireless WAP (admin/admin) on http://127.0.0.1:8080/api
# cameras/switcher without hardware: add "Simulated camera" / "Simulated switcher" in Settings → Cameras & switcher
npm run ui:check                 # headless UI scenarios on both systems (needs launcher/ npm install)
cp .env.example .env && npm start   # backend + web UI on http://127.0.0.1:3000
cd launcher && npm install && npm start   # desktop launcher
npm run dist                     # installers in dist/: Windows setup .exe + zip, macOS dmg + zip (x64, arm64); see dist/README.txt
```

- Agent/contributor rules: [CLAUDE.md](CLAUDE.md)
- Roadmap and status: [work-orders/README.md](work-orders/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md) · Decisions: [docs/decisions/](docs/decisions/README.md)
- Protocols: [wired Conference Protocol](docs/protocol/conference/README.md) · [wireless REST](docs/protocol/wireless-rest/README.md)

Validate the extracted protocol spec: `node scripts/validate-conference-spec.mjs`
