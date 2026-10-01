# Stalinload

**Status:** public repo. The `main` build is deployed to GitHub Pages at
<https://mantas6.github.io/miner/>; run it locally with Vite (`npm run dev`)
or build with `npm run build`.

A small browser-based Motherload-style mining game. The ship lives in an
underground home cavern; mine ore, haul it back to the home base, craft ship
upgrades and gear at the Manufacturing Station, brew fuel from coal at the Fuel
Extractor, and survive deeper hazards/enemies as the mine keeps going down.

The client is React + TypeScript around a canvas: React paints the chrome from a
zustand store, the canvas renders the mine, and the simulation runs in fixed
60 Hz steps so tick-based tuning behaves the same on any refresh rate. Booting
walks a UI phase machine — intro splash → playing. Behind the splash's
translucent backdrop the canvas shows a fresh game state drawn by the game's
own renderer with fog and ship turned off, at a random spot 30–700 rows down,
drifting slowly downward (`src/game/intro-showcase.ts`); the run's HUD stays hidden until
the run starts.

The mine is persistent. Terrain is never stored tile by tile — it regenerates
from its coordinate seed — so the save keeps the *diff*: the list of
`shared/world-schema.ts` tile entries the miner changed. Dying or refreshing
rebuilds the terrain and lays that diff back over it, so tunnels, mined ore, and
cracked blocks stay where you left them. The save keeps at most the 20,000 most
recently changed tiles and forgets the ones untouched longest rather than
outgrowing `localStorage` — re-digging a tile makes it new again — but never the
tile under a station, a crate or a wreck, or a placed decoration. If the browser
refuses a save for size anyway, the tile budget halves (and stays halved for the
session) until the save fits; cash, equipment and the rest are never dropped to
make room.

The ship is part of that mine. The save records the tile it parked on and the
fuel and hull it had, so a refresh (or an import) resumes down the shaft with the
tank you left it on — a reload is never a free refill — and an empty cargo bay,
since ore is not saved. Dying is the break: it costs you your position, the cargo
aboard, and the upgrades fitted to the ship (the ones in the bay survive). A save
taken while dead — the game-over write, reloaded before redeploying — is settled
as that death: the wreck is dropped and the ship redeploys at home on the usual
replacement vitals (see "Death and redeploying"). If the restored mine turns out to be solid rock at that
tile (a capped save), the ship starts at the home base rather than buried,
because the drill cannot dig upward. The same rule guards every jump: a portal
whose tile has gone solid is left out of the travel, teleporter and respawn lists,
and a redeploy that would land in rock goes to the home base instead.

Gameplay changes only *schedule* a save (one write per burst, half a second after
the last change); the save is written on the spot when the run ends, the tab is
hidden or closed, or the runtime is torn down, and the once-a-minute safety save
is skipped while nothing has changed.

The save is version 22, stored under `stalinload:progress:v1`, and a clean break:
any save not written by exactly this version — older or newer — is discarded on
load rather than migrated, because the reworks changed the shape too much to
convert honestly (the four ship stats became derived from fitted equipment, the
item counters became one `bay` of stacks, the stations became placed entities
carrying their own state, and crate and wreck stacks stopped carrying their own
prices — every sell price comes from the ore table). A returning player from an
older build starts fresh; the old `moleload-*` keys are no longer read, but
**Reset game** still removes them. A save is parsed in full before any of it is
applied, and every stack in it is clamped to what its holder can hold. What the save keeps: the parked tile, the ship's `fuel` and `hull`
(clamped to the maxima the hull and its fitted equipment derive), cash, the tile diff, explored
tiles, stats, the non-ore `bay` stacks, the hull on the ship ladder (`ship` — an
id the build does not know discards the whole save), the fitted `equipment`
(padded or trimmed to that hull's slots), the placed
stations (each Manufacturing Station's stock, each Fuel Extractor's coal/fuel, and
each Portal's name),
the drawn-down trading-post stock (`tradeLedger`), what is left in each opened
chest (`chestLedger` — optional, so a save without it loads with every chest
full), and the hardware left standing in the mine (scanners, dynamite, crates and
wrecks with their contents, each wreck with the deaths it has left). Ore aboard the ship is never saved — it is lost with
the run.

The save can be carried between browsers from **Info → Settings → Save data**.
**Export save** downloads it as `stalinload-save.json` and shows the same JSON in a
read-only text box. **Import save…** takes a file from the picker or a paste into
the import box, asks inline before replacing the run, then reloads the page into
it. Import refuses anything that is not JSON, not an object, or not exactly the
current `SAVE_VERSION` — older and newer saves alike (`parseImportedSave` in
`src/persistence.ts`). Since ore aboard is never saved, the Save data box — and
the import confirm, which reloads — say so while there is some ("Ore aboard is not
saved — stow it first.", `ORE_NOT_SAVED_NOTE`).

Underground fog of war is persistent. Movement permanently reveals a fixed 3x3
square around the ship; everything else — the unreachable band and bedrock cap
above the home cavern included — stays fogged until something reveals it.

## Project structure

Unit tests live next to the code they cover as `*.test.ts` (or `*.test.tsx` for
components) siblings. The browser-only behaviour they cannot reach — canvas focus,
native `<dialog>`s, `:focus-visible`, the boot flow — is covered by the Playwright
suite in `e2e/`.

```text
miner/
├── README.md
├── AGENTS.md
├── index.html
├── package.json
├── .nvmrc
├── opencode.json
├── .mcp.json
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
│   ├── persistence-reset.ts
│   ├── test-narrowing.ts
│   ├── test-overlays.ts
│   ├── agent/
│   ├── core/
│   ├── world/
│   ├── game/
│   ├── render/
│   ├── audio/
│   │   ├── audio.ts
│   │   ├── audio-permission.ts
│   │   ├── audio-settings.ts
│   │   ├── encoding.ts
│   │   └── tracks.ts
│   ├── ui/
│   └── styles/
├── agent/
│   ├── chromium.ts
│   ├── session.ts
│   ├── targets.ts
│   └── mcp-server.ts
├── e2e/
│   ├── boot.spec.ts
│   ├── gameplay.spec.ts
│   ├── dialogs.spec.ts
│   ├── focus-visible.spec.ts
│   ├── failure.spec.ts
│   ├── agent.spec.ts
│   └── support/
│       └── game.ts
└── .github/
    └── workflows/
        └── deploy-pages.yml
```

| Path | Purpose |
|---|---|
| `AGENTS.md` | Working agreements for anyone changing the code: avoid UI clutter, keep the rules pure, verify with `./test.sh`. |
| `index.html` | Main game page and root mount node; loaded by Vite. |
| `shared/constants.ts` | World constants, the home-cavern layout and station positions, the depth scale (`METERS_PER_TILE`, `rowDepthMeters`), camera scale (36px tiles), persistence limits, the decoration ids, and the ore table (Iron included). |
| `shared/exploration-codec.ts` | Fog-of-war index math and the run-length encoding used by persistence. |
| `shared/world-schema.ts` | Zod (`zod/mini`) schemas and derived types for tiles and the saved tile diff. |
| `shared/tile-key.ts` | Canonical `"x,y"` coordinate key used by tile maps. |
| `src/main.tsx` | Vite entry point: imports global styles and renders the app inside `<StrictMode>` and an error boundary, handing the game-runtime factory to it. |
| `src/test-narrowing.ts` | Test-only `nth()`/`defined()`: index or unwrap a fixture and fail with a readable message when it is missing, the tests' answer to `noUncheckedIndexedAccess`. Shared by the Vitest suites and the Playwright specs. |
| `src/test-overlays.ts` | Test-only `emptyOverlay(kind)`: a store overlay of that kind with nothing in it, for tests that only need a screen to be up. |
| `src/persistence-reset.ts` | The **Reset game** wipe: every key the game writes to `localStorage` (save, audio and zoom preferences, and the retired `moleload-*` keys). |
| `src/persistence.ts` | Local save/load of player progress, the ship's parked tile, explored tiles, the drawn-down trading-post stock (`tradeLedger`), the opened-chest ledger (`chestLedger`), and the world's tile diff (`localStorage`); plus the save export (`serializeProgress`) and import check (`parseImportedSave`). |
| `src/core/` | Pure gameplay rules and types: balance, the item catalog (`items.ts`), the item-description registry the tooltips and overlay `info` read from (`item-info.ts`), ship upgrades (`ship-upgrades.ts`), crafting recipes (`crafting.ts`), the placeable stations — Manufacturing Station, Fuel Extractor and Portal — with their reach, transfers and coal/fuel conversion (`stations.ts`), the portal travel-network rules — naming, sanitizing, destinations and respawn candidates (`portal.ts`), trading-post offers and pricing, fuel and home Supply prices (`trading.ts`), decorations (`decor.ts`), movement, dynamite, teleporter, cargo containers, wrecks (`wreck.ts`), chest loot and reach (`chest.ts`), grave epitaphs and reach (`grave.ts`), enemies, objectives, scanner, fuel reserve, depth milestones, spoken ship status, stats, danger, fixed-step clock, developer tools. |
| `src/world/` | World generation (terrain, ore bands, and coordinate-derived trading posts, chests and graves in `world.ts`), the tile diff that turns a saved world back into terrain (`tile-diff.ts`), world-state reset, and visible tile range. |
| `src/game/` | Gameplay orchestration (`game.ts`, the `createGameRuntime()` factory) plus its feature modules — `enemies.ts`, `actions.ts`, `move.ts`, `run.ts`, `input.ts`, `world-grid.ts`, `viewport.ts`, `zoom.ts` (wheel/pinch camera zoom maths), `zoom-settings.ts` (the remembered zoom level), `readouts.ts`, `scanner-devices.ts`, `dynamite-sticks.ts`, `cargo-containers.ts`, `wrecks.ts` (opening and salvaging the wrecks a lost run leaves behind), `chests.ts` (opening and looting buried chests), `graves.ts` (reading a grave's stone), `home-stations.ts` (the Manufacturing Station and Fuel Extractor sim, with the home Supply and extractor fuel orders), `portals.ts` (the portal travel, teleporter and respawn overlay sim), `trading.ts` (buying, selling and fuel for cash at a trading post), `station-devices.ts` (placing crafted stations in the mine), `toolkit.ts` (the Construction Toolkit that lifts empty stations and containers back aboard), `decor.ts` (placing decorations), `save-scheduler.ts` (the debounced run save, the dirty-only minute interval and the unload/hidden-tab saves), `overlays.ts` (raising and dropping the one modal screen, with its cues), `ui-sync.ts` (the per-frame, change-only store publish), `placement-router.ts` (the registry of armed tools sharing the one press on the mine), `interactables.ts` (what Space and `c` would open, and the HUD hint naming it), `particles.ts`, `focus.ts` (canvas focus), `cheats.ts` (the developer cheats), `intro-showcase.ts` (the title screen's drifting mine backdrop: a fresh game state drawn by the game's renderer with fog and ship off) — the canvas surface factory (`dom.ts`) and the teardown registry every side effect registers with (`disposal.ts`). |
| `src/agent/` | The programmatic-play seam inside the game: `observation.ts` builds the fog-respecting `AgentObservation` (ASCII view, notable list, HUD and the one open overlay) an LLM reads instead of the screen, and `bridge.ts` is the `agentBridge` singleton — mirroring `commands.ts` — a harness reaches the running game through (observe, pause, the tick readback an action settles on, tile→screen projection, and `tile-press.ts`'s up-front refusal of a tile press the game would ignore); `allowlist.test.ts` fails on any interactive `src/ui` control the harness allowlist cannot reach. |
| `src/render/` | Canvas drawing, and the terrain/fog chunk cache policy. |
| `src/audio/` | Web Audio graph, sound effects, soundtrack playback, and autoplay permission. |
| `src/audio/audio-settings.ts` | The remembered music/effects switches (`stalinload:audio-settings:v1`), kept outside the save file. |
| `src/audio/tracks.ts` | Track registry for playback: the `TrackId` union, `TRACKS` (title plus mp3/ogg URLs), `DEFAULT_TRACK_ID`. |
| `src/audio/encoding.ts` | `prefersMp3()`/`pickSource()`: the one place that decides mp3 or ogg for an asset that ships as both. |
| `soundtrack/engine.py` | Track-agnostic synth/render/encode engine (stdlib only): oscillators, envelope, note names, event bucketing, 44.1 kHz stereo WAV mixdown, `tanh` saturation, loop-edge fades, and the ffmpeg mp3/ogg encode. |
| `soundtrack/tracks/golden_signal.py` | "Golden Signal", the built-in Soviet/industrial mining march: patterns, voices, tempo, seed. Also the template for new tracks. |
| `soundtrack/tracks/__init__.py` | Generator-side registry: the `TRACKS` dict keyed by slug and `get_track()`. |
| `soundtrack/render.py` | CLI that renders registered tracks into `public/assets/music/`. |
| `public/assets/music/` | The shipped soundtrack assets (`golden-signal.mp3`, `golden-signal.ogg`) — build products of `soundtrack/render.py`, copied verbatim into `dist/` by Vite. |
| `src/ui/` | React components — including the trading-post screen (`TradeScreen.tsx`), the portal travel/teleporter/respawn screen (`PortalScreen.tsx`), a grave's stone (`GraveScreen.tsx`) and the shared hover popup driven by the item-description registry (`Tooltip.tsx`) — the zustand UI store (`store.ts`), the command table the buttons dispatch into (`commands.ts`), the effect that owns the runtime's lifetime (`useGameRuntime.ts`), the boot/crash notices (`Failure.tsx`), and co-located CSS modules. |
| `src/styles/base.css` | Design tokens plus element-level styling (`button`, `ul`, `kbd`, `meter`, `canvas`, `#shell`, `#game-panel`) and the app-wide `:focus-visible` ring. |
| `src/styles/icons.css` | Global equipment sprite sheet (`icon-*`), addressed by name from the item catalog. |
| `src/styles/intro-art.css` | Global intro badge art. |
| `vite.config.ts` | Vite build config (relative `base`, React Fast Refresh) and Vitest test config. Vitest only collects `src/**` and `shared/**`, so `e2e/` is never picked up by `npm test`. |
| `tsconfig.json` | The production pass of `npm run typecheck` (`src/`, `shared/`, `vite.config.ts`, no ambient globals), and the options both other passes extend: `strict` plus `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride` and `noUnusedLocals`. |
| `tsconfig.test.json` | The test half of `npm run typecheck`: the same strict options plus `vitest/globals`, which `tsconfig.json` withholds from production source. |
| `tsconfig.e2e.json` | The third `npm run typecheck` pass: `e2e/`, `agent/` and `playwright.config.ts`, which run in Node and so need those globals rather than Vitest's. |
| `playwright.config.ts` | End-to-end config: one Chromium project, the Vite dev server started as a `webServer`, and the local/CI browser resolution described under "End-to-end tests". |
| `agent/` | The Node-side programmatic-play harness (no React, no test runner): `chromium.ts` resolves the Chromium to drive (shared with `playwright.config.ts`), `session.ts` (`openGameSession`) starts/reuses a Vite server, launches a headed Chromium, and drives the game with real key/mouse events plus the pause model, `targets.ts` is its click allowlist (plain data, so the Vitest guard can import it), and `mcp-server.ts` is the stdio MCP server that exposes it to an LLM agent. See "Agent play". |
| `e2e/` | The Playwright suite — boot flow, keyboard mining, the modal dialogs and focus restoration, the `:focus-visible` ring, the runtime-failure notice, and the agent-harness smoke test — plus `support/game.ts`, the shared page fixtures. |
| `opencode.json` | Registers the `miner` MCP server (`npx tsx agent/mcp-server.ts`) so an opencode agent can drive the game. See "Agent play". |
| `.mcp.json` | The same `miner` MCP server registration at Claude Code's project scope. See "Agent play". |
| `.oxlintrc.json` | Lint rules for `src/`, `shared/`, `e2e/`, `agent/` and the two root configs (oxlint), with the reason behind every disabled rule. |
| `.oxfmtrc.json` | oxfmt configuration. oxfmt is CSS-only: `npm run fmt` / `fmt:check` pass it `src/**/*.css`, and nothing else in the repo goes through a formatter. |
| `init.sh` | Installs dependencies and starts a background Vite dev server for smoke testing. |
| `start.sh` | Builds, then runs the preview server. |
| `test.sh` | Full check sequence: lint, CSS format check, unit tests, typecheck, production build, and the Playwright suite when a system Chromium is available. |
| `.github/workflows/deploy-pages.yml` | The only workflow, manual-only (`workflow_dispatch`): lint, CSS format check, typecheck, unit tests and production build, a parallel job that installs Chromium and runs the Playwright suite, and a GitHub Pages deployment of `dist/` gated on both. |
| `.nvmrc` | The Node major the project targets (22, matching `engines` in `package.json` and the workflow's `setup-node`). |

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

`boot()` also registers a third bridge beside `registerUiCommands()`:
`setAgentBridge()` wires the running game into the `agentBridge` singleton
(`src/agent/bridge.ts`) for programmatic play, and `dispose()` calls
`resetAgentBridge()` to point it back at its no-op defaults. The loop carries a
`paused` flag the bridge drives: while paused, `draw()` and `uiSync.sync()` keep
running so the window and the observation stay live, but the fixed-step advance is
held; unpausing resets the stepper so the frozen wall-clock gap is discarded
rather than replayed in a burst (the same reset the `visibilitychange` handler
uses). See "Agent play".

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

The cheat menu — **Grant ores** (fills the cargo bay, then the station stock,
with a bundle of every ore), **Fill extractor** (queues coal and stores fuel),
and the player and world reset controls — lives in the **Settings** tab of Info /
Cargo, behind a "Cheat menu" disclosure. It is available in every build with
no environment opt-in, and it is mounted only while that disclosure is expanded.

The world reset regenerates terrain, enemies, caches, and fog while preserving
the player's cash, fitted equipment, inventory/cargo, home base, stats, ship
condition, and settings.

## Controls

Ship movement is keyboard-only. Pointer/touch input is used for UI
only (menus, buttons, modals, starting the run, restarting, audio unlock) plus
zooming the camera with the wheel or a trackpad (the `+`/`-` keys zoom too).

| Action | Keyboard | UI (click/tap) |
|---|---|---|
| Start a run | `Enter` or `Space` | Click/tap intro screen |
| Move / fly / dig | `WASD` or arrow keys | — |
| Sprint through open space (needs a fitted Booster) | Hold `Shift` + direction | — |
| Zoom the camera (0.5x–2x, remembered) | `+` / `=` in, `-` out (0.25 steps) | Wheel scroll or trackpad pinch over the mine |
| Open a station in reach (Manufacturing Station / Fuel Extractor) | `Space` | Press the station tile on the mine |
| Open a trading post in reach | `Space` | Press the post tile on the mine |
| Spend cash: fill the tank at a post, buy Supply at the home station, order fuel into the home extractor | — | Fill tank row / a Supply row / Buy fuel button |
| Open a portal in reach (its travel list of the other portals) | `Space` | Press the portal tile on the mine |
| Repair the hull for cash at a portal (while it is short) | — | Repair hull button in the travel list |
| Read a grave in reach (on it or beside it) | `Space` | Press the grave on the mine |
| Put a grave's stone away | `Space`, `Enter` or `Escape` | OK button |
| Ship equipment (fit/unfit upgrades) | — | Ship button |
| Use a repair kit (patch the hull) | — | Repair Kit inventory slot |
| Use a fuel cell (+250 fuel) | — | Fuel Cell inventory slot |
| Plant dynamite (5 s fuse) | `E`, then press a mine tile | Dynamite inventory slot, then a mine tile |
| Deploy a scanner | — | Scanner inventory slot, then a mine tile |
| Set a cargo container down | — | Container inventory slot, then a mine tile |
| Set a crafted station down (Manufacturing Station / Fuel Extractor / Portal) | — | Its inventory slot, then a mine tile |
| Lift an empty station, portal or container back aboard | — | Construction Toolkit inventory slot, then press the station/crate |
| Set a decoration down | — | Decoration inventory slot, then a mine tile |
| Open a placed cargo container — or wreck, or chest — (on it or beside it) | `C` | Press the crate, wreck or chest on the mine |
| Move a stack between the crate and the bay | — | Press the stack in either column |
| Salvage a wreck (its ore and fitted upgrades) or loot a chest | `C` | Press the wreck or chest, then a stack or Loot all |
| Cancel a placement | `Escape` | The armed slot again |
| Open the portal list with a teleporter aboard (picking a destination spends one teleporter) | `T` | Teleport button |
| Travel to a portal from the list | — | Press a portal row |
| Cargo, stats and guides | — | Info / Cargo button |
| Close the portal travel/teleporter list | `Space` or `Escape` | × button or the backdrop |
| Close a dialog | `Escape` | × button or the backdrop |
| Scuttle mid-run (counts as a death) | `R`, then `R` again within 3.5 s | — |
| Restart after game over | `R` | Click/tap outside the dialogs |
| Choose where to redeploy (with two or more portals; the prompt cannot be dismissed) | — | Press a portal row |
| Toggle the music / the sound effects | — | Note / speaker HUD buttons, or Info / Cargo → Settings; a trusted pointer/touch gesture may auto-enable |
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
- **State outside the canvas.** The bottom-left panel is an analog fuel gauge over
  plain fuel and hull readouts, each a visible `current/max` number, and a "Base"
  line with the home extractor's stored fuel and queued coal (flashing once the two
  could no longer fill a tank, hidden when no extractor stands at home); the other
  readouts are text, the toast and the
  fuel banner are live regions, and `#game-status` politely announces the ship's
  situation — at home base, in the mine, holds full, hull critical, ship lost. It is
  driven by thresholds, so the 60 Hz HUD sync never makes it talk.
- **Native dialogs.** The intro prompt is a `<button>`; the ship, info,
  Manufacturing Station, Fuel Extractor, cargo-container/wreck/chest, trading-post,
  portal and grave overlays are modal `<dialog>`s, so the browser contains Tab, makes the rest of the
  page inert, and each close returns focus to the control that opened it.
- **Named controls.** Toggles keep one accessible name and carry their state in
  `aria-pressed` (the audio switches) or `aria-expanded` (the inventory and cheat
  disclosures); the audio buttons draw small `aria-hidden` inline SVGs, and their
  tooltip carries the next action or why sound is blocked. Every stack button in
  the station, container/wreck/chest and trading-post screens is named by its verb
  and stack ("Take all Coal", "Stow one Iron", "Sell all Iron"). An unaffordable
  **Craft** is `aria-disabled` rather than `disabled`: it stays a tab stop,
  described by its "Need …" shortfall, and a press gets the sim's refusal toast.
  The agent harness reads `aria-disabled` as disabled and refuses the click.
- **`prefers-reduced-motion`.** Followed live (a `matchMedia` change listener
  disposed with the runtime). The looping start-prompt, low-fuel and HUD-alert
  animations stop (the alert colours stay), the toast fades without sliding,
  buttons stop shifting on hover/press, and the ship holds still — no hover bob,
  wobble, flame flicker or drill shake — as do the enemies, fuses and the intro
  camera drift.
- **Short viewports.** Below 520 px of height the HUD compacts its paddings,
  buttons and type, mirroring the 760 px width breakpoint without changing layout.

## Gameplay notes

- You start in the **Scout** with a full 100-unit tank, a full 100 hull, a 20-item
  cargo bay, and drill power 1, from the `STARTING` base in `src/core/balance.ts`.
  Those four ship stats are not fixed — they are *derived* from the hull you fly
  and the upgrades fitted to it (see below).
- Dig ore, fly it back to the home cavern, and stow it at the Manufacturing
  Station to craft with it — or sell it for cash at a **trading post** deep in the
  mine (see below). Cash also drops from destroyed enemies.
- The cargo bay (`src/core/inventory.ts`) holds a total *item count*, not a fixed
  number of slots, shown as a collapsible HUD panel. Each ore type stacks in one
  row, but what limits a load is the sum of every stack against the ship's cargo
  capacity — equipment counts toward it too, so a bay crammed with tools mines less
  ore. A fresh bay holds 20 items; each fitted Cargo Hold upgrade adds 10/20/40.
- Ten ores run Coal, Iron, Copper, Silver, Gold, Ruby, Emerald, Alienite, Uranium,
  Core Shard, getting richer with depth. Iron sits between Coal and Copper and is
  the backbone of the low-tier recipes. Gold opens around 1100 m and Ruby around
  2300 m (`ORES` in `shared/constants.ts`; the Info screen's **Prospecting** tab
  lists every band). Ore is rolled tile by tile, so once a shaft reaches a band,
  sideways galleries off it comb the band where a straight shaft passes through
  (the Prospecting tab says so too).

### Home base

The ship lives in a small deterministic cavern carved into the top of the mine;
solid bedrock caps the world above it, so there is no surface and the depth meter
reads 0 m at home. Three stations are seeded on the cavern floor — the Manufacturing
Station, the Fuel Extractor, and a Portal named `Home` — fly onto or beside one and
press `Space` (or click its tile) to open it. They are placed entities, not
fixed world objects, so they can be crafted, carried and set down elsewhere too
(see "Crafting & ship equipment"). The cavern floor is paved with Stone Blocks,
except for a plain dirt hatch right under the spawn that opens onto the starter
coal; like the cavern's air they are derived from the coordinate rather than saved,
and drill out as usual.

- **Manufacturing Station.** Stow cargo here (its stock holds up to 500 items),
  take stacks back aboard, and craft. **Stow ore** moves every ore stack aboard at
  once; the trip kit (Repair Kits, Fuel Cells, Dynamite, Scanners, Teleporters,
  Containers), devices, upgrades and decorations stay aboard — stow those by their
  own stack's Stow / 1. Crafting consumes from the station stock and
  the result lands back in the stock — take it aboard afterwards. The recipe table
  lives in `src/core/crafting.ts`:

  | Output | Inputs |
  |---|---|
  | Repair Kit | 2 Iron + 1 Copper |
  | Dynamite | 2 Coal + 1 Iron |
  | Scanner | 2 Copper + 1 Silver |
  | Container | 4 Iron + 2 Copper |
  | Teleporter | 3 Silver + 2 Gold |
  | Deep Teleporter (a Teleporter; after the first Mk II) | 1 Emerald + 1 Alienite |
  | Fuel Cell ×2 | 1 Uranium |
  | Manufacturing Station | 8 Iron + 4 Copper + 2 Silver |
  | Fuel Extractor | 6 Iron + 4 Copper + 2 Coal |
  | Portal | 3 Silver + 3 Gold + 2 Iron |
  | Deep Portal (a Portal; after the first Mk II) | 2 Ruby + 2 Emerald + 2 Iron |
  | Construction Toolkit | 4 Iron + 2 Copper |
  | Fuel Tank / Cargo Hold / Drill / Hull Plating **Mk I** | 4 Iron + 2 Copper |
  | … **Mk II** | 3 Silver + 3 Gold (Fuel Tank Mk II: 4 Silver + 2 Copper) |
  | … **Mk III** | 2 Ruby + 2 Emerald + 1 Alienite |
  | Core Drill (tier-4 drill) | 3 Core Shard + 2 Uranium + 2 Alienite |
  | Booster | 3 Copper + 2 Coal + 1 Silver |
  | Steel Plate (decor) | 2 Iron |
  | Stone Block ×2 (decor) | 1 Coal |
  | Copper Trim (decor) | 2 Copper |
  | Lamp Panel (decor) | 1 Copper + 1 Coal |

  The two **deep** rows are second routes to the same Teleporter and Portal
  (`alt` recipes), for a career whose trips run far below the Silver and Gold the
  standard bills want. They are not listed until the first Mk II upgrade is crafted
  (`stats.bestMarkCrafted >= 2`, `DEEP_RECIPE_MARK`), then sit under their own names
  beside the standard rows; their Craft buttons carry the recipe id with an `:alt`
  suffix (`data-craft="device:portal:alt"`, `recipeId`). Post prices always follow
  the standard bill.

  The Manufacturing Station in the home cavern also runs a **Supply** counter: a
  repair kit, dynamite, a scanner or a container bought for cash straight into the
  station stock (take it aboard as usual). Each costs its recipe's ore-value marked
  up ×2 (`HOME_SUPPLY_MARKUP`, `SUPPLY_POOL` in `src/core/trading.ts`) — dearer than
  a trading post, but at home. A purchase is refused when the wallet is short or the
  stock is full; a Manufacturing Station set down elsewhere in the mine has no Supply.

- **Fuel Extractor.** Fuel comes from coal now, not a pump. Load coal here and it
  converts on the simulation's own clock — 1 coal → 115 fuel every 180 ticks (~3 s),
  banked up to a 500-fuel store (`EXTRACTOR` in `src/core/balance.ts`). Coal runs
  from the home cavern down to 2400 m, past the top of the Gold band. A coal run pays: the
  coal a sweep through mid-band dirt turns up repays the fuel spent digging it at
  least 1.2 times over at drill 1.75 (`src/core/balance.test.ts` pins that sweep
  model), so coal runs are what keep the base supplied once the seeded store is
  spent. The conversion runs whether or not you are watching; a ship parked on the
  extractor tile or beside it (the one-tile reach its screen opens from, so the
  home spawn counts) is kept topped up from the store for as long as it stays, fresh
  conversions included — so the screen needs no refuel button. The HUD's
  "Base" line reads the home extractor's store and hopper at a glance. The home
  extractor also takes fuel for cash: "Buy fuel" orders up to 100 fuel into its store
  (capped by the 500 store and the wallet) at the home fuel price below, and quotes
  that rate ("Buy fuel ($29 per 100)") even while it has nothing to buy.

- **Portal.** The `Home` portal is the near end of the travel network. Open it to
  see the travel list of every other built portal — name, depth and distance — and
  press a row to jump the ship there for free. Rename it from the text input in the
  travel screen (up to 16 characters). While the hull is short, the travel screen
  also offers **Repair hull** for cash (see "Portals" below). It is also a respawn point: a lost ship can
  redeploy here (see "Death and redeploying"). Portals are placed entities like the
  other stations (see "Crafting & ship equipment").

### Trading posts

Deep in the mine (below `START_Y + 40`, roughly 30% of 32×32 chunks — about one
post per 40 rows, the first around 470 m) stand **trading posts** — kiosks in a
cleared air pocket, never near the home cavern. Like the home cavern, a post is
*derived* from its coordinate rather than stored
(`tradingPostAt`/`tradingPostPocket` in `src/world/world.ts`), so it survives death,
reload and world reset; only the stock a player has bought is persisted, in
`state.tradeLedger`. Fly onto or beside one and press `Space` (or click its tile) to
open it.

- **Finding one.** A post is a beacon: within 12 tiles on either axis
  (`TRADING_POST_HINT_RADIUS`), a second line under the scanner points at the
  nearest — "Trading post ≈9 tiles ↙", the larger axis distance and an 8-way arrow
  (`formatPostHint` in `src/core/post-beacon.ts`). It ignores the fog on purpose, so
  it leads to posts you have not seen, and goes quiet once one is in reach and the
  `Space` hint names it. Every post you have seen (its tile explored) is listed on
  the Info screen's **Prospecting** tab with its depth and coordinates
  (`discoveredTradingPosts`).

- **Sell.** A post buys any ore at the ore table's own `value`, with no limit — the
  Sell column lists the ore aboard, whole-stack or one at a time, and the takings
  land in your cash.
- **Buy.** Every post keeps a Repair Kit shelf — two kits, first on the list
  (`POST_REPAIR_KIT_STOCK`) — so a hurt ship that finds any post can patch up. Beside
  it a post stocks 2–3 finished items drawn from a depth-tiered pool (`BUY_POOL`),
  each with a small stock of 1–3: dynamite, scanner and container anywhere; Mk I
  parts from 800 m; the toolkit and the teleporter deeper; the Mk II parts from the
  Ruby band (2300 m), the Mk III parts from the Alienite band (5400 m), and Fuel
  Cells and the Core Drill from the Uranium band (7000 m). A buy price is the item's
  standard recipe ore-value marked up ×1.5 (`TRADING_MARKUP` in
  `src/core/trading.ts`), so it is always sane against the ore you sell to afford
  it — and the deep gear is a real cash sink: a Mk III part is $1605, a Fuel Cell
  $465, the Core Drill $7350. A buy is refused when the wallet
  is short, the offer is sold out, or the bay is full.
- **Fuel.** The top row of the Buy column, "Fill tank", tops the tank up as far as
  the wallet reaches — never out of stock. Fuel is priced off the coal it is made
  from: Coal's value over the fuel one coal converts to, marked up ×4.2
  (`FUEL_TRADE_MARKUP`, `fuelUnitPrice` — about $0.29 a unit at home), so mining coal
  always beats buying. A post charges more the deeper it stands — the home price
  times `1 + depth / 4000 m` (`FUEL_DEPTH_METERS`, `postFuelUnitPrice`), so fuel at
  4000 m is double and at 7400 m nearly triple — and its header quotes its own rate
  ("Fuel $0.44/unit"); the home extractor always pays the base price. It sells whole units, and the bill is rounded down to whole dollars
  (never below $1), so a partial fill is never overcharged (`fuelPurchase`).

### Chests and graves

Two more fixtures are derived from the coordinate like trading posts (`chestAt`,
`graveAt` in `src/world/world.ts`): at most one per 16×16 chunk, never in or beside
a post's pocket. The ship flies through both, and both count as
occupied ground for placement. Either one opens from its own tile or any of the
eight around it, and only once it is explored.

- **Chests** (`H`; `src/core/chest.ts`, `src/game/chests.ts`) lie buried in a
  one-tile pocket in about a quarter of chunks below `START_Y + 8`. Press one — or
  `C` on or beside it — for a take-only menu like a wreck's: press a stack (or its
  "1" button), or **Loot all**. A chest holds 2–4 stacks rolled from its
  coordinate: ore from its depth's band, consumables (repair kit, dynamite, scanner,
  a rare teleporter), decorations, and about one time in fourteen a ship upgrade
  whose mark rises with depth (Mk I shallow, Mk II from 150 rows, Mk III or the
  Booster from 400). Never cash. Only what the player has taken is stored, in
  `state.chestLedger`; a chest emptied bare is gone for good. The ledger survives
  death, reload and world reset, and clears only on a full player-data reset.
- **Graves** (`+`; `src/core/grave.ts`, `src/game/graves.ts`) lie on the floor of
  a 3×2 nook in about one chunk in seven below `START_Y + 6`. Press one — or
  `Space` beside it — to raise its stone with a bell: a Russian name (surname
  ending agreeing with the miner's gender), the years they lived, and a mining
  cause of death ("Crushed under rock", "Ran dry at 340 m", …). The deeper the
  grave, the older it is — death years run from 1990 in the shallows back to 1890.
  OK, `Enter`, `Space` or `Escape` puts it away. Nothing about a grave is saved.

### Crafting & ship equipment

- The ship's equipment slots come with its hull (`slotsFor` in
  `src/core/ships.ts`): the starter Scout carries **3**. On every hull the last
  slot stays **locked** ("Locked — craft a Mk II upgrade") until any Mk II upgrade
  has been crafted (`stats.bestMarkCrafted >= 2`), so the first Mk II is an addition
  rather than a trade against a Mk I. The Fuel Tank Mk II takes no Gold, so a Scout
  can open that slot from the Silver band. Fit and unfit crafted upgrades from the bay through
  the **Ship** button, which opens anywhere; a fit lands in the first empty open
  slot and never in a locked one. The four stat upgrades come in three marks and
  their bonuses are additive, so duplicates stack (`src/core/ship-upgrades.ts`):

  | Upgrade | Effect | Mk I | Mk II | Mk III |
  |---|---|---|---|---|
  | Fuel Tank | +fuel capacity | +50 | +100 | +200 |
  | Cargo Hold | +cargo capacity | +10 | +20 | +40 |
  | Drill | +drill power | +0.75 | +1.75 | +3.5 |
  | Hull Plating | +hull capacity | +50 | +100 | +200 |
  | Booster | enables the `Shift` sprint | — | — | — |

  Drill bonuses are fractional so no mark is a dead zone: a single drill takes
  9-hp dirt in 9 / 6 / 4 / 2 hits (bare, Mk I, Mk II, Mk III), and a tile's hp
  can be left fractional between hits (it saves as-is).
  Fitting a Fuel Tank or Hull Plating moves the current fuel or hull by the same
  amount as its maximum — a Tank Mk I fitted adds 50 fuel once, and unfitting it
  takes the 50 back, so an unfit/refit is neutral. A fit, unfit or swap that would
  leave less than 1 fuel or hull is refused ("Not enough fuel to purge that
  tank."). A save's fitted slots only set the maxima on load; a hand-edited list
  loads padded or trimmed to the hull's slot count.

  The Booster is Mk I only and carries no stat: it is the gate on the `Shift`
  sprint, which does nothing until one is fitted.

  The drill alone has a fourth mark: the **Core Drill** (`upgrade:drill:4`, +7 drill
  power, so a single one drills at 8), crafted from the deepest ores — 3 Core Shard,
  2 Uranium and 2 Alienite. It fits like any other upgrade and records mark 4 in
  `stats.bestMarkCrafted`. Once it is fitted the objective names the next hull to
  build, and in the Core Breaker points past the depth record, at the next 1000 m.
- **The Shipyard** (every Manufacturing Station, above the recipes) builds a
  bigger hull. The ladder is one-way — only the next ship up can be built, there
  is no fleet and no going back — and each rung adds a fitting slot and a bigger
  base (`SHIPS` in `src/core/ships.ts`; upgrades add on top as before):

  | Ship | Slots | Fuel | Hull | Cargo | Drill | Built from |
  |---|---|---|---|---|---|---|
  | Scout | 3 | 100 | 100 | 20 | 1 | the starter |
  | Hauler | 4 | 150 | 125 | 30 | 1 | 16 Iron, 10 Copper, 6 Silver |
  | Prospector | 5 | 200 | 150 | 40 | 2 | 12 Silver, 10 Gold, 4 Ruby |
  | Leviathan | 6 | 275 | 200 | 55 | 3 | 16 Ruby, 12 Emerald, 8 Alienite |
  | Core Breaker | 7 | 350 | 250 | 70 | 4 | 12 Alienite, 8 Uranium, 6 Core Shard |

  The two late hulls cost several deep trips each, so the Core Breaker no longer
  lands one trip after the Core Drill.

  The last slot of each is the Mk II-locked one, so before the first Mk II a Scout
  flies 2 open slots, a Hauler 3, and so on up to the Core Breaker's 6. The ore
  comes out of the station stock like a recipe's, but the output is a hull swap:
  fitted upgrades carry over into the same slots, the new ones come empty, and fuel
  and hull are kept rather than refilled (a bigger bay never overflows). The row
  shows the gains and the bill, and its **Build** button is live only while the
  stock covers it. Its shortfall line counts the ore aboard too — "Need 4 Silver ·
  6 Iron aboard to stow", or "Stow the 6 Iron aboard to build" once the bay holds
  the rest — since only what is left to mine is truly missing; the build still takes
  the stock alone. The build toast lists the gains ("Built the Hauler: +1 slot · +50
  fuel · +25 hull · +10 cargo."). The first Mk II crafted toasts what it opens: the
  hull's last slot, named by its place on the hull flown ("Third slot unlocked" on a
  Scout, "Fourth" on a Hauler), and the deep recipes. The hull survives a death — the replacement flies the same ship
  with every slot empty, half its base hull, and a base tank of that hull drawn from
  the home extractor (half a tank at a field portal); only a full player-data reset
  returns the Scout. Bigger hulls draw ~4% larger
  per rung, each in its own colour. The Ship screen's heading names the hull and its
  slot count.
- The **Repair Kit** is crafted (or bought — every trading post keeps two, and the
  home Supply sells them), carried in the bay, and spent from its own slot to patch
  25% of the hull maximum; it is refused at a full hull.
- The **Fuel Cell** is crafted two at a time from one Uranium (or bought at a post
  from 7000 m), carried in the bay, and spent from its own slot anywhere in the mine
  for a fixed +250 fuel (`FUEL_CELL_FUEL` in `src/core/items.ts`), up to a full tank
  — enough to stretch a deep trip without making a late-game tank's fuel
  irrelevant; it is refused while the tank is already full.
- Dynamite and scanners are crafted, carried in the cargo bay, and placed from
  their own inventory slot onto explored, cleared ground. A planted stick blows a
  2-tile radius five seconds later — long enough to get clear, and close enough to
  wreck a ship that did not. A scanner maps its 7×7 square one fogged tile at a
  time, and once the square is mapped — by it or by the ship — it crumbles away on
  its next firing step ("Scanner finished its survey and crumbled away."), leaving
  its tile clear, so a spent scanner never clutters a shaft.
- Teleporters ride in the bay too, and are spent rather than placed: pressing `T`
  with one aboard opens the portal list (the portals not already within reach), and
  picking a destination spends one teleporter and jumps the ship straight to that
  portal. There is no depth gate and no return trip — the charge is the fare for the
  jump, and travel between built portals is otherwise free.
- **Decorations** — Steel Plate, Stone Block, Copper Trim, Lamp Panel — are crafted panels set
  down as tiles from their inventory slot onto explored, cleared ground (never on a
  tile a station, device, wreck, chest, grave or the ship itself stands on). The panels are solid: drilling one back out returns it to the bay.
  A blast destroys any decoration outright.
- Cargo containers (`src/core/cargo-container.ts`) are the one piece of gear that
  is never used up. Set one down on explored, cleared ground from its inventory
  slot and it becomes a 50-item store standing in the mine, obeying the same
  stacking rules as the bay. Press it from an adjacent tile — or `C` while on or
  beside it — to open a two-column transfer menu; a press on a stack sends it to
  the other side, up to whatever room the destination has left, and the "1" button
  beside each stack moves just one item of it. A crate keeps what it holds through
  death and reload, which makes it the only way to protect ore from a lost run.
  Anything taken back out still counts against the ship's cargo capacity, so a
  crate buys storage, never carrying capacity. Six may stand in the mine at once.
- **Placeable stations** (`src/core/stations.ts`). The Manufacturing Station and
  the Fuel Extractor are entities like a crate, not fixed world objects: one of each
  is seeded on the home-cavern floor, and more can be crafted, carried, and set down
  on explored, cleared ground from their own inventory slots. Each manufacturer
  keeps its own stock; each extractor runs its own coal→fuel conversion. Up to four
  of each may stand in the mine. The **Construction Toolkit** (`src/game/toolkit.ts`)
  is the durable counterpart: armed from its slot, a press on an *empty* station or
  container from an adjacent tile packs it back into the bay (it refuses a loaded one — empty it
  first — and refuses when the bay has no room). The toolkit is never used up.
- **Portals** (`src/core/portal.ts`, `src/game/portals.ts`) are placeable stations
  too: crafted, carried, and set down from the portal inventory slot exactly like a
  Manufacturing Station or Fuel Extractor. The base is seeded with one named `Home`,
  and up to six portals may stand in the mine at once — the `Home` portal counts
  toward that cap. A portal holds no stock, so it is always "empty" and the
  Construction Toolkit can always lift it back aboard. Each carries a player-facing
  name, renameable up to 16 characters from the travel screen. Open one (press its
  tile, or `Space` alongside it) to see the travel list of every other built portal
  and jump the ship there for free; a portal is also a respawn point for a lost ship
  (see "Death and redeploying"). The travel screen of any portal, `Home` included,
  patches the hull for cash while it is short: **Repair hull** restores as much of
  the missing hull as the wallet covers, at the rate a trading post's Repair Kits
  work out to (`hullRepair`, `hullRepairPointPrice` in `src/core/trading.ts`: a
  kit's $60 over the 25% of the hull maximum it restores, so a full repair from
  nothing is four kits' worth, $240, whatever the hull). The convenience — no bay
  slot, no trip to a post, any amount — is the portal's reward; the price never
  undercuts the kits.
- **Trading posts** (`src/core/trading.ts`, `src/game/trading.ts`) stand in cleared
  air pockets deep in the mine, derived from their coordinate in `src/world/world.ts`
  rather than stored. Open one to sell ore for cash at the ore table's value, buy
  a small, limited stock of gear, or fill the tank for cash; only the drawn-down
  stock persists, in `state.tradeLedger`.
- **Wrecks** (`src/core/wreck.ts`, `src/game/wrecks.ts`) are the corpse loot a lost
  run leaves behind. When a ship dies — or is scuttled by a hand `R`-`R` — the ore
  it carried and the upgrades fitted to its hull do not survive the replacement, so
  the run drops them as a greyed-out wreck (`W`) on the tile the ship stood on. Fly
  back down, press the wreck from an adjacent tile — or `C` while on or beside it —
  to open a take-only salvage menu: press a stack (or its "1" button) to haul it
  aboard, or **Loot all** to take everything that fits in one press. A wreck vanishes
  the moment it is emptied; up to five stand at once, the oldest dropped past the cap.
  They survive reload, but not for ever: every later death or scuttle wears each
  standing wreck down by one (`WRECK.lifetimeDeaths` = 3, `ageWrecks`), and the one
  that brings it to zero crumbles it to scrap ("The wreck at (x, y) crumbled to
  scrap."). The salvage menu and the observation (`notable` detail "2 items,
  crumbles in 2 deaths", `overlay.deathsLeft`) show how long one has left. A full
  player-data reset clears them all. The fitted upgrades come back as unequipped
  bay items, ready to refit.

### Hazards and descent

- Low fuel warnings appear below 25%; head home to refuel quickly.
- The HUD reserve readout forecasts the trip to the cheapest exit
  (safe/caution/urgent): home, or a field portal you can jump home from while a
  portal stands in the home cavern. It prices a clear flight — every row climbed
  and column crossed — plus a 20% detour allowance (`FUEL.returnReserveMultiplier`;
  measured climbs cost about the clear-flight price), turning to caution within
  1.5× of it, and the fuel gauge names the
  exit ("12 left after reaching Portal "Deep""). The scanner reads the tile the
  drill is aimed at — and, when that tile is known dirt, looks one tile further
  along the drill line, through the fog, and names anything but more dirt behind it
  ("Scanner ↓: dirt — drillable, 3 hits, then magma."). The map's fog is left as it
  is, a cocoon still passes for dirt, and the lookahead never points upward, where
  the drill cannot dig — aimed up at anything solid but rock, the line says so
  ("Scanner ↑: dirt overhead — the drill cannot dig upward.") rather than quoting
  hits. The depth readout counts down to the next landmark below the
  career's deepest descent (`stats.maxDepth`) or the ship, whichever is deeper — so a
  ship back at home reads the band it has yet to reach, never a seam already passed,
  and the starter seam is gone once reached — and toasts when you first dive past
  one. Past the last ore band it rolls on in 1000 m depth records; climbed back above
  a record already set, it names it ("record: 9000 m reached") instead of counting
  down to it. The toasts count across the whole career:
  a seam some earlier ship already reached, or one a portal jump skipped past,
  stays quiet.
- Drilling upward is blocked; use tunnels to fly back up.
- Side-drilling works from a hover too, so ore beside a shaft is never out of
  reach, but with open air under the ship every side hit (a rock bump included)
  costs 1.25× the usual dig fuel (`FUEL.hoverDrillMult`); the scanner line warns
  "Hover: +25 % fuel." while the drill is aimed at such a tile. A cleared tile
  carries the ship in, still hovering — there is no gravity, and the drop below
  stays free.
- Rock, magma pockets, depth, and enemies make deeper mining more dangerous:
  Tunnel Fiends first, then Skitterlings, Ironbacks, and — from 8800 m, inside the
  Uranium and Core Shard bands — Abyss Stalkers (`ENEMY_TYPES` in
  `src/core/enemy-types.ts`). A stalker at 8800 m has 37 hp and bites for 38: a Core
  Breaker with Hull Plating Mk III and the Core Drill (450 hull, drill 11) takes two
  or three bites killing one, so it survives three on a full hull and a fourth with
  a Repair Kit. They are drawn as rusted, haunted versions of the player's own ship.
- Enemies wake when a tunnel opens onto their cocoon, and when the ship comes
  within 2 tiles (Manhattan, `COCOON_WAKE_RADIUS` in `src/core/enemy-exposure.ts`)
  of one with a reachable air path out to it — checked after every step and every
  portal or teleporter jump — so a cocoon beside the shaft hatches before the drill
  gets to it rather than being drilled out asleep for its bounty. A cocoon sealed in
  dirt stays asleep until it is drilled; the bounty is paid either way. A rebuild
  (boot, reload or redeploy) re-runs the exposure over the whole tunnel network at
  once, so it announces only the cocoons hatching within 7 tiles of the ship
  (`REBUILD_WAKE_NOTICE_RADIUS` in `src/game/enemies.ts`); the rest wake quietly. Drill them
  before they chew through the hull. Fight from above in a one-tile shaft; an awake
  biter above you can still be drilled by holding Up into it — only a dormant
  cocoon overhead is out of reach, since the drill never digs upward.
- Magma is charged per pocket (`magmaHitDamage` in `src/core/danger.ts`, curve
  documented at `HULL.hazardBase`): the hit that breaks into an untouched pocket
  scorches the hull once — 9 at the first pockets (≈1490 m), rising with depth —
  and each further hit to vent it only a small tail (1, rising slowly), so a top
  drill is never immune (≈19 a pocket at 7000 m, drill 10) and a starter drill is
  never shredded (≈15 at 1500 m, drill 1). Climbing an open shaft is cheap and
  falling is free: drilling is what burns the tank.
- A rock bump costs 4 hull, and its toast says so ("Solid rock — hull −4."). A held
  key bumps once, then stops; a held Down that falls onto rock stops on it without
  the bump at all. Only a fresh press into the rock bumps again.
- The HUD objective walks a ladder, first match wins (`src/core/objective.ts`):
  refuel at the cheapest exit; patch a low hull (a Repair Kit aboard, in stock, or
  crafted/bought at home or at any trading post, each of which stocks them); unload a full bay; feed a dry base —
  coal while the career is shallower than Coal grows, a fuel order past it; fit or
  salvage upgrades; the first upgrade; a Mk II, then a Mk III; the next hull once
  half its bill is in the Manufacturer's stock or aboard ("build the Prospector …
  (still needs 9 Gold, 4 Ruby)", or "stow your ore and build …" once the bay holds
  the rest); a field portal (the Deep Portal and its bill once the
  deep recipes are unlocked and only it is stocked); a Scanner past 600 m — crafted
  once its Silver is stocked or aboard, else bought from Supply once the wallet
  covers it, else "dig sideways galleries around 600 m" at the Silver band (or sell
  ore at a trading post, once one is known); a trading post past 400 m; the Core Drill,
  then Fuel Cells only from Uranium the Core Drill and the next hull can spare,
  then the next hull, and in the Core Breaker the depth record. A Scout with a Mk I
  fitted is pointed at the Drill Mk I first (mine, stow and craft it, then fit it —
  +75 % drill power, so fewer hits and less fuel per ore) while no drill is fitted
  or held and a slot is free, and then at the Hauler. Last come the ore bands: the deepest band the
  career has reached stays the goal until 3 of its ore are mined (`stats.oresMined`),
  and only then the next band below. "Base low" means the extractor's store plus
  queued coal could not fill a tank, capped at the store's 500 — so a bigger tank
  on a full store is not low.
- The mine has no bottom: the run's goal is to keep hauling richer loads home
  alive, crafting better equipment, and setting depth records.
- Progress (cash, fitted equipment, the bay, the home base, stats, explored tiles,
  the trading stock you have drawn down, the mine you dug, where you parked, and
  the fuel and hull you parked with) is saved locally; death keeps your cash, bay
  equipment, home base, drawn-down trading stock and stats, and costs you the cargo
  aboard, the upgrades fitted to the ship, your position, half the hull, and the
  replacement's fuel out of the extractor.
- The camera zoom is remembered too, but as a preference rather than progress:
  it is stored under `stalinload:zoom-settings:v1` (`src/game/zoom-settings.ts`),
  clamped back into the 0.5x–2x range on load, and survives a death, a fresh
  world, and a player-data reset.

### Death and redeploying

A lost ship — from a destroyed hull, an empty tank or a hand `R`-`R` scuttle —
counts as a death (`stats.deaths`), wears every standing wreck down by one death,
drops its own wreck, rebuilds the world, and redeploys a fresh ship. A scuttle
goes through `gameOver` like any other death (`restartGame` in `src/game/run.ts`
scuttles a live ship first), so it is never a free refill or repair. Where the
replacement lands depends on how many
portals are built (`restartGame` in `src/game/run.ts`, `respawnPortals` in
`src/core/portal.ts`):

- **No portals.** The ship redeploys in the home cavern, as it always has.
- **Exactly one portal.** The ship redeploys at that portal, with no prompt.
- **Two or more portals.** A portal overlay opens in respawn mode listing every
  portal; it has no close button and ignores `Escape`/`Space`, so the run cannot
  continue until a destination is chosen. Picking one drops the wreck, rebuilds the
  world, and spawns the ship at that portal.

The replacement's vitals are shares of its hull's bare base tank and hull
(`RESPAWN` in `src/core/balance.ts`, `respawnVitals` in `src/core/state.ts`):

- **Hull.** Half of the base maximum (`hullFraction` 0.5), wherever it lands.
- **Fuel at home** (the home cavern, its `Home` portal included). Drawn out of the
  home extractor's store, up to a full base tank, leaving the store that much
  lower (`hud.base.fuel`). A store too dry to cover half a tank gives up what it
  has and the ship still deploys on half of one (`homeFuelFraction` 0.5), so a
  dry base never strands a new ship.
- **Fuel at a field portal.** Half a base tank (`portalFuelFraction` 0.5), drawing
  nothing, so a death beside a deep portal still costs a trip home to refuel.

Each respawn row prices its tank ("full tank" / "½ tank" / "80/100 fuel";
`respawnFuel` in the observation), and the toast names what was drawn and kept:
"Replacement ship deployed with 100/100 fuel drawn from the extractor, hull 50 %."
or "Replacement ship deployed at Portal "Deep" with 50/100 fuel, hull 50 %."

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
  side, and both preferences are stored under `stalinload:audio-settings:v1`
  (`src/audio/audio-settings.ts`).
- `audio.enabled` means the shared `AudioContext` is unlocked; `musicEnabled` and
  `sfxEnabled` are the player's two switches. Pressing either button while the
  context is still locked retries the unlock, so a blocked autoplay recovers.
- Pointer/touch input can also trigger audio startup; a key press cannot.
- Each player action has its own named cue in `src/audio/audio.ts`, built from
  small `blip`/`noise` voices: `refuel`, `craft`, `sell`, `buy`, `stow`, `take`,
  `place`, `lift`, `portal`, `upgradeFit`, `upgradeRemove`, `repair`, `open`,
  `close`, `arm`, `disarm`, `respawn`, `bounty`, `milestone`, `surveyDone`,
  `chestOpen` and `grave`, plus a soft `click` for pure-UI switches. Every cue is
  silent while the effects are muted.
- Sound effects and the soundtrack are independent: the effects run on Web Audio,
  the music on an `<audio>` element, and a rejected autoplay only downgrades the
  music to the synth fallback.

## Agent play

The game is playable programmatically, not just by a human at the keyboard. An LLM
agent drives it over [MCP](https://modelcontextprotocol.io): a headed Chromium
window — the same window a human watches — is driven with real trusted key and
mouse events on the documented element ids, exactly the path the e2e suite uses.
There are no `window.__*` test hooks; the harness reaches the running game through
a dynamic `import('/src/agent/bridge.ts')` served by the Vite dev server, the same
module `boot()` registered the live runtime into. The agent reads the world from a
fog-respecting observation JSON (below) rather than the pixels.

### Prerequisites

A Chromium to drive. `agent/chromium.ts` resolves it the same way the e2e suite
does: `PLAYWRIGHT_CHROMIUM_PATH` wins when set, otherwise the first of
`chromium`/`chromium-browser`/`google-chrome-stable`/`google-chrome`/`chrome` on
`PATH`; in CI (`CI` set) it uses neither so Playwright's own pinned download is
used. A Playwright-downloaded Chromium does not run on NixOS, so there set
`PLAYWRIGHT_CHROMIUM_PATH` or keep a system Chromium on `PATH`.

### Running the server

```bash
npm run -s agent:mcp     # tsx agent/mcp-server.ts, a stdio MCP server
```

Keep the `-s`: without it npm prints its `> miner@… agent:mcp` banner to stdout,
which is the MCP transport, and the client chokes on it.

The repo's `opencode.json` registers it so an opencode agent picks it up
automatically:

```json
{
  "mcp": {
    "miner": {
      "type": "local",
      "command": ["npx", "tsx", "agent/mcp-server.ts"],
      "enabled": true
    }
  }
}
```

For Claude Code the committed project-scope `.mcp.json` registers the same
server:

```json
{
  "mcpServers": {
    "miner": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "agent/mcp-server.ts"]
    }
  }
}
```

Claude Code asks for approval the first time it loads a project-scope server.
Start it from the repo root, since the registered script path is relative; the
Vite server `agent/session.ts` starts resolves its root from its own location, so
that part works from any directory. `claude mcp list` confirms `miner` is
registered.

The server owns **one game session at a time**: `game_start` errors if one is
already open (or still starting), and every action tool returns the fresh
observation as JSON. It logs only to stderr (stdout is the MCP transport), and it
closes the session and exits when the client goes away — stdin ending, the
transport closing, or SIGINT/SIGTERM/SIGHUP.

Actions fail fast with a reason rather than hanging, and a failed action still
leaves the sim paused (the re-pause, and a `hold`'s key release, run in a
`finally`):

- `click` on a control that cannot take it: `… is not rendered right now` (its
  screen is closed), `… is disabled right now`, or `… is covered by open overlay
  dialog#…`. Anything else gets Playwright's click with a 2 s timeout.
- `type` with no text field focused: `type needs a focused text field …`.
- `press_tile` on a tile hidden under a HUD card or dialog: `… is covered by the
  HUD/overlay …, not the #game canvas`.
- `press_tile` on a tile more than one tile from the ship with nothing armed:
  `… too far for a tile press: a press never moves the ship …` — the game would
  ignore it (`src/agent/tile-press.ts`). Clicking it anyway changed nothing but,
  as a session's first trusted pointer press, unlocked the browser's audio, which
  players read as the music button toggling. An armed device, or a lost ship's
  restart press, is left to the game.
- Any tool after the Chromium window was closed or crashed: `The game browser
  closed; call game_start to open a new session.`

### Tools

| Tool | Arguments | What it does |
|---|---|---|
| `game_start` | `headless?` (bool, default false), `freshSave?` (bool, default false), `port?` (int, default 5180) | Start/reuse a dev server, launch Chromium, load the game, return the initial observation. |
| `game_stop` | — | Close the session (browser, and any server this session started). |
| `observe` | `radius?` (int, default 7, max 40), `detail?` (`"recipes"`) | Return the current observation without changing the world; `detail: "recipes"` mirrors an open Manufacturer's whole recipe list rather than only its craftable rows. |
| `start_run` | — | Start the run from the title splash (presses Enter, waits for the HUD). |
| `press` | `key` (string) | One key press, e.g. `ArrowDown`, `w`, `Space`, `e`, `t`, `c`, `+`, `-`, `Escape`. Keys always reach the game: with no dialog open the mine canvas takes focus first, and inside a dialog Space/Enter drop focus off a button so they act as the overlay's keys. |
| `type` | `text` (string) | Type text into the focused input (e.g. after clicking `portalNameInput`), then return the observation. |
| `hold` | `key` (string), `ms` (int, max 60000), `shift?` (bool) | Hold a key for `ms` of sim time after its first step (the sim runs at wall-clock speed during the hold): a direction steps at once, then every 105 ms, so `n × 105` ms is `n + 1` steps; `shift` sprints if a Booster is fitted. |
| `click` | `target` (string), `value?` (string), `kind?` (string) | Click one allowlisted UI control (below). |
| `press_tile` | `x` (int), `y` (int) | Press a mine tile by world coordinate (clicks its canvas centre): plant an armed device, lift with the armed toolkit, restart after a lost ship, or open a station, portal, trading post, container, wreck, chest or grave within one tile of the ship. It never moves the ship; an unarmed press further off is refused as too far. |
| `wait` | `ms` (int, max 60000) | Let the sim run for `ms` wall-clock, then return the observation. |
| `screenshot` | — | A PNG of the window, as image content. |
| `set_realtime` | `enabled` (bool) | Switch the pause model (below). |

`click` accepts an allowlisted set of controls only; anything else is refused with
the full allowed list. Targets take two forms: an id (`shipBtn`, `stationCloseBtn`,
with or without a leading `#`), or an attribute control in `name=value` form
(`data-craft=upgrade:drill:1`, `data-portal=48,20`), with the two-attribute transfer
controls joining both values with a comma (`data-cargo=take,ore:Iron`,
`data-station=stow-one,ore:Coal`, `data-trade=buy,repairKit`). The equivalent object form is
`{target, value?, kind?}` — the MCP `click` tool takes `target`/`value`/`kind`
fields directly. Allowlisted controls: the HUD/action bar (`shipBtn`,
`teleporterBtn`, `infoBtn`, `musicBtn`, `sfxBtn`, `inventoryToggleBtn`), inventory
slots (`scannerSlotBtn`, `dynamiteSlotBtn`, `containerSlotBtn`, `repairKitSlotBtn`, `fuelCellSlotBtn`,
`manufacturerSlotBtn`, `extractorSlotBtn`, `portalSlotBtn`, `toolkitSlotBtn`, the `decor:*SlotBtn`
panels — derived from `src/ui/inventory-slot-ids.ts`, the table the panel renders
from), the ship screen (`data-ship-equip` with an upgrade kind,
`data-ship-unequip` with the 0-based fitting-slot index, `shipCloseBtn`), the station (`stowAllBtn` — Stow ore, the ore stacks only —, `data-station`
with values `take`/`take-one`/`stow`/`stow-one` and a `data-station-kind`,
`data-craft` with a recipe row's id — its output kind, or the output plus `:alt` for a
deep alternate such as `device:portal:alt` —, `data-craft-ship` with the next hull's id (e.g. `hauler`),
`data-supply` with a Supply item kind at the home-cavern station,
`stationCloseBtn`), the fuel extractor (`loadCoalBtn`,
`extractorBuyFuelBtn` at the home extractor, `extractorCloseBtn`), the cargo container (`data-cargo` with values
`store`/`store-one`/`take`/`take-one` and a `data-cargo-kind`, `cargoCloseBtn`), the
wreck salvage and chest menus (`data-cargo` with values `take`/`take-one` and a
`data-cargo-kind`, `lootAllBtn`, `cargoCloseBtn`), the grave stone (`graveOkBtn`), the
trading post (`data-trade` with values `sell`/`sell-one`/`buy` and a `data-trade-kind`
— an `ore:*` kind to sell, a catalog item kind to buy — `tradeFuelBtn` to fill the
tank, `tradeCloseBtn`), the
portal travel/teleporter/respawn screen (`data-portal` with the destination `"x,y"`
as its value, `portalNameInput`, `portalNameSaveBtn`, `portalRepairBtn` — the paid
hull repair, in travel mode while the hull is short — `portalCloseBtn`), the
info tabs (`data-info-section`, `infoCloseBtn`), the Settings tab
(`data-info-section=info-settings`: `settingsMusicBtn`, `settingsSfxBtn`,
`cheatsToggleBtn`, the valueless cheat grants `data-developer-grant-ores` and
`data-developer-fill-extractor`, `resetPlayerDataBtn`, `resetWorldStateBtn`, `exportSaveBtn`,
`importSaveText`, `importSaveBtn`, `importSaveConfirmBtn`, `importSaveCancelBtn`,
`resetGameBtn`, `resetGameCancelBtn`, `resetGameConfirmBtn`), the intro
(`introStartBtn`), and the failure notice (`failureReloadBtn`). The allowlist lives
in `agent/targets.ts` (no Playwright imports), and `src/agent/allowlist.test.ts`
scans every `src/ui/**/*.tsx` for interactive elements and fails on one the
allowlist cannot reach unless it is excluded there with a reason. Importing a save is `click importSaveText`, `type` the JSON,
then `importSaveBtn` and `importSaveConfirmBtn`. A click that reloads the page
(`importSaveConfirmBtn`, `resetGameConfirmBtn`) returns once the game is back on
the title splash, and the session answers the cheat resets' native `confirm()`
with yes.

### The observation

Every tool returns an `AgentObservation` (`src/agent/observation.ts`) — exactly
what a sighted player sees, as JSON. The top-level shape:

- `tick`, `phase`, `activeOverlay`, `gameOver`
- `ship`: `{x, y, class, shipLabel, slots, depthMeters, fuel, fuelMax, hull, hullMax, cargo, cargoMax, drill, boost, equipment[], atSurface, on}` (vitals read from the live sim, not the UI snapshot; `class` is the hull id on the ship ladder — `scout`, `hauler`, `prospector`, `leviathan`, `corebreaker` — `shipLabel` its name and `slots` its fitting-slot count, `equipment.length`; `on` is `{tile, what?, detail?}` — the tile the `@` hides and anything notable standing on it)
- `cash`, `stats` (the career counters, including `scannersObtained`, `bestMarkCrafted` and `oresMined` — ore mined per ore name, e.g. `{"Gold": 4}` — the objective ladder's progress)
- `bay`: the cargo bay as `{kind, label, count}` stacks (lean — no `info`); `armedPlacement`: the item armed for placement, or `null`
- `placement`: while a placeable device is armed, `{kind, target, valid, sites[]}` — the valid `sites` the canvas grid tints green around the ship, and the hovered/last-pressed `target` tile with whether the device fits there (`null` with no target); `null` when nothing placeable is armed (the toolkit included)
- `audio`: `{music, sfx, musicLabel, sfxLabel}` — the two switches and the tooltips their buttons carry (the next action, or why sound is blocked; the accessible names stay a fixed "Music" / "Sound effects"); `runtime`: `{status, error}` — `booting`/`ready`/`failed` and the failure notice's detail
- `hud`: `{cash, objective, scanner, postHint, fuelReserve{status, needed, margin, exit}, depthTarget{name, kind, remaining, record}, stationHint, teleport{count, usable}, base{fuel, coal, alert}, nextShip{id, label, missing, stow}, alerts{fuel, hull, cargo}, announcement, inventoryCollapsed}` — `scanner` reads the tile the drill is aimed at, and behind a known-dirt target names what the drill line breaks into next, fog or not (`"Scanner ↓: dirt — drillable, 3 hits, then magma."`; plain dirt behind, or a cocoon, adds nothing); `fuelReserve` prices the flight to the cheapest exit, which `exit` names (`"Home"` or a field portal such as `"Portal \"Deep\""`): `needed` is the fuel that trip costs and `margin` what is left after it; `postHint` is the trading-post beacon (`"Trading post ≈9 tiles ↙"` for the nearest post within 12 tiles, fog ignored; empty when none is near or one is already in reach); `teleport.count` is the charges aboard and `teleport.usable` whether pressing `t` would open the portal list right now; `base` is the home extractor's stored fuel and queued coal, `alert` once the two could no longer fill a tank (capped at the store's 500), and `null` with no extractor in the home cavern; `depthTarget` is the next landmark below the career record or the ship, whichever is deeper (`remaining` metres below the ship), and `record` a depth record already set that the ship is back above — the HUD then reads "record: 9000 m reached" — else `null`; `nextShip` is the next hull up the ladder, what neither the first Manufacturer's stock nor the bay holds for it (`missing[{kind, count, label}]`, still to mine) and what the bay carries that the stock lacks (`stow[…]`) — both empty when buildable — the Shipyard at a glance with no overlay open — or `null` on the top rung
- `view`: `{origin:{x, y}, rows:[…], legend, zoom:{level, min, max}}` — a `2·radius+1`-wide (default 15) by `~11`-tall ASCII grid centred on the ship, and the camera zoom (which the grid does not follow)
- `notable`: unfogged things worth attention, each `{x, y, what, detail?}` where `what` is `ore | hazard | enemy | container | wreck | chest | grave | scanner | dynamite | station | tradingPost` (a chest's `detail` is its item count, e.g. `"3 items"`; a wreck's adds its lifetime, e.g. `"2 items, crumbles in 2 deaths"`; a grave has none)
- `overlay`: the single open screen mirrored only while it is up — `station` (bay, stock, the recipes the stock can craft now `[{id, output, label, inputs, craftable, missing, info}]` and `recipeCount`, how many (unlocked) rows the screen lists — `observe` with `detail: "recipes"` mirrors every listed row, the unaffordable ones with their `missing` shortfall; `id` the row's `data-craft` value (`"device:portal:alt"` for the Deep Portal, listed only once a Mk II is crafted) —, and `supply[{kind, label, price, affordable, info}]` — the home Supply rows, empty at a station away from the base — and `shipyard{current{id, label, slots}, next}`, where `next` is `{id, label, slots, craftable, inputs, missing, stow, gains{fuelMax, hullMax, cargoMax, drill}}` (`missing` what neither the stock nor the bay holds, `stow` what the bay carries that the stock lacks) for the one hull `data-craft-ship` can build, or `null` on the top rung), `extractor` (coal, fuel, progress, `fuelOrder{amount, cost}` — what `extractorBuyFuelBtn` would buy now, `null` away from the base — and `fuelPrice`, the home price per unit an order pays, `null` away from the base), `ship` (`ship{id, label, slots}` — the hull the heading names — slots `[{index, kind, label, locked, info}]` — `locked` the hull's last slot before any Mk II is crafted — and fittable), `container` (ship, container), `wreck` (ship, wreck, and `deathsLeft` — the further deaths it takes to crumble it), `chest` (ship, chest), `grave` (name, born, died, cause), `trade` (cash, sell offers, buy offers, `fuelPrice` — this post's price per unit of fuel, dearer the deeper the post — and `fuel{unitPrice, amount, cost}` — the fill `tradeFuelBtn` would buy now at that price, `amount` 0 when the tank is full or the wallet short), `portal` (`mode` `travel`/`teleporter`/`respawn`, the `source` portal `{x, y, name}` and echoed `name` in travel mode, `repair{missing, amount, cost, affordable}` in travel mode — the hull short of whole and what `portalRepairBtn` would restore and charge now (a partial repair when the wallet is short; `affordable` whether the press does anything), `null` while the hull is whole — and `destinations:[{x, y, name, depth, distance}]` — in respawn mode each also carries `respawnFuel`, the absolute fuel the replacement would deploy with there: at home what the extractor's store covers of the base tank (never under half of it), half of it at a field portal), or `info` (`tab`, the tablist as `sections:[{id, label}]`, and the visible tab's contents only — `objective{status, cargo}`, `stats`, `prospecting{tip, galleries, ladder, ores, posts[{x, y, depth}]}` (`galleries` the dig-sideways hint, `ladder` the ship-ladder line, `posts` the trading posts found — explored post tiles, shallowest first, depth in metres), `hazards{tip, rows}`, `controls[{keys, action}]`, or `settings{cheatsOpen, confirmingReset, confirmingImport, oreNote}` — `oreNote` the "Ore aboard is not saved — stow it first." warning the Save data box and the import confirm show while ore is aboard (a save leaves the bay's ore out), else `null` — plus `saveExport` — the JSON the last **Export save** produced — once there is one, and `saveExportPath`, where the harness saved that export's file download) — else `null`. Each item row inside an overlay (station stock/bay, recipes, ship slots/fittable, container, wreck, chest, trade sell/buy, Supply rows) carries an `info: string[]` — the same tooltip lines a human reads on hover; a recipe's `info` also lists each input's `have/need` count. The top-level `bay` omits `info` to stay lean.
- `toasts`: the last ~10 toast lines, each `{tick, message}` (a bridge-owned ring buffer, since toasts flash and vanish between snapshots)

Fog is honoured: a tile the player has not explored is `?` and never appears in
`notable`, using the same `isTileExplored` gate the renderer paints fog with.
Station stock, extractor buffers, and container, wreck and chest contents only
appear while that overlay is open — open it to see them. A chest looted bare
leaves both the view and `notable`.

The `view.rows` legend (`VIEW_LEGEND`):

```text
. air   # dirt   R rock   o ore   ! hazard   E enemy   D decor
M manufacturer   X fuel extractor   P portal   T trading post   C container   W wreck   H chest
+ grave   S scanner   * dynamite   @ ship   ? fogged
```

### Pause / real-time model

By default (`realtime = true`) the sim is **frozen between tool calls** and runs
only while an action is in flight: each `press`/`hold`/`click`/`press_tile`/
`start_run` unpauses, fires its real events, settles until at least two sim ticks
have run after them, then pauses again — so the window shows smooth human-speed
motion during the action and holds still in between, and every returned observation
is a stable snapshot that already shows what the action did. (Settling on two
animation frames alone used to drop presses: resuming re-anchors the fixed-step
clock, so the first frame runs no tick and the second can run none either, and the
queued move was then overwritten by the next press of the same key.) A `hold` puts
its key down on a frozen sim, keeps it down for `ms` of sim time after the first
step and freezes the sim in the frame that time runs out, before the key comes up,
so its step count is exact even on a loaded machine (reading the start tick after
a live keydown let a slow round trip add a step).
`wait` always lets the sim run for its duration. Call `set_realtime` with
`enabled: false` to leave the sim running continuously between calls too; the world
the next observation describes will then have moved on by however long the agent
took to think. A paused sim still paints and syncs, so pausing never blanks the
window.

### Watching, and options

`game_start` launches Chromium **headed by default** at a 1280x800 viewport; that
window is the human's live view of what the agent is doing. Pass `headless: true`
to hide it (the e2e smoke test runs this way). Pass `freshSave: true` to wipe the
persisted `localStorage` save before the page loads, for a clean run from the home
base. `port` picks the port to serve on (default 5180); a dev server already
listening there — including one you started with `npm run dev` — is reused rather
than fought.

### Adding support for a new feature

Per `AGENTS.md`: a gameplay feature is not done until the agent can use it too.
Any new player action needs a harness path — a key handled in
`src/game/input.ts` (reachable via `press`/`hold`), an allowlisted control in
`agent/targets.ts` (reachable via `click`; `src/agent/allowlist.test.ts` fails on a
control that has none), or a tile press (`press_tile`) — and
any new player-visible state needs to be surfaced in `buildObservation`
(`src/agent/observation.ts`), with coverage in `src/agent/` and/or
`e2e/agent.spec.ts`.

### Troubleshooting

- **Port already in use.** If this game's dev server is already on the port (it
  answers `GET /src/agent/bridge.ts`), the session reuses it instead of starting
  its own; if something else answers there, `game_start` refuses with `Port … is
  already serving something that is not this game` — pass a different `port`. If
  the port is held by a process that does not answer HTTP, the session's own Vite
  server (started with `strictPort`) fails to bind — again, choose another `port`.
- **No Chromium found.** With no `PLAYWRIGHT_CHROMIUM_PATH` and none on `PATH`,
  Playwright falls back to its pinned download, which will not launch on NixOS. Set
  `PLAYWRIGHT_CHROMIUM_PATH` to a working Chromium (or install one on `PATH`).
- **"The agent bridge did not register within 15s".** The page loaded but the game
  did not boot (a build/import error). The error carries the page's "Mine offline"
  / "Interface crashed" notice text and its uncaught page errors when there are
  any; otherwise open the same URL in a normal browser and check the console.

## Development checklist

After making changes, run the full check sequence — `./test.sh` does all of it
(lint, CSS format check, unit tests, typecheck, production build, and the
Playwright suite when a system Chromium is available):

```bash
./test.sh
```

The individual commands, if you want them one at a time:

```bash
npm run lint        # oxlint over src/, shared/, e2e/, agent/ and the config files
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
| `e2e/boot.spec.ts` | The title card and its start button over the visible canvas; `Enter` and "press anywhere" both starting a run with the canvas focused, the HUD painted and the scanner reading real terrain; the canvas being the surface's only tab stop; the whole flow producing no console errors and no page errors. |
| `e2e/gameplay.spec.ts` | One keypress charged exactly once and clearing exactly one tile (the fence against a doubled input/step pipeline); depth rising and fuel falling over a descent; digging below the home cavern dropping the ship into the mine, live region included; crafting a scanner at the Manufacturing Station and taking it aboard; deploying a scanner and planting dynamite on the mine; focus staying on the canvas while mining. |
| `e2e/dialogs.spec.ts` | Ship, station and info dialogs opening with focus inside the dialog; `Escape`, the × button and the backdrop each closing it and restoring focus to the trigger; Tab never escaping into the HUD behind; the info tablist's click and arrow-key navigation; the ship and info overlays handing the screen over rather than stacking. |
| `e2e/focus-visible.spec.ts` | The ring drawn for `Tab` (3px, and inset on the canvas) and gone for a click that moves focus, including the focus a clicked-shut dialog restores. |
| `e2e/failure.spec.ts` | A refused 2D context — stubbed with an init script — surfacing as the "Mine offline" notice with its detail line, its `role="alert"` and a working Reload, while the crash boundary stays out of it. |
| `e2e/agent.spec.ts` | The programmatic-play harness end to end and headless: it drives `openGameSession` itself (reusing the suite's webServer), seeds a soft dirt tile under the spawn, and checks the observation sees the ship at the home base, the default pause model freezes `tick` between decisions, `start_run` brings the player into play, `Space` opens the station overlay in the observation, and holding `ArrowDown` burns fuel, advances the tick and scrolls the ASCII view down, and a far tile press is refused as too far; then every info tab by `data-info-section`, the Settings flags and cheat grant, the `+`/`-` zoom and the inventory fold; plus the craft → take → fit/unfit (fuel carried with the tank, third slot locked until a Mk II craft opens it), extractor top-up on parking and load-coal, container store/take, dynamite arm-and-plant, trading (from a saved part-empty tank), wreck (with its lifetime), chest, grave, portal (a paid hull repair from the travel list, a respawn at a field portal on half a tank), toolkit and save export/import flows (the export's downloaded file included); and that every press is one step the returned observation already shows, and a hold of `n × 105` ms is `n + 1` steps. |

Two notes on how the suite is wired:

- **The dev server, not `vite preview`.** React only double-invokes `<StrictMode>`
  effects in a development build, so the runtime's `dispose()` is only exercised
  there. `playwright.config.ts` starts the Vite dev server itself on
  `127.0.0.1:5199` (loopback only, unlike `npm run dev`'s `0.0.0.0`).
- **One deliberate white box.** `openOverlayDirectly()` in `e2e/support/game.ts`
  imports the app's own `src/ui/commands.ts` through the dev server to request an
  overlay. It exists because "ship and info at once" has no pointer path — while one
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
workflow is the browser under test. `./test.sh` probes the same way: it runs the
suite when `PLAYWRIGHT_CHROMIUM_PATH` is set (failing if that path is not
executable) or one of those system binaries is on `PATH`, and says so when it
skips.

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

One GitHub Actions workflow, `.github/workflows/deploy-pages.yml`, and it only
runs when triggered manually (`workflow_dispatch`) — nothing runs on pushes or
pull requests, so `./test.sh` is the gate before pushing. It has three jobs, all
on Node 22:

- `build` runs `npm ci`, then lint, CSS format check, typecheck, unit tests and
  `npm run build`, and uploads `dist/` as the Pages artifact.
- `e2e` runs beside it: `npm ci`, `npx playwright install --with-deps chromium`
  and the end-to-end suite, uploading the HTML report when it fails.
- `deploy` needs both, so a red check or end-to-end run blocks the deployment,
  then publishes the artifact to GitHub Pages. Deployments never overlap
  (`concurrency: pages`, a newer run waits rather than cancelling).

`vite.config.ts` sets a relative `base`, so the same build works at a domain
root and under the `/miner/` Pages project subpath.
