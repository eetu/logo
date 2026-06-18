# logo

An animated **frozen ASCII** rendering of the invinite gear mark, drawn on a
`<canvas>`: the gear frosts in from the blade tips, a blue ice highlight rotates
around the rotor, cryo-vapour spills off the cold surface, sparkle shards chip
off and fall away, and a gentle pseudo-3D camera pans left↔right. Click it for
the obligatory anime _wow_.

It also doubles as a small **example of wrapping any static web build in a
container** so it can be deployed to Kubernetes, podman, or any host.

## Develop

No install needed to run — open `index.html` directly, or serve it:

```sh
npm run serve        # http://localhost:8080  (python3 http.server)
```

Tooling (formatting) does need deps:

```sh
npm install
npm run format       # prettier --write
```

## Build (optional single-file bundle)

For dropping the logo somewhere as **one portable file**, `build.mjs` inlines
every referenced asset (the `wow.mp3`) as a `data:` URI into `dist/index.html`:

```sh
npm run build
```

Handy for emailing/embedding, but heavier on first paint (the audio rides inside
the HTML). The container below deliberately does _not_ use it.

## Container

The image serves the **split assets** (`index.html` + `wow.mp3`) with rootless
nginx on port **8080**. The HTML stays tiny so first paint is fast, and the mp3
is fetched lazily (warmed after first render, played on click) — so audio never
blocks load.

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
