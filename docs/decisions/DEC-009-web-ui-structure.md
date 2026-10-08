# DEC-009: Web UI structure without a framework

- **Status:** accepted (proposed by Claude 2026-10-02 in WO-018; revisable); amended by DEC-011 (Room workspace + Settings area)
- **WO:** WO-018
- **Builds on:** DEC-002 (plain HTML/CSS/ES modules, no bundler), DEC-005 (SSE state)

## Decision
```
web/
  index.html            app shell: header (room, meeting, connection), nav, <main id="view">, toasts
  css/app.css           design tokens (light + dark), layout, shared components
  js/main.js            bootstrap: store.start(), router.start()
  js/api.js             fetch wrapper → returns `data`, throws ApiError { code, message, details, upstream }
  js/store.js           single live store fed by EventSource(/api/events)
  js/store-core.js      pure state reducer (no DOM/network) → unit-testable with node:test
  js/router.js          hash router (#/overview, #/connection, …) + view registry
  js/dom.js             h() element builder, toast(), confirmAction(), formatters
  js/views/<name>.js    one module per view
```
- **View contract:** `export default { id, title, topics?: string[], permissions?: string[], mount(el, ctx) → unmount }`.
  `ctx = { store, api, navigate }`. A view subscribes to the topics it needs and re-renders its own DOM.
  The nav greys out a view when none of its topics is available, or a required permission is missing.
- **Rendering:** build DOM with `h(tag, props, ...children)`. **Never assign server data to `innerHTML`**
  (XSS: participant names, agenda texts come from the server). Re-render a section by replacing its
  children; per-row keyed updates only where profiling shows a need (e.g. a big seat grid with timers).
- **Data flow:** read state only from the store (topics from SSE); write via `api.wired(op, params)` →
  passthrough (until WO-017's domain API exists; all calls go through `api.js` so they can be switched). The UI
  never updates state optimistically: it waits for the SSE update, which keeps it consistent with DICENTIS.
- **Styling:** CSS custom properties (light/dark via `prefers-color-scheme`), system font stack, no CSS framework.
  Neutral visual identity: **no Bosch logos or brand imitation**.
- **Testing:** pure modules (`store-core.js`, formatters) with node:test (`web/test/*.test.js`); visual and
  console-error checks with `scripts/ui-check.cjs` (headless Electron from `launcher/node_modules`).
- **Security header:** the backend serves the UI with a CSP `default-src 'self'` (no inline scripts).

## Alternatives considered
- Web Components / lit-html: lit-html would need a vendored copy; plain custom elements add ceremony
  without much gain at this size. Revisit if views get complex.
