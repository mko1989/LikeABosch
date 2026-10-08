# Mock behaviours

Each module exports `{ OperationName: (ctx, params) => responseParameters }`.

- `ctx.state`: shared mock state (`../state.js`)
- `ctx.fire(...events)`: mark events as changed (delivered to connections that registered them and are armed)
- `ctx.fail(message)`: throws, so the client receives `{ operation: "error", parameters: { message } }`
- `ctx.user`: logged-in user name

Operations without a behaviour return a default response shaped from the spec (`defaultFor`).
Keep behaviours close to the real server; when the real server differs (WO-028), fix it here and add a test.
