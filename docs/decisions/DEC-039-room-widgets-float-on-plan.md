# DEC-039: Room widgets float on the plan, added by the operator; PTZ widget

- **Status:** accepted (requested by the user 2026-10-16: "the widgets i wanted to be able to add them to the room view
  so they are not tied to any particular inspector but they are just there. also add a ptz widget …"; design by Claude)
- **WO:** WO-127
- **Supersedes:** DEC-030 §1 (dock in the operate-mode side panel, default = all widgets shown). DEC-030 §2–4 stay
  (widget module shape, rebuild only on topic change, Settings views for configuration).

## Context
DEC-030 put the widgets in the side panel next to the inspector. An open inspector pushes them down or out of view, so
they feel bound to the inspector. Floating windows were rejected "for now" in DEC-030 because they hide seats; the user
now asks for exactly that.

## Decision
1. Widgets live in a **widget layer over the Room plan** (`.room-stage`), in operate and edit mode. They are in screen
   space: panning / zooming the plan does not move them.
2. The operator **adds** widgets from a "Widgets" menu in the Room toolbar (none by default) and removes them with the
   card's ✕. Each card is moved by dragging its header, can be collapsed, and comes to the front when touched. Positions
   are clamped so a card's header always stays inside the stage (also after a resize).
3. Placement, collapsed state, order and widget settings (the PTZ camera) are a per-browser preference
   (`localStorage` key `likeabosch.room.widgets.v2`), like the label size; the WO-104 key is no longer read.
4. New **PTZ widget**: camera picker, jog pad (`ptz.js`), current preset with "Overwrite", preset field with Recall / Save,
   quick chips for the presets the room uses. It never rebuilds while a PTZ button is held (same rule as WO-054).
5. One instance per widget type.

## Consequences
- The side panel is the inspector, director and speakers again; widgets never compete with it for space.
- Cards can cover seats; the operator moves or collapses them.

## Alternatives considered
- Widgets in their own column next to the inspector: less plan space for everyone, still a fixed list.
- Widgets pinned to plan coordinates (zoom with the room): unreadable when zoomed out.
