# logo

An animated **frozen ASCII** rendering of the invinite gear mark, drawn on a
`<canvas>`: the gear frosts in from the blade tips, a blue ice highlight rotates
around the rotor, cryo-vapour spills off the cold surface, sparkle shards chip
off and fall away, and a gentle pseudo-3D camera pans left↔right. Click it for
the obligatory anime _wow_.

It also doubles as a small **example of wrapping any static web build in a
container** so it can be deployed to Kubernetes, podman, or any host.

_Press **R** for rainbow mode; mash it to spin; double-tap to drill a magma
vent; ↑↑↓↓←→←→ B A erupts the whole mark._

## Develop

The source lives in `src/`: `index.html`, the ES modules (`main.js` +
`mask.js`, `util.js`), `assets/` (the `wow.mp3`), and `public/` (favicons + web
manifest). Built with [Vite](https://vite.dev); package manager is **yarn**
(vendored under `.yarn/releases/`, node pinned in `.node-version`):

```sh
yarn install
yarn dev             # local dev server with HMR
yarn validate        # eslint + prettier check (lint + format)
yarn lint:fix        # eslint --fix
yarn format:fix      # prettier --write
```

Linting uses the shared
[`@anarkisti/eslint-config`](https://github.com/eetu/eslint-config) `web` preset
(browser globals).

## Build

`npm run build` bundles and minifies the modules and inlines the JS/CSS **and**
the `wow.mp3` into a single self-contained `dist/index.html` (via
`vite-plugin-singlefile`); the favicons + manifest are emitted alongside it.

```sh
yarn build
yarn preview         # serve the built dist/ locally
```

## Container

A multi-stage image builds the bundle with Vite, then serves the built `dist/`
with rootless nginx on port **8080**.

```sh
docker build -t invinite-logo .
docker run --rm -p 8080:8080 invinite-logo   # → http://localhost:8080
# podman works the same: podman run --rm -p 8080:8080 invinite-logo
```

CI (`.github/workflows`) checks formatting + builds on every push/PR, and
publishes the image to **GitHub Container Registry** on `main` and tags:

```sh
docker pull ghcr.io/eetu/logo:latest
```

> First publish only: make the package public once in the repo's
> Packages → package settings (ghcr packages default to private).

## How it's made

Built with the **ascii-artist** skill from
[eetu/claude-skills](https://github.com/eetu/claude-skills)
(`creative-coding:ascii-artist`) — image→mask sampling, density-ramp glyphs,
particle systems, fbm-noise fields, a pseudo-3D camera, and the performance
rules that keep it cheap. `.claude/settings.json` auto-enables that skill when
working in this repo.

## Credits

- Gear mark: [invinite](https://www.invinite.fi/).
- "wow" sound: the anime _wow_ meme
  ([Myinstants](https://www.myinstants.com/en/instant/anime-wow/)).
