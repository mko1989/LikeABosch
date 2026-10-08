# DEC-019: dcn-bridge token is optional (off by default)

- **Status:** accepted (decided by user 2026-10-05: "screw the token. i dont need that. this is for internal use")
- **WO:** WO-070
- **Supersedes:** the "token required" part of DEC-017 (§3 hello, §5 settings, Consequences); the rest of DEC-017 stays.

## Context
DEC-017 made a shared token mandatory in the bridge `hello`. On the first Windows run (WO-069) the bridge refused to
start without `--token`. The user: LikeABosch and the bridge are for internal use on the control network, the token
is not wanted.

## Decision
- The bridge starts without a token and then accepts every client's `hello` (any or no `token` field). It logs a
  warning at start-up that any client reaching the port can control the DCN system.
- `--token` / `DCN_BRIDGE_TOKEN` / config `token` stay available: when set, the bridge checks it exactly as before
  (`BAD_TOKEN`).
- LikeABosch: `bridgeToken` is optional (empty = none); connecting to DCN no longer requires it. The launcher and the
  web Connection view label it optional. The mock bridge has no token by default.

## Consequences
- Without a token, anyone who can reach TCP 9480 can switch microphones, run votings and log the DCN-SW API on with
  their own credentials (the DCN-SW user/password are still required by DCN-SW itself). Keep the port on the control
  network / firewall it to the LikeABosch machine; `--listen` binds one network card.
- WO-029 (security) can turn the token back on as a default for installations that need it.

## Alternatives considered
- Auto-generated token saved on first run: keeps protection with one copy step. Not wanted by the user.
- Removing the token feature entirely: no gain; keeping it optional costs nothing.
