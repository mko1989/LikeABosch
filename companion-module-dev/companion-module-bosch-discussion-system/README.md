# Bosch Discussion Systems: Bitfocus Companion module

> **Superseded (DEC-038, WO-122):** this code ships as version 2 of the published module `bosch-dicentis`
> (`../companion-module-bosch-dicentis-main`, with upgrade scripts for 1.x connections). Make changes there; this folder
> is the reference it was built from and is not published.

A Companion module for DICENTIS (wired), DICENTIS Wireless (WAP), CCS 1000 D and DCN Next Generation (read-only meeting data). It talks to each system over its network API, so it needs no bridge. The end-user help is in `companion/HELP.md`.

## Layout

```
main.js                 instance: status, definitions (rebuilt when the seat list changes), variables, feedbacks
src/capabilities.js     the systems and what each one supports (actions, power states)
src/actions.js          actions, built from the capability table
src/feedbacks.js        feedbacks and the colours
src/variables.js        variables and their values
src/presets.js          preset buttons
src/model.js            pure helpers: seat lookup, microphone state, variable ids
src/config.js           configuration fields
src/upgrades.js         upgrade scripts for saved configurations
src/systems/            connections: base.js (status, reconnect), dicentis.js, rest.js (WAP and CCS 1000 D), dcn-smd.js
src/systems/smd/        frames.js, xml.js and state.js: copied unchanged from LikeABosch backend/src/dcn-smd
test/                   node:test suites
companion/              manifest.json and HELP.md for Companion
```

## Development

```
npm install
npm test
npx companion-module-build
```

- `npm install` installs `@companion-module/base` and `ws`.
- `npm test` runs the connection and module tests against the protocol mocks of the LikeABosch repository, two folders up (`../../mock`). The LikeABosch repository must be next to this one.
- `npx companion-module-build` packages the module for Companion.

The files in `src/systems/smd/` are copied unchanged from LikeABosch `backend/src/dcn-smd`. Change them there and copy them here, do not edit them in this module.
