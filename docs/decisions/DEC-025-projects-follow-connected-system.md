# DEC-025: A project belongs to a DICENTIS system; connecting to another system opens that system's project

- **Status:** accepted (requested by the user 2026-10-07: "when connecting to another system it still loads with the
  same project which doesn't make sense"; rules by Claude, revisable)
- **WO:** WO-093
- **Extends:** DEC-016 (projects). DEC-016 §1 stays: the connection is not stored in a project and opening a project
  never reconnects. The link goes the other way: system → project.

## Decision
1. A project's `project.json` may carry `system: { key, label, type, host, port }`; `key` = `<type>:<host>:<port>`,
   `label` = the name the system reports (wired room name, WAP host name) or "<type> <host>".
2. When the main connection reaches a system (state `loggedIn`, a different key than handled last):
   - the open project already belongs to it → nothing;
   - the open project belongs to no system yet → it is linked to this one (existing projects are adopted by the system
     they are first used with);
   - else the project last used with this system (opened most recently) is opened, or a new empty project named after the system
     is created and opened. A toast says which.
   A reconnect to the same system changes nothing, so a project opened by hand stays open until another system is
   connected.
3. New projects, copies ("Save as…") and loaded files belong to the connected system (a copy keeps the original's).
4. `PATCH /api/projects/:id { system: 'connected' | null }` links a project to the connected system or unlinks it. The
   project bar shows a warning tag when the open project belongs to another system; clicking it links it here.
   Topic `project` gains `connected` and `lastOpen { id, reason: user | system | system-new | system-adopt, label }`.

## Alternatives considered
- Ask before switching: the user expects the right project, and the switch is harmless (auto-saved, reversible).
- Store the connection in the project (opening a project reconnects): rejected by the user in DEC-016.
