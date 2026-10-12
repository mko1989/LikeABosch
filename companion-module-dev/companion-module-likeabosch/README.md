# LikeABosch: Bitfocus Companion module

A Companion module for the Bosch system that LikeABosch is connected to (DICENTIS, DICENTIS Wireless, CCS 1000 D, DCN). It is a thin client of LikeABosch's quick-actions API (DEC-035): it gets live state over the server-sent events stream and sends actions to LikeABosch. It also has the camera director and raw calls to LikeABosch's bridge APIs. The end-user help is in `companion/HELP.md`.

## Layout

```
main.js                 instance: status, definitions (rebuilt when the seat list changes), variables, feedbacks
src/client.js           client of LikeABosch: SSE state stream with reconnect, quick actions, any API call
src/model.js            pure helpers: seat lookup, seat labels, variable ids
src/actions.js          seat, discussion, camera and bridge API actions
src/feedbacks.js        feedbacks and the colours
src/variables.js        variables and their values
src/presets.js          preset buttons
src/config.js           configuration fields
test/client.test.js     tests against a real LikeABosch backend with a simulated DICENTIS
companion/              manifest.json and HELP.md for Companion
```

## Development

```
npm install
npm test
npx companion-module-build
```

- `npm install` installs `@companion-module/base` and `@companion-module/tools`.
- `npm test` starts a real LikeABosch backend from the LikeABosch repository, two folders up from this module folder, with a simulated DICENTIS, and runs the client and actions against it. The test needs that repository checked out in place.
- `npx companion-module-build` packages the module for Companion.
