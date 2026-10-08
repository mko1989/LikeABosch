# WO-090: Blackmagic ATEM: find switchers on the network (autodiscovery)

| | |
|---|---|
| **Status** | review |
| **Phase** | 5 Room & cameras |
| **Depends on** | WO-037, WO-040 |
| **Assignee** | Claude Opus (main) |
| **Created** | 2026-10-07 |
| **Updated** | 2026-10-07 |

## Goal
Settings → Cameras → Switcher: a "Find" button lists ATEM switchers found on the LAN (name, model, IP) and fills in the address.

## Context
DEC-012 (ATEM via atem-connection). Blackmagic devices announce themselves with mDNS/DNS-SD (Bonjour); ATEMs use the service type `_blackmagic._tcp` (TXT records with the model/name), which is what ATEM Software Control uses. No new dependency (DEC-002): a small mDNS query (PTR) over `node:dgram` multicast 224.0.0.251:5353.

## Scope
- In: `backend/src/devices/discovery/mdns.js` (query + parse PTR/SRV/TXT/A), `GET /api/devices/switchers/discover` (3 s browse), UI button + result list; unit tests with recorded/constructed packets and a local responder.
- Out: camera discovery (VISCA/ONVIF WS-Discovery could follow).

## Acceptance criteria
- [x] Parser tests (PTR/SRV/TXT/A, name compression); endpoint returns found devices from a local test responder.
- [x] UI: Find → pick → address filled; ui-check + screenshot. Real ATEM check by the user (WO-041).

## Work log
- 2026-10-07 (Claude Opus): created from the user's list in `next.md` ("blackmagic has an autodiscovery feature that id want to be added"); scope set (ready).

- 2026-10-07 (Claude Opus): `backend/src/devices/discovery/mdns.js`: PTR query for `_blackmagic._tcp.local` from a socket on 5353
  (multicast group, reuseAddr) and a legacy-unicast socket, 3 s; parser for PTR/SRV/TXT/A with name compression;
  instances filtered to TXT `class` ~ ATEM. `GET /api/devices/switcher/discover?timeoutMs=` (100–10000). UI: Settings →
  Cameras & switcher → "Find ATEM on the network" → list (name, model, address) → "Use" fills type + address.
  Tests `backend/test/mdns.test.js`: parsing with compressed names, a local responder (switcher found, HyperDeck
  filtered out), the endpoint. My first test run failed: the test's packet builder counted the header twice. Live check
  on this Mac: binding 5353 works; no ATEM on this LAN (dns-sd agrees); the same parser read real mDNS answers of other
  devices on the LAN (service types list). ui-check: Find → "No ATEM answered". `npm test` 257/257, `node scripts/ui-check.mjs` (all systems) OK, `npm run e2e:wireless:mock` 23/23 checks, `npm run e2e:mock` 31/31.

## Decisions
- Service type and TXT `class=AtemSwitcher` as used by ATEM Software Control / Bitfocus Companion; not verified on a real ATEM yet.

## Handoff
Delivered: ATEM autodiscovery. Status `review`. Open: try with a real ATEM on the same network (WO-041).
