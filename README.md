# Stalinload

**Status:** public repo. The `main` build is deployed to GitHub Pages at
<https://mantas6.github.io/miner-mp/>; run it locally with Vite (`npm run dev`)
or build with `npm run build`.

A small browser-based Motherload-style mining game. Mine ore, return to the surface depot, sell cargo, upgrade the ship, and survive deeper hazards/enemies as the mine keeps going down.

The client is React + TypeScript around a canvas: React paints the chrome from a
zustand store, the canvas renders the mine, and the simulation runs in fixed
60 Hz steps so tick-based tuning behaves the same on any refresh rate. Booting
walks a UI phase machine — intro splash → playing.

The mine is persistent. Terrain is never stored tile by tile — it regenerates
from its coordinate seed — so the save keeps the *diff*: the list of
`shared/world-schema.ts` tile entries the miner changed. Dying or refreshing
rebuilds the terrain and lays that diff back over it, so tunnels, mined ore, and
cracked blocks stay where you left them. The save keeps the newest 20,000
mutations and forgets older ones rather than outgrowing `localStorage`.

The ship is part of that mine. The save records the tile it parked on, so a
refresh resumes down the shaft instead of at the depot — with a full tank, a
whole hull and an empty cargo bay, since none of those are saved. Only dying
costs you your position. If the restored mine turns out to be solid rock at that
tile (a capped save), the ship starts at the depot rather than buried, because
the drill cannot dig upward.

Underground fog of war is persistent. Movement permanently reveals a fixed 3x3 square around the ship. Surface rows are always visible.

## Project structure

Unit tests live next to the code they cover as `*.test.ts` (or `*.test.tsx` for
components) siblings. The browser-only behaviour they cannot reach — canvas focus,
native `<dialog>`s, `:focus-visible`, the boot flow — is covered by the Playwright
suite in `e2e/`.

```text
miner-mp/
├── README.md
├── AGENTS.md
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── tsconfig.e2e.json
├── vite.config.ts
├── playwright.config.ts
├── .oxlintrc.json
├── .oxfmtrc.json
├── init.sh
├── start.sh
├── test.sh
├── shared/
│   ├── constants.ts
│   ├── exploration-codec.ts
│   ├── tile-key.ts
│   └── world-schema.ts
├── soundtrack/
│   ├── engine.py
│   ├── render.py
│   └── tracks/
│       ├── __init__.py
│       └── golden_signal.py
├── public/
│   └── assets/
│       └── music/
│           ├── golden-signal.mp3
│           └── golden-signal.ogg
├── src/
│   ├── main.tsx
│   ├── persistence.ts
│   ├── core/
│   ├── world/
│   ├── game/
│   ├── render/
│   ├── audio/
│   │   ├── audio.ts
│   │   ├── audio-permission.ts
│   │   ├── encoding.ts
│   │   └── tracks.ts
│   ├── ui/
│   └── styles/
├── e2e/
│   ├── boot.spec.ts
│   ├── gameplay.spec.ts
│   ├── dialogs.spec.ts
│   ├── focus-visible.spec.ts
│   ├── failure.spec.ts
│   └── support/
│       └── game.ts
└── .github/
    └── workflows/
        ├── build.yml
        └── deploy-pages.yml
```

| Path | Purpose |
|---|---|
| `AGENTS.md` | Working agreements for anyone changing the code: avoid UI clutter, keep the rules pure, verify with `./test.sh`. |
| `index.html` | Main game page and root mount node; loaded by Vite. |
| `shared/constants.ts` | World constants, camera scale (36px tiles), persistence limits, ore and artifact tables. |
| `shared/exploration-codec.ts` | Fog-of-war index math and the run-length encoding used by persistence. |
| `shared/world-schema.ts` | Zod schemas and derived types for tiles, enemies, and the persisted world state. |
| `shared/tile-key.ts` | Canonical `"x,y"` coordinate key used by tile maps. |
| `src/main.tsx` | Vite entry point: imports global styles and renders the app inside `<StrictMode>` and an error boundary, handing the game-runtime factory to it. |
| `src/persistence.ts` | Local save/load of player progress, the ship's parked tile, explored tiles, and the world's tile diff (`localStorage`). |
| `src/core/` | Pure gameplay rules and types: balance, economy, upgrades, shop catalog, movement, weapon, dynamite, teleporter, cargo containers, enemies, objectives, extraction, scanner, fuel reserve, depth milestones, spoken ship status, stats, danger, fixed-step clock, developer tools. |
| `src/world/` | World generation, the tile diff that turns a saved world back into terrain (`tile-diff.ts`), world-state reset, and visible tile range. |
| `src/game/` | Gameplay orchestration (`game.ts`, the `createGameRuntime()` factory) plus its feature modules — `enemies.ts`, `actions.ts`, `move.ts`, `run.ts`, `input.ts`, `world-grid.ts`, `viewport.ts`, `zoom.ts` (wheel/pinch camera zoom maths), `zoom-settings.ts` (the remembered zoom level), `readouts.ts`, `scanner-devices.ts`, `dynamite-sticks.ts`, `cargo-containers.ts` — the canvas surface factory (`dom.ts`) and the teardown registry every side effect registers with (`disposal.ts`). |
| `src/render/` | Canvas drawing, and the terrain/fog chunk cache policy. |
| `src/audio/` | Web Audio graph, sound effects, soundtrack playback, and autoplay permission. |
| `src/audio/tracks.ts` | Track registry for playback: the `TrackId` union, `TRACKS` (title plus mp3/ogg URLs), `DEFAULT_TRACK_ID`. |
| `src/audio/encoding.ts` | `prefersMp3()`/`pickSource()`: the one place that decides mp3 or ogg for an asset that ships as both. |
| `soundtrack/engine.py` | Track-agnostic synth/render/encode engine (stdlib only): oscillators, envelope, note names, event bucketing, 44.1 kHz stereo WAV mixdown, `tanh` saturation, loop-edge fades, and the ffmpeg mp3/ogg encode. |
| `soundtrack/tracks/golden_signal.py` | "Golden Signal", the built-in Soviet/industrial mining march: patterns, voices, tempo, seed. Also the template for new tracks. |
| `soundtrack/tracks/__init__.py` | Generator-side registry: the `TRACKS` dict keyed by slug and `get_track()`. |
| `soundtrack/render.py` | CLI that renders registered tracks into `public/assets/music/`. |
| `public/assets/music/` | The shipped soundtrack assets (`golden-signal.mp3`, `golden-signal.ogg`) — build products of `soundtrack/render.py`, copied verbatim into `dist/` by Vite. |
| `src/ui/` | React components, the zustand UI store (`store.ts`), the command table the buttons dispatch into (`commands.ts`), the effect that owns the runtime's lifetime (`useGameRuntime.ts`), the boot/crash notices (`Failure.tsx`), and co-located CSS modules. |
| `src/styles/base.css` | Design tokens plus element-level styling (`button`, `ul`, `kbd`, `meter`, `canvas`, `#shell`, `#game-panel`) and the app-wide `:focus-visible` ring. |
| `src/styles/icons.css` | Global equipment sprite sheet (`icon-*`), addressed by name from the shop catalog. |
| `src/styles/intro-art.css` | Global intro badge art. |
| `vite.config.ts` | Vite build config (relative `base`, React Fast Refresh) and Vitest test config. Vitest only collects `src/**` and `shared/**`, so `e2e/` is never picked up by `npm test`. |
| `tsconfig.test.json` | The test half of `npm run typecheck`: the same strict options plus `vitest/globals`, which `tsconfig.json` withholds from production source. |
| `tsconfig.e2e.json` | The third `npm run typecheck` pass: `e2e/` and `playwright.config.ts`, which run in Node and so need those globals rather than Vitest's. |
| `playwright.config.ts` | End-to-end config: one Chromium project, the Vite dev server started as a `webServer`, and the local/CI browser resolution described under "End-to-end tests". |
| `e2e/` | The Playwright suite — boot flow, keyboard mining, the modal dialogs and focus restoration, the `:focus-visible` ring, and the runtime-failure notice — plus `support/game.ts`, the shared page fixtures. |
| `.oxlintrc.json` | Lint rules for `src/`, `shared/` and `e2e/` (oxlint), with the reason behind every disabled rule. |
| `.oxfmtrc.json` | oxfmt configuration; `npm run fmt` formats every stylesheet under `src/`. |
| `init.sh` | Installs dependencies and starts a background Vite dev server for smoke testing. |
| `start.sh` | Builds, then runs the preview server. |
| `test.sh` | Full check sequence: lint, CSS format check, unit tests, typecheck, production build, and the Playwright suite when a system Chromium is available. |
| `.github/workflows/build.yml` | CI: lint, CSS format check, typecheck, unit tests and production build, plus a parallel job that installs Chromium and runs the Playwright suite. |
| `.github/workflows/deploy-pages.yml` | Manually triggered GitHub Pages deployment of `dist/`. |

## Runtime lifecycle

The simulation is mounted by React, not by module import order. `main.tsx` renders
the shell inside `<StrictMode>` and an error boundary, handing it
`createGameRuntime` as a prop; `useGameRuntime` (in `src/ui/`) calls that factory
from an effect with the mounted `#game` canvas and `#game-panel`, and disposes the
runtime again on cleanup. Three consequences:

- **No `flushSync`.** The canvas and the panel arrive as refs, so nothing has to
  read the DOM at import time and no render has to be committed synchronously.
- **Everything is revocable.** Window and document listeners, the 60-second save
  interval, the focus timeout and the animation-frame loop all register their undo
  with `src/game/disposal.ts`, so `dispose()` leaves nothing behind — which is what
  makes dev StrictMode's double invocation (and Fast Refresh, and a crash remount)
  produce exactly one live runtime instead of two stacked simulations.
- **Failure is visible.** The boot reports `booting | ready | failed` into the
  store. A refused boot renders the "Mine offline" notice, and a React crash
  renders "Interface crashed" (`src/ui/Failure.tsx`) — instead of a silently dead
  canvas, or a canvas still simulating behind a HUD that unmounted.

Game code stays React-free: the bridges remain store writes, the `commands.ts`
table, and the two element refs. Teardown also resets that table to no-ops, so a
button can never reach a disposed runtime.

## Run locally

Install dependencies once:

```bash
npm install
```

Start the Vite development server (it binds `0.0.0.0`, so other devices on the
network can reach it too):

```bash
npm run dev
```

Then open the local URL printed by Vite, usually:

```text
http://localhost:5173/
```

`./init.sh` does the same thing unattended: it installs dependencies and starts
the dev server in the background, logging to `.vite-dev.log` and recording the
pid in `.vite-dev.pid`. Set `START_DEV_SERVER=0` to install only.

## Build

Create a production build in `dist/`:

```bash
npm run build
```

Preview the built site locally:

```bash
npm run preview
```

## Cheats

The cheat menu — cash grants, free refuel/repair, free upgrades, and the player
and world reset controls — lives in the **Settings** tab of Info / Cargo, behind
a "Show cheat menu" disclosure. It is available in every build with no
environment opt-in, and it is mounted only while that disclosure is expanded.

The world reset regenerates terrain, enemies, caches, and fog while preserving
the player's cash, upgrades, inventory/cargo, stats, ship condition, and
settings.

## Controls

Ship movement and aiming are keyboard-only. Pointer/touch input is used for UI
only (menus, buttons, modals, starting the run, restarting, audio unlock) plus
zooming the camera with the wheel or a trackpad.

| Action | Keyboard | UI (click/tap) |
|---|---|---|
| Start a run | `Enter` or `Space` | Click/tap intro screen |
| Move / fly / dig | `WASD` or arrow keys | — |
| Sprint through open space | Hold `Shift` + direction | — |
| Zoom the camera (0.5x–2x, remembered) | — | Wheel scroll or trackpad pinch over the mine |
| Sell cargo at the depot | `Enter` | Sell button |
| Depot service | `Space` (sells cargo first, then refuels, then repairs) | Shop & Equipment -> Refuel / Repair |
| Plant dynamite (5 s fuse) | `E`, then press a mine tile | Dynamite inventory slot, then a mine tile |
| Deploy a scanner | — | Scanner inventory slot, then a mine tile |
| Set a cargo container down | — | Container inventory slot, then a mine tile |
| Open a placed cargo container (on it or beside it) | `C` | Press the crate on the mine |
| Move a stack between the crate and the bay | — | Press the stack in either column |
| Cancel a placement | `Escape` | The armed slot again |
| Teleporter round trip (100 m+, spends one carried teleporter) | `T` | Teleport button |
| Fire a carried Linebreaker (single use) | `G` then a direction key | Arm Gun button, then a direction key |
| Cancel gun aim | `G` or `Escape` | Arm Gun button again |
| Cargo, stats and guides | — | Info / Cargo button |
| Close a dialog | `Escape` | × button or the backdrop |
| Redeploy mid-run | `R`, then `R` again within 3.5 s | — |
| Restart after game over | `R` | Click/tap outside the dialogs |
| Toggle sound | — | 🔊 button; a trusted pointer/touch gesture may auto-enable |
| Reset world | — | Info / Cargo -> Settings -> cheats -> Reset World State |

## Accessibility

- **One keyboard target.** The `#game` canvas is the game surface's only tab stop
  (`role="application"`, so a screen reader hands the arrow keys through), named and
  described by a visually hidden instruction paragraph. `#game-panel` is layout
  only. The runtime focuses the canvas at boot, when the window regains focus, and
  once a run starts.
- **Focus is visible when it was asked for.** One app-wide `:focus-visible` ring in
  `base.css`. Programmatic focus after a click — including the focus a closing
  dialog restores to the button that opened it — draws nothing, while a session
  driven from the keyboard keeps its ring. `e2e/focus-visible.spec.ts` pins both.
- **State outside the canvas.** The meters and readouts are text, the toast and the
  fuel banner are live regions, and `#game-status` politely announces the ship's
  situation — at the depot, in the mine, holds full, hull critical, ship lost. It is
  driven by thresholds, so the 60 Hz HUD sync never makes it talk.
- **Native dialogs.** The intro prompt is a `<button>`; the shop, info and
  cargo-container overlays are modal `<dialog>`s, so the browser contains Tab,
  makes the rest of the page inert, and each close returns focus to the control
  that opened it.
- **`prefers-reduced-motion`.** The looping start-prompt, low-fuel and HUD-alert
  animations stop; the alert colours stay.

## Gameplay notes

- You start with limited cash, fuel, hull, cargo capacity, and drill power.
- Dig ore, return to the surface, and sell cargo for cash.
- The cargo bay (`src/core/inventory.ts`) holds a total *item count*, not a fixed
  number of slots, shown as a collapsible HUD panel. Each ore type stacks in one
  row, but what limits a load is the sum of every stack against the Cargo Bay
  upgrade's capacity — equipment counts toward it too, so a bay crammed with tools
  mines less ore. A fresh bay holds 20 items; each Cargo Bay level adds 10, up to
  1000. Selling empties every ore stack at once and frees that room again.
- Refuel and repair at the surface depot.
- The depot shop sells four upgrades — Cargo Bay, Fuel Tank, Hull, Drill — plus
  the consumables: dynamite, teleporters, scanners, Linebreaker guns, and cargo
  containers. Upgrade prices rise with each level; consumables are a flat price
  each.
- Artifacts pay out immediately in cash and never take a cargo slot; dynamite
  and gunfire destroy valuables without any payout.
- Dynamite and scanners are carried in the cargo bay and placed from their own
  inventory slot onto explored, cleared ground. A planted stick blows a 2-tile
  radius five seconds later — long enough to get clear, and close enough to
  wreck a ship that did not.
- The Linebreaker gun rides in the cargo bay the same way, but is spent rather
  than placed: arming it and pressing a direction fires one shot up to 8 tiles
  and removes the item from the bay. There is no ammunition — a shot costs a gun.
- Teleporters ride in the bay too, and are also spent rather than placed: from
  100 m or deeper one takes the ship to the depot and leaves a return point
  behind. The trip up costs the item; the trip back is free.
- Cargo containers (`src/core/cargo-container.ts`) are the one purchase that is
  never used up. Set one down on explored, cleared ground from its inventory slot
  and it becomes a 50-item store standing in the mine, obeying the same stacking
  rules as the bay. Press it from an adjacent tile — or `C` while on or beside it —
  to open a two-column transfer menu; a press on a stack sends it to the other
  side, up to whatever room the destination has left, and Ctrl-click (⌘ on a Mac)
  moves just one item of the stack. A crate keeps what it holds
  through death, reload and the sale of everything aboard, which makes it the only
  way to protect ore from a lost run. Anything taken back out still counts against
  the Cargo Bay upgrade's capacity, so a crate buys storage, never carrying
  capacity. Six may stand in the mine at once.
- Low fuel warnings appear below 25%; return to the surface quickly.
- The HUD reserve readout forecasts the climb home (safe/caution/urgent), the
  scanner reads the tile the drill is aimed at, and the depth readout counts
  down to the next landmark and toasts when you cross one.
- Drilling upward is blocked; use tunnels to fly back up.
- Side-drilling requires solid ground under the ship.
- Rock, magma pockets, depth, and enemies make deeper mining more dangerous:
  Tunnel Fiends first, then Skitterlings, Ironbacks, and Abyss Stalkers.
- Enemies wake when exposed nearby; drill them before they chew through the hull.
- The mine has no bottom: the run's goal is to keep hauling richer loads up alive,
  upgrading, and setting depth records. A Motherlode core sits at 10,000 m as a
  bonus landmark — crack it, then return alive to the depot to bank the extraction.
- Progress (cash, upgrades, stats, explored tiles, the mine you dug, and where you
  parked) is saved locally; death keeps all of it and costs you the cargo and your
  position.
- The camera zoom is remembered too, but as a preference rather than progress:
  it is stored under `moleload:zoom-settings:v1` (`src/game/zoom-settings.ts`),
  clamped back into the 0.5x–2x range on load, and survives a death, a fresh
  world, and a player-data reset.

## Soundtrack

The music is a pair of ordinary audio files shipped in the repo —
`public/assets/music/golden-signal.mp3` (~3.5 MB) and `.ogg` (~2.0 MB) — served
as static assets, so the browser only downloads and loops them. They are build
products: the source of truth is the `soundtrack/` Python package, which
synthesizes the audio from scratch (stdlib only) and encodes it with ffmpeg.

The built-in track is **Golden Signal** (slug `golden-signal`): an A-minor
Soviet/industrial mining march at 125 BPM — bassline, lead, chord stabs, kick,
snare and hats, all seeded from `1917`, rendered 175 s long by default.

### Generator

| Module | Role |
|---|---|
| `soundtrack/engine.py` | Track-agnostic engine: oscillators (`sine`/`saw`/`tri`/`square`), the attack/sustain/release envelope, note-name helper, event bucketing, stereo panning, `tanh` bus saturation, and the per-sample mixdown into a 44.1 kHz 16-bit stereo WAV. `encode_with_ffmpeg()` then writes mp3 (160 kbps, libmp3lame) and ogg (128 kbps, libvorbis) beside it. |
| `soundtrack/tracks/golden_signal.py` | The music itself — patterns, note choices and per-voice timbres — exported as an `engine.Track`. Copy this file to start a new track. |
| `soundtrack/tracks/__init__.py` | The `TRACKS` registry keyed by slug, plus `get_track()`. |
| `soundtrack/render.py` | The CLI: track selection, duration/output overrides, and the render loop. |

Rendering is deterministic: the same track and duration always produce a
byte-identical WAV (the shared `random.Random` stream is seeded from the track).
The mp3/ogg bytes additionally depend on the ffmpeg build doing the encode.

The engine fades the first and last 1.25 s of every render, so the loop point is
quiet rather than seamless.

### Re-rendering

```bash
python3 soundtrack/render.py --list                 # registered tracks
python3 soundtrack/render.py golden-signal          # overwrite the shipped assets
python3 soundtrack/render.py --all                  # every registered track
```

Output goes to `public/assets/music/` unless `--out-dir DIR` says otherwise, and
`--duration N` overrides the track's default length. ffmpeg must be on `PATH`
for the mp3/ogg encode — without it the script writes the WAV and stops. The
intermediate WAV is deleted once both encodes exist; pass `--keep-wav` to keep
it.

The mixdown is a pure-Python per-sample loop, so the default 175 s render costs
roughly a minute of CPU; use `--duration` with a throwaway `--out-dir` when you
only want to check an arrangement.

### Adding a new track

1. Copy `soundtrack/tracks/golden_signal.py` to
   `soundtrack/tracks/<slug_with_underscores>.py` and edit its metadata
   (`NAME`, `SLUG`, `BPM`, `SEED`, `DEFAULT_DURATION`), `build_events()` and
   `render_sample()`.
2. Register it in `soundtrack/tracks/__init__.py` by adding
   `<module>.SLUG: <module>.TRACK` to `TRACKS`.
3. Render it: `python3 soundtrack/render.py <slug>` — this writes
   `public/assets/music/<slug>.mp3` and `.ogg`, which are committed.
4. Add the id to the `TrackId` union and an entry to `TRACKS` in
   `src/audio/tracks.ts` (title plus the two asset URLs). `TRACKS` is a
   `Record<TrackId, MusicTrack>`, so it will not compile until every id has an
   entry.

### Playback

`src/audio/audio.ts` plays the soundtrack through a plain `HTMLAudioElement`,
outside the Web Audio graph the sound effects use. On the first `init()` it
picks the encoding once via `canPlayType('audio/mpeg')` — mp3 where supported,
ogg otherwise — then sets `loop` and `volume = 0.36`.

Nothing plays until a trusted user gesture — either HUD audio button, or a
trusted `pointerdown`/`touchstart` (see `src/audio/audio-permission.ts`). If the
browser still rejects `play()`,
`startSynthMusic()` takes over with a small Web Audio chiptune loop routed
through the music gain (0.065) under the 0.55 master, so the run is not left
silent. Muting the music pauses the element and clears the fallback timer.

`setTrack(trackId)` swaps the element's `src` to another registered track and
restarts playback from that track's beginning if music was already running.

## Audio/browser notes

- Browsers usually require a user gesture before audio can start.
- The HUD exposes two toggles for explicit activation: `musicBtn` for the
  soundtrack and `sfxBtn` for the sound effects. Each one mutes only its own
  side, and both preferences are stored under `moleload:audio-settings:v1`
  (`src/audio/audio-settings.ts`).
- `audio.enabled` means the shared `AudioContext` is unlocked; `musicEnabled` and
  `sfxEnabled` are the player's two switches. Pressing either button while the
  context is still locked retries the unlock, so a blocked autoplay recovers.
- Pointer/touch input can also trigger audio startup; a key press cannot.
- Sound effects and the soundtrack are independent: the effects run on Web Audio,
  the music on an `<audio>` element, and a rejected autoplay only downgrades the
  music to the synth fallback.

## Development checklist

After making changes, run the full check sequence — `./test.sh` does all of it
(lint, CSS format check, unit tests, typecheck, production build, and the
Playwright suite when a system Chromium is available):

```bash
./test.sh
```

The individual commands, if you want them one at a time:

```bash
npm run lint        # oxlint over src/, shared/, e2e/ and the config files
npm run lint:fix    # same, applying the safe autofixes
npm run fmt         # oxfmt over every stylesheet under src/
npm run fmt:check   # same, failing instead of rewriting
npm test            # Vitest, co-located *.test.ts / *.test.tsx
npm run test:watch  # the same suite in watch mode
npm run test:e2e    # Playwright, e2e/*.spec.ts against a Vite dev server
npm run test:e2e:ui # the same suite in Playwright's UI mode
npm run typecheck   # tsc over the app, the tests, then the e2e suite
npm run build       # production build into dist/
```

Lint rules live in `.oxlintrc.json`: `correctness`, `suspicious` and `perf` are
errors, plus the React hooks rules for components and JSX a11y checks. Every
disabled rule carries a comment explaining the pattern it conflicts with; single
intentional exceptions are suppressed at the call site with
`// oxlint-disable-next-line <rule>` and a reason instead.

### End-to-end tests

`e2e/` is a Playwright suite for the things a DOM shim cannot answer: whether the
canvas really holds the keyboard, whether a native modal `<dialog>` really contains
Tab and restores focus, whether `:focus-visible` really draws a ring, and whether
the boot flow gets from the splash to a live run without the browser complaining.

| Spec | Covers |
|---|---|
| `e2e/boot.spec.ts` | The title card and its start button; `Enter` and "press anywhere" both starting a run with the canvas focused, the HUD painted and the scanner reading real terrain; the canvas being the surface's only tab stop; the whole flow producing no console errors and no page errors. |
| `e2e/gameplay.spec.ts` | One keypress charged exactly once and clearing exactly one tile (the fence against a doubled input/step pipeline); depth rising and fuel falling over a descent; the depot actions swapping for the underground ones, live region included; focus staying on the canvas while mining. |
| `e2e/dialogs.spec.ts` | Shop and info opening with focus inside the dialog; `Escape`, the × button and the backdrop each closing it and restoring focus to the trigger; Tab never escaping into the HUD behind; the info tablist's click and arrow-key navigation; the two overlays handing the screen over rather than stacking. |
| `e2e/focus-visible.spec.ts` | The ring drawn for `Tab` (3px, and inset on the canvas) and gone for a click that moves focus, including the focus a clicked-shut dialog restores. |
| `e2e/failure.spec.ts` | A refused 2D context — stubbed with an init script — surfacing as the "Mine offline" notice with its detail line, its `role="alert"` and a working Reload, while the crash boundary stays out of it. |

Two notes on how the suite is wired:

- **The dev server, not `vite preview`.** React only double-invokes `<StrictMode>`
  effects in a development build, so the runtime's `dispose()` is only exercised
  there. `playwright.config.ts` starts `npm run dev` on port 5199 itself.
- **One deliberate white box.** `openOverlayDirectly()` in `e2e/support/game.ts`
  imports the app's own `src/ui/commands.ts` through the dev server to request an
  overlay. It exists because "shop and info at once" has no pointer path — while one
  is up the other's button is inert, which is the property being tested. Everything
  else in the suite is keys and clicks on documented element ids.

Browser resolution differs by environment, because a Playwright-downloaded Chromium
does not run on NixOS:

```bash
npm run test:e2e                                   # local: the first chromium on PATH
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # local: an explicit one
npx playwright install --with-deps chromium && npm run test:e2e   # the pinned download
```

`playwright.config.ts` prefers `PLAYWRIGHT_CHROMIUM_PATH`, then falls back to
`chromium`/`chromium-browser`/`google-chrome-stable`/`google-chrome`/`chrome` on
`PATH`. In CI (`CI` set) it uses neither, so the pinned download installed by the
workflow is the browser under test. `./test.sh` runs the suite only when one of
those system binaries exists and says so when it skips.

When touching the audio TypeScript (`src/audio/`):

```bash
npx vitest run src/audio
npx tsc --noEmit
npx oxlint
```

When touching the soundtrack generator (`soundtrack/`), byte-compile it and do a
short smoke render into a throwaway directory — never overwrite the shipped
assets with a truncated render:

```bash
python3 -m py_compile soundtrack/*.py soundtrack/tracks/*.py
python3 soundtrack/render.py golden-signal --duration 3 --out-dir /tmp/soundtrack-smoke
```

For browser smoke testing, build and preview the Vite app:

```bash
npm run build
npm run preview
# open the local URL printed by Vite
```

In the browser, press the music button and confirm the soundtrack starts, then check the
network panel: it should fetch `/assets/music/golden-signal.mp3` (or
`.ogg` on browsers without mp3 support) and loop it. Chiptune instead of the
march means autoplay was rejected and the synth fallback took over.

## Deployment

Two GitHub Actions workflows cover the client.

- `.github/workflows/build.yml` runs `npm ci`, then lint, CSS format check,
  typecheck, unit tests and `npm run build` on pushes to `main`, on pull requests,
  and on demand. A second job in the same workflow installs Chromium
  (`npx playwright install --with-deps chromium`) and runs the end-to-end suite
  beside it, uploading the HTML report when it fails.
- `.github/workflows/deploy-pages.yml` builds and publishes `dist/` to GitHub
  Pages when triggered manually.

`vite.config.ts` sets a relative `base`, so the same build works at a domain
root and under the `/miner-mp/` Pages project subpath.
