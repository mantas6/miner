# Stalinload

**Status:** public repo. The `main` build is deployed to GitHub Pages at
<https://mantas6.github.io/miner/>; run it locally with Vite (`npm run dev`)
or build with `npm run build`.

A small browser-based Motherload-style mining game. The ship lives in an
underground home cavern; mine ore, haul it back to the home base, craft ship
upgrades and gear at the Manufacturing Station, brew fuel from coal at the Oil
Extractor, and survive deeper hazards/enemies as the mine keeps going down.

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
refresh resumes down the shaft instead of at the home base — with a full tank, a
whole hull and an empty cargo bay, since none of those are saved. Dying is the
break: it costs you your position, the cargo aboard, and the upgrades fitted to
the ship (the ones in the bay survive). If the restored mine turns out to be solid rock at that
tile (a capped save), the ship starts at the home base rather than buried,
because the drill cannot dig upward.

The save is version 18 and a clean break: every save written by an older build is
discarded on load rather than migrated, because the reworks changed the shape too
much to convert honestly (the four ship stats became derived from fitted
equipment, the item counters became one `bay` of stacks, and the stations became
placed entities carrying their own state). A returning player from an older build
starts fresh. What the save keeps: the parked tile, cash, the tile diff, explored
tiles, stats, the non-ore `bay` stacks, the fitted `equipment`, the placed
stations (each Manufacturing Station's stock, each Oil Extractor's coal/fuel, and
each Portal's name),
the drawn-down trading-post stock (`tradeLedger`), and the hardware left standing
in the mine (scanners, dynamite, crates and wrecks with their contents). Ore
aboard the ship is never saved — it is lost with the run.

Underground fog of war is persistent. Movement permanently reveals a fixed 3x3
square around the ship. The indestructible bedrock ceiling above the home cavern
is always visible.

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
├── opencode.json
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
│   ├── agent/
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
├── agent/
│   ├── chromium.ts
│   ├── session.ts
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
        ├── build.yml
        └── deploy-pages.yml
```

| Path | Purpose |
|---|---|
| `AGENTS.md` | Working agreements for anyone changing the code: avoid UI clutter, keep the rules pure, verify with `./test.sh`. |
| `index.html` | Main game page and root mount node; loaded by Vite. |
| `shared/constants.ts` | World constants, the home-cavern layout and station positions, camera scale (36px tiles), persistence limits, and the ore table (Iron included). |
| `shared/exploration-codec.ts` | Fog-of-war index math and the run-length encoding used by persistence. |
| `shared/world-schema.ts` | Zod schemas and derived types for tiles, enemies, and the persisted world state. |
| `shared/tile-key.ts` | Canonical `"x,y"` coordinate key used by tile maps. |
| `src/main.tsx` | Vite entry point: imports global styles and renders the app inside `<StrictMode>` and an error boundary, handing the game-runtime factory to it. |
| `src/persistence.ts` | Local save/load of player progress, the ship's parked tile, explored tiles, the drawn-down trading-post stock (`tradeLedger`), and the world's tile diff (`localStorage`). |
| `src/core/` | Pure gameplay rules and types: balance, the item catalog (`items.ts`), the item-description registry the tooltips and overlay `info` read from (`item-info.ts`), ship upgrades (`ship-upgrades.ts`), crafting recipes (`crafting.ts`), the placeable stations — Manufacturing Station, Oil Extractor and Portal — with their reach, transfers and coal/fuel conversion (`stations.ts`), the portal travel-network rules — naming, sanitizing, destinations and respawn candidates (`portal.ts`), trading-post offers and pricing (`trading.ts`), decorations (`decor.ts`), movement, dynamite, teleporter, cargo containers, wrecks (`wreck.ts`), enemies, objectives, scanner, fuel reserve, depth milestones, spoken ship status, stats, danger, fixed-step clock, developer tools. |
| `src/world/` | World generation (terrain, ore bands, and coordinate-derived trading posts in `world.ts`), the tile diff that turns a saved world back into terrain (`tile-diff.ts`), world-state reset, and visible tile range. |
| `src/game/` | Gameplay orchestration (`game.ts`, the `createGameRuntime()` factory) plus its feature modules — `enemies.ts`, `actions.ts`, `move.ts`, `run.ts`, `input.ts`, `world-grid.ts`, `viewport.ts`, `zoom.ts` (wheel/pinch camera zoom maths), `zoom-settings.ts` (the remembered zoom level), `readouts.ts`, `scanner-devices.ts`, `dynamite-sticks.ts`, `cargo-containers.ts`, `wrecks.ts` (opening and salvaging the wrecks a lost run leaves behind), `home-stations.ts` (the Manufacturing Station and Oil Extractor sim), `portals.ts` (the portal travel, teleporter and respawn overlay sim), `trading.ts` (buying and selling at a trading post), `station-devices.ts` (placing crafted stations in the mine), `toolkit.ts` (the Construction Toolkit that lifts empty stations and containers back aboard), `decor.ts` (placing decorations) — the canvas surface factory (`dom.ts`) and the teardown registry every side effect registers with (`disposal.ts`). |
| `src/agent/` | The programmatic-play seam inside the game: `observation.ts` builds the fog-respecting `AgentObservation` (ASCII view, notable list, HUD and the one open overlay) an LLM reads instead of the screen, and `bridge.ts` is the `agentBridge` singleton — mirroring `commands.ts` — a harness reaches the running game through (observe, pause, tile→screen projection). |
| `src/render/` | Canvas drawing, and the terrain/fog chunk cache policy. |
| `src/audio/` | Web Audio graph, sound effects, soundtrack playback, and autoplay permission. |
| `src/audio/tracks.ts` | Track registry for playback: the `TrackId` union, `TRACKS` (title plus mp3/ogg URLs), `DEFAULT_TRACK_ID`. |
| `src/audio/encoding.ts` | `prefersMp3()`/`pickSource()`: the one place that decides mp3 or ogg for an asset that ships as both. |
| `soundtrack/engine.py` | Track-agnostic synth/render/encode engine (stdlib only): oscillators, envelope, note names, event bucketing, 44.1 kHz stereo WAV mixdown, `tanh` saturation, loop-edge fades, and the ffmpeg mp3/ogg encode. |
| `soundtrack/tracks/golden_signal.py` | "Golden Signal", the built-in Soviet/industrial mining march: patterns, voices, tempo, seed. Also the template for new tracks. |
| `soundtrack/tracks/__init__.py` | Generator-side registry: the `TRACKS` dict keyed by slug and `get_track()`. |
| `soundtrack/render.py` | CLI that renders registered tracks into `public/assets/music/`. |
| `public/assets/music/` | The shipped soundtrack assets (`golden-signal.mp3`, `golden-signal.ogg`) — build products of `soundtrack/render.py`, copied verbatim into `dist/` by Vite. |
| `src/ui/` | React components — including the trading-post screen (`TradeScreen.tsx`), the portal travel/teleporter/respawn screen (`PortalScreen.tsx`) and the shared hover popup driven by the item-description registry (`Tooltip.tsx`) — the zustand UI store (`store.ts`), the command table the buttons dispatch into (`commands.ts`), the effect that owns the runtime's lifetime (`useGameRuntime.ts`), the boot/crash notices (`Failure.tsx`), and co-located CSS modules. |
| `src/styles/base.css` | Design tokens plus element-level styling (`button`, `ul`, `kbd`, `meter`, `canvas`, `#shell`, `#game-panel`) and the app-wide `:focus-visible` ring. |
| `src/styles/icons.css` | Global equipment sprite sheet (`icon-*`), addressed by name from the item catalog. |
| `src/styles/intro-art.css` | Global intro badge art. |
| `vite.config.ts` | Vite build config (relative `base`, React Fast Refresh) and Vitest test config. Vitest only collects `src/**` and `shared/**`, so `e2e/` is never picked up by `npm test`. |
| `tsconfig.test.json` | The test half of `npm run typecheck`: the same strict options plus `vitest/globals`, which `tsconfig.json` withholds from production source. |
| `tsconfig.e2e.json` | The third `npm run typecheck` pass: `e2e/` and `playwright.config.ts`, which run in Node and so need those globals rather than Vitest's. |
| `playwright.config.ts` | End-to-end config: one Chromium project, the Vite dev server started as a `webServer`, and the local/CI browser resolution described under "End-to-end tests". |
| `agent/` | The Node-side programmatic-play harness (no React, no test runner): `chromium.ts` resolves the Chromium to drive (shared with `playwright.config.ts`), `session.ts` (`openGameSession`) starts/reuses a Vite server, launches a headed Chromium, and drives the game with real key/mouse events plus the pause model, and `mcp-server.ts` is the stdio MCP server that exposes it to an LLM agent. See "Agent play". |
| `e2e/` | The Playwright suite — boot flow, keyboard mining, the modal dialogs and focus restoration, the `:focus-visible` ring, the runtime-failure notice, and the agent-harness smoke test — plus `support/game.ts`, the shared page fixtures. |
| `opencode.json` | Registers the `miner` MCP server (`npx tsx agent/mcp-server.ts`) so an opencode agent can drive the game. See "Agent play". |
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

`boot()` also registers a third bridge beside `registerUiCommands()`:
`setAgentBridge()` wires the running game into the `agentBridge` singleton
(`src/agent/bridge.ts`) for programmatic play, and `dispose()` calls
`resetAgentBridge()` to point it back at its no-op defaults. The loop carries a
`paused` flag the bridge drives: while paused, `draw()` and `syncUi()` keep
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
Cargo, behind a "Show cheat menu" disclosure. It is available in every build with
no environment opt-in, and it is mounted only while that disclosure is expanded.

The world reset regenerates terrain, enemies, caches, and fog while preserving
the player's cash, fitted equipment, inventory/cargo, home base, stats, ship
condition, and settings.

## Controls

Ship movement is keyboard-only. Pointer/touch input is used for UI
only (menus, buttons, modals, starting the run, restarting, audio unlock) plus
zooming the camera with the wheel or a trackpad.

| Action | Keyboard | UI (click/tap) |
|---|---|---|
| Start a run | `Enter` or `Space` | Click/tap intro screen |
| Move / fly / dig | `WASD` or arrow keys | — |
| Sprint through open space (needs a fitted Booster) | Hold `Shift` + direction | — |
| Zoom the camera (0.5x–2x, remembered) | — | Wheel scroll or trackpad pinch over the mine |
| Open a station in reach (Manufacturing Station / Oil Extractor) | `Space` | Press the station tile on the mine |
| Open a trading post in reach | `Space` | Press the post tile on the mine |
| Open a portal in reach (its travel list of the other portals) | `Space` | Press the portal tile on the mine |
| Ship equipment (fit/unfit upgrades) | — | Ship button |
| Use a repair kit (patch the hull) | — | Repair Kit inventory slot |
| Plant dynamite (5 s fuse) | `E`, then press a mine tile | Dynamite inventory slot, then a mine tile |
| Deploy a scanner | — | Scanner inventory slot, then a mine tile |
| Set a cargo container down | — | Container inventory slot, then a mine tile |
| Set a crafted station down (Manufacturing Station / Oil Extractor) | — | Its inventory slot, then a mine tile |
| Lift an empty station or container back aboard | — | Construction Toolkit inventory slot, then press the station/crate |
| Set a decoration down | — | Decoration inventory slot, then a mine tile |
 | Open a placed cargo container — or wreck — (on it or beside it) | `C` | Press the crate or wreck on the mine |
 | Move a stack between the crate and the bay | — | Press the stack in either column |
 | Salvage a wreck (its ore and fitted upgrades) | `C` | Press the wreck, then a stack or Loot all |
| Cancel a placement | `Escape` | The armed slot again |
| Open the portal list with a teleporter aboard (picking a destination spends one teleporter) | `T` | Teleport button |
| Travel to a portal from the list | — | Press a portal row |
| Cargo, stats and guides | — | Info / Cargo button |
| Close the portal travel/teleporter list | `Space` or `Escape` | × button or the backdrop |
| Close a dialog | `Escape` | × button or the backdrop |
| Redeploy mid-run | `R`, then `R` again within 3.5 s | — |
| Restart after game over | `R` | Click/tap outside the dialogs |
| Choose where to redeploy (with two or more portals; the prompt cannot be dismissed) | — | Press a portal row |
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
- **State outside the canvas.** The bottom-left panel is an analog fuel gauge over
  plain fuel and hull readouts, each a visible `current/max` number; the other
  readouts are text, the toast and the
  fuel banner are live regions, and `#game-status` politely announces the ship's
  situation — at home base, in the mine, holds full, hull critical, ship lost. It is
  driven by thresholds, so the 60 Hz HUD sync never makes it talk.
- **Native dialogs.** The intro prompt is a `<button>`; the ship, info,
  Manufacturing Station, Oil Extractor, cargo-container/wreck and trading-post
  overlays are modal `<dialog>`s, so the browser contains Tab, makes the rest of the
  page inert, and each close returns focus to the control that opened it.
- **`prefers-reduced-motion`.** The looping start-prompt, low-fuel and HUD-alert
  animations stop; the alert colours stay.

## Gameplay notes

- You start with a full 100-unit tank, a full 100 hull, a 20-item cargo bay, and
  drill power 1, from the `STARTING` base in `src/core/balance.ts`. Those four ship
  stats are not fixed — they are *derived* from the upgrades fitted to the ship
  (see below).
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
  the backbone of the low-tier recipes.

### Home base

The ship lives in a small deterministic cavern carved into the top of the mine;
solid bedrock caps the world above it, so there is no surface and the depth meter
reads 0 m at home. Three stations are seeded on the cavern floor — the Manufacturing
Station, the Oil Extractor, and a Portal named `Home` — fly onto or beside one and
press `Space` (or click its tile) to open it. They are placed entities, not
fixed world objects, so they can be crafted, carried and set down elsewhere too
(see "Crafting & ship equipment").

- **Manufacturing Station.** Stow cargo here (its stock holds up to 500 items),
  take stacks back aboard, and craft. Crafting consumes from the station stock and
  the result lands back in the stock — take it aboard afterwards. The recipe table
  lives in `src/core/crafting.ts`:

  | Output | Inputs |
  |---|---|
  | Repair Kit | 3 Iron |
  | Dynamite | 2 Coal + 1 Iron |
  | Scanner | 2 Copper + 1 Silver |
  | Container | 6 Iron |
  | Teleporter | 3 Silver + 2 Gold |
  | Manufacturing Station | 8 Iron + 4 Copper + 2 Silver |
  | Oil Extractor | 6 Iron + 4 Copper + 2 Coal |
  | Portal | 3 Silver + 3 Gold + 2 Iron |
  | Construction Toolkit | 4 Iron + 2 Copper |
  | Fuel Tank / Cargo Hold / Drill / Hull Plating **Mk I** | 4 Iron + 2 Copper |
  | … **Mk II** | 3 Silver + 3 Gold |
  | … **Mk III** | 2 Ruby + 2 Emerald + 1 Alienite |
  | Booster | 3 Copper + 2 Coal + 1 Silver |
  | Steel Plate (decor) | 2 Iron |
  | Stone Block ×2 (decor) | 1 Coal |
  | Copper Trim (decor) | 2 Copper |
  | Lamp Panel (decor) | 1 Copper + 1 Coal |

- **Oil Extractor.** Fuel comes from coal now, not a pump. Load coal here and it
  converts on the simulation's own clock — 1 coal → 20 fuel every 180 ticks (~3 s),
  banked up to a 500-fuel store (`EXTRACTOR` in `src/core/balance.ts`). The
  conversion runs whether or not you are watching; parking on the extractor tile
  tops the tank up from the store on its own, and "Refuel ship" tops the tank up
  from the screen.

- **Portal.** The `Home` portal is the near end of the travel network. Open it to
  see the travel list of every other built portal — name, depth and distance — and
  press a row to jump the ship there for free. Rename it from the text input in the
  travel screen (up to 16 characters). It is also a respawn point: a lost ship can
  redeploy here (see "Death and redeploying"). Portals are placed entities like the
  other stations (see "Crafting & ship equipment").

### Trading posts

Deep in the mine (below `START_Y + 40`, roughly 12% of 32×32 chunks) stand
**trading posts** — kiosks in a cleared air pocket, never near the home cavern.
Like the home cavern, a post is *derived* from its coordinate rather than stored
(`tradingPostAt`/`tradingPostPocket` in `src/world/world.ts`), so it survives death,
reload and world reset; only the stock a player has bought is persisted, in
`state.tradeLedger`. Fly onto or beside one and press `Space` (or click its tile) to
open it.

- **Sell.** A post buys any ore at the ore table's own `value`, with no limit — the
  Sell column lists the ore aboard, whole-stack or one at a time, and the takings
  land in your cash.
- **Buy.** A post stocks 2–3 finished items drawn from a depth-tiered pool (repair
  kit, dynamite, scanner, container, then upgrades, the toolkit and the teleporter
  deeper), each with a small stock of 1–3. A buy price is the item recipe's
  ore-value marked up ×1.5 (`TRADING_MARKUP` in `src/core/trading.ts`), so it is
  always sane against the ore you sell to afford it. A buy is refused when the wallet
  is short, the offer is sold out, or the bay is full.

### Crafting & ship equipment

- The ship carries **2 equipment slots** (`SHIP_UPGRADE_SLOTS`). Fit and unfit
  crafted upgrades from the bay through the **Ship** button, which opens anywhere.
  The four stat upgrades come in three marks and their bonuses are additive, so two
  of the same upgrade stack; duplicates in both slots are allowed
  (`src/core/ship-upgrades.ts`):

  | Upgrade | Effect | Mk I | Mk II | Mk III |
  |---|---|---|---|---|
  | Fuel Tank | +fuel capacity | +50 | +100 | +200 |
  | Cargo Hold | +cargo capacity | +10 | +20 | +40 |
  | Drill | +drill power | +1 | +2 | +4 |
  | Hull Plating | +hull capacity | +50 | +100 | +200 |
  | Booster | enables the `Shift` sprint | — | — | — |

  The Booster is Mk I only and carries no stat: it is the gate on the `Shift`
  sprint, which does nothing until one is fitted.
- The **Repair Kit** is crafted, carried in the bay, and spent from its own slot to
  patch 25% of the hull maximum; it is refused at a full hull.
- Dynamite and scanners are crafted, carried in the cargo bay, and placed from
  their own inventory slot onto explored, cleared ground. A planted stick blows a
  2-tile radius five seconds later — long enough to get clear, and close enough to
  wreck a ship that did not.
- Teleporters ride in the bay too, and are spent rather than placed: pressing `T`
  with one aboard opens the portal list (the portals not already within reach), and
  picking a destination spends one teleporter and jumps the ship straight to that
  portal. There is no depth gate and no return trip — the charge is the fare for the
  jump, and travel between built portals is otherwise free.
- **Decorations** — Steel Plate, Copper Trim, Lamp Panel — are crafted panels set
  down as solid tiles from their inventory slot onto explored, cleared ground
  (never on a station tile). Drilling one back out returns the panel to the bay;
  a blast destroys it outright.
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
  the Oil Extractor are entities like a crate, not fixed world objects: two are
  seeded on the home-cavern floor, and more can be crafted, carried, and set down
  on explored, cleared ground from their own inventory slots. Each manufacturer
  keeps its own stock; each extractor runs its own coal→fuel conversion. Up to four
  of each may stand in the mine. The **Construction Toolkit** (`src/game/toolkit.ts`)
  is the durable counterpart: armed from its slot, a press on an *empty* station or
  container packs it back into the bay (it refuses a loaded one — empty it first —
  and refuses when the bay has no room). The toolkit is never used up.
- **Portals** (`src/core/portal.ts`, `src/game/portals.ts`) are placeable stations
  too: crafted, carried, and set down from the portal inventory slot exactly like a
  Manufacturing Station or Oil Extractor. The base is seeded with one named `Home`,
  and up to six portals may stand in the mine at once — the `Home` portal counts
  toward that cap. A portal holds no stock, so it is always "empty" and the
  Construction Toolkit can always lift it back aboard. Each carries a player-facing
  name, renameable up to 16 characters from the travel screen. Open one (press its
  tile, or `Space` alongside it) to see the travel list of every other built portal
  and jump the ship there for free; a portal is also a respawn point for a lost ship
  (see "Death and redeploying").
- **Trading posts** (`src/core/trading.ts`, `src/game/trading.ts`) stand in cleared
  air pockets deep in the mine, derived from their coordinate in `src/world/world.ts`
  rather than stored. Open one to sell ore for cash at the ore table's value, or buy
   a small, limited stock of gear; only the drawn-down stock persists, in
   `state.tradeLedger`.
- **Wrecks** (`src/core/wreck.ts`, `src/game/wrecks.ts`) are the corpse loot a lost
  run leaves behind. When a ship dies — or is scrapped by a hand `R`-reset — the ore
  it carried and the upgrades fitted to its hull do not survive the replacement, so
  the run drops them as a greyed-out wreck (`W`) on the tile the ship stood on. Fly
  back down, press the wreck from an adjacent tile — or `C` while on or beside it —
  to open a take-only salvage menu: press a stack (or its "1" button) to haul it
  aboard, or **Loot all** to take everything that fits in one press. A wreck vanishes
  the moment it is emptied; up to five stand at once, the oldest dropped past the cap.
  They survive death and reload and clear only on a full player-data reset. The
  fitted upgrades come back as unequipped bay items, ready to refit.

### Hazards and descent

- Low fuel warnings appear below 25%; head home to refuel quickly.
- The HUD reserve readout forecasts the climb home (safe/caution/urgent), the
  scanner reads the tile the drill is aimed at, and the depth readout counts
  down to the next landmark and toasts when you cross one.
- Drilling upward is blocked; use tunnels to fly back up.
- Side-drilling requires solid ground under the ship.
- Rock, magma pockets, depth, and enemies make deeper mining more dangerous:
  Tunnel Fiends first, then Skitterlings, Ironbacks, and Abyss Stalkers. They are
  drawn as rusted, haunted versions of the player's own ship.
- Enemies wake when exposed nearby; drill them before they chew through the hull.
- The mine has no bottom: the run's goal is to keep hauling richer loads home
  alive, crafting better equipment, and setting depth records.
- Progress (cash, fitted equipment, the bay, the home base, stats, explored tiles,
  the trading stock you have drawn down, the mine you dug, and where you parked) is
  saved locally; death keeps your cash, bay equipment, home base, drawn-down trading
  stock and stats, and costs you the cargo aboard, the upgrades fitted to the ship,
  and your position.
- The camera zoom is remembered too, but as a preference rather than progress:
  it is stored under `moleload:zoom-settings:v1` (`src/game/zoom-settings.ts`),
  clamped back into the 0.5x–2x range on load, and survives a death, a fresh
  world, and a player-data reset.

### Death and redeploying

A lost ship — from a destroyed hull or a hand `R`-reset — drops its wreck, rebuilds
the world, and redeploys a fresh ship. Where the replacement lands depends on how
many portals are built (`restartGame` in `src/game/run.ts`, `respawnPortals` in
`src/core/portal.ts`):

- **No portals.** The ship redeploys in the home cavern, as it always has.
- **Exactly one portal.** The ship redeploys at that portal, with no prompt.
- **Two or more portals.** A portal overlay opens in respawn mode listing every
  portal; it has no close button and ignores `Escape`/`Space`, so the run cannot
  continue until a destination is chosen. Picking one drops the wreck, rebuilds the
  world, and spawns the ship at that portal with a full tank and whole hull.

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
npm run agent:mcp        # tsx agent/mcp-server.ts, a stdio MCP server
```

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

The server owns **one game session at a time**: `game_start` errors if one is
already open, and every action tool returns the fresh observation as JSON. It logs
only to stderr (stdout is the MCP transport).

### Tools

| Tool | Arguments | What it does |
|---|---|---|
| `game_start` | `headless?` (bool, default false), `freshSave?` (bool, default false), `port?` (int, default 5180) | Start/reuse a dev server, launch Chromium, load the game, return the initial observation. |
| `game_stop` | — | Close the session (browser, and any server this session started). |
| `observe` | `radius?` (int, default 7) | Return the current observation without changing the world. |
| `start_run` | — | Start the run from the title splash (presses Enter, waits for the HUD). |
| `press` | `key` (string) | One key press, e.g. `ArrowDown`, `w`, `Space`, `e`, `t`, `c`, `Escape`. |
| `type` | `text` (string) | Type text into the focused input (e.g. after clicking `portalNameInput`), then return the observation. |
| `hold` | `key` (string), `ms` (int), `shift?` (bool) | Hold a key for `ms` wall-clock (the sim runs during the hold); `shift` sprints if a Booster is fitted. |
| `click` | `target` (string), `value?` (string), `kind?` (string) | Click one allowlisted UI control (below). |
| `press_tile` | `x` (int), `y` (int) | Press a mine tile by world coordinate (clicks its canvas centre): move/drill toward it, plant an armed device, or open a station, portal or trading post. |
| `wait` | `ms` (int) | Let the sim run for `ms` wall-clock, then return the observation. |
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
slots (`scannerSlotBtn`, `dynamiteSlotBtn`, `containerSlotBtn`, `repairKitSlotBtn`,
`manufacturerSlotBtn`, `extractorSlotBtn`, `portalSlotBtn`, `toolkitSlotBtn`, the `decor:*SlotBtn`
panels), the ship screen (`data-ship-equip`,
`data-ship-unequip`, `shipCloseBtn`), the station (`stowAllBtn`, `data-station`
with values `take`/`take-one`/`stow`/`stow-one` and a `data-station-kind`,
`data-craft`, `stationCloseBtn`), the oil extractor (`loadCoalBtn`, `refuelBtn`,
`extractorCloseBtn`), the cargo container (`data-cargo` with values
`store`/`store-one`/`take`/`take-one` and a `data-cargo-kind`, `cargoCloseBtn`), the
wreck salvage menu (`data-cargo` with values `take`/`take-one` and a `data-cargo-kind`,
`lootAllBtn`, `cargoCloseBtn`), the
trading post (`data-trade` with values `sell`/`sell-one`/`buy` and a `data-trade-kind`
— an `ore:*` kind to sell, a catalog item kind to buy — `tradeCloseBtn`), the
portal travel/teleporter/respawn screen (`data-portal` with the destination `"x,y"`
as its value, `portalNameInput`, `portalNameSaveBtn`, `portalCloseBtn`), the
info tabs (`data-info-section`, `infoCloseBtn`), and the intro (`introStartBtn`).

### The observation

Every tool returns an `AgentObservation` (`src/agent/observation.ts`) — exactly
what a sighted player sees, as JSON. The top-level shape:

- `tick`, `phase`, `activeOverlay`, `gameOver`
- `ship`: `{x, y, depthMeters, fuel, fuelMax, hull, hullMax, cargo, cargoMax, drill, boost, equipment[], atSurface}` (vitals read from the live sim, not the UI snapshot)
- `cash`, `stats`
- `bay`: the cargo bay as `{kind, label, count}` stacks (lean — no `info`); `armedPlacement`: the item armed for placement, or `null`
- `hud`: `{cash, objective, scanner, fuelReserve{status, needed, margin}, depthTarget{name, kind, remaining}, stationHint, teleport{count, usable}, alerts{fuel, hull, cargo}, announcement}` — `teleport.count` is the charges aboard and `teleport.usable` whether pressing `t` would open the portal list right now
- `view`: `{origin:{x, y}, rows:[…], legend}` — a `2·radius+1`-wide (default 15) by `~11`-tall ASCII grid centred on the ship
- `notable`: unfogged things worth attention, each `{x, y, what, detail?}` where `what` is `ore | hazard | enemy | container | wreck | scanner | dynamite | station | tradingPost`
- `overlay`: the single open screen mirrored only while it is up — `station` (bay, stock, recipes with `craftable`/`missing`), `extractor` (coal, fuel, progress, refuelAmount), `ship` (slots, fittable), `container` (ship, container), `wreck` (ship, wreck), `trade` (cash, sell offers, buy offers), `portal` (`mode` `travel`/`teleporter`/`respawn`, the `source` portal `{x, y, name}` and echoed `name` in travel mode, and `destinations:[{x, y, name, depth, distance}]`), or `info` (tab) — else `null`. Each item row inside an overlay (station stock/bay, recipes, ship slots/fittable, container, wreck, trade sell/buy) carries an `info: string[]` — the same tooltip lines a human reads on hover; a recipe's `info` also lists each input's `have/need` count. The top-level `bay` omits `info` to stay lean.
- `toasts`: the last ~10 toast lines, each `{tick, message}` (a bridge-owned ring buffer, since toasts flash and vanish between snapshots)

Fog is honoured: a tile the player has not explored is `?` and never appears in
`notable`, using the same `isTileExplored` gate the renderer paints fog with.
Station stock, extractor buffers, and container and wreck contents only appear
while that overlay is open — open it to see them.

The `view.rows` legend (`VIEW_LEGEND`):

```text
. air   # dirt   R rock   o ore   ! hazard   E enemy   D decor
M manufacturer   X oil extractor   P portal   T trading post   C container   W wreck   S scanner
* dynamite   @ ship   ? fogged
```

### Pause / real-time model

By default (`realtime = true`) the sim is **frozen between tool calls** and runs
only while an action is in flight: each `press`/`hold`/`click`/`press_tile`/
`start_run` unpauses, fires its real events, lets two animation frames settle, then
pauses again — so the window shows smooth human-speed motion during the action and
holds still in between, and every returned observation is a stable snapshot.
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
`agent/session.ts` (reachable via `click`), or a tile press (`press_tile`) — and
any new player-visible state needs to be surfaced in `buildObservation`
(`src/agent/observation.ts`), with coverage in `src/agent/` and/or
`e2e/agent.spec.ts`.

### Troubleshooting

- **Port already in use.** If something is already answering HTTP on the port, the
  session reuses it instead of starting its own; if that is not this game, pass a
  different `port` to `game_start`. If the port is held by a process that does not
  answer HTTP, the session's own Vite server (started with `strictPort`) fails to
  bind — again, choose another `port`.
- **No Chromium found.** With no `PLAYWRIGHT_CHROMIUM_PATH` and none on `PATH`,
  Playwright falls back to its pinned download, which will not launch on NixOS. Set
  `PLAYWRIGHT_CHROMIUM_PATH` to a working Chromium (or install one on `PATH`).
- **"The agent bridge did not register within 15s".** The page loaded but the game
  did not boot (a build/import error). Open the same URL in a normal browser and
  check the console.

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
| `e2e/gameplay.spec.ts` | One keypress charged exactly once and clearing exactly one tile (the fence against a doubled input/step pipeline); depth rising and fuel falling over a descent; digging below the home cavern dropping the ship into the mine, live region included; crafting a scanner at the Manufacturing Station and taking it aboard; deploying a scanner and planting dynamite on the mine; focus staying on the canvas while mining. |
| `e2e/dialogs.spec.ts` | Ship, station and info dialogs opening with focus inside the dialog; `Escape`, the × button and the backdrop each closing it and restoring focus to the trigger; Tab never escaping into the HUD behind; the info tablist's click and arrow-key navigation; the ship and info overlays handing the screen over rather than stacking. |
| `e2e/focus-visible.spec.ts` | The ring drawn for `Tab` (3px, and inset on the canvas) and gone for a click that moves focus, including the focus a clicked-shut dialog restores. |
| `e2e/failure.spec.ts` | A refused 2D context — stubbed with an init script — surfacing as the "Mine offline" notice with its detail line, its `role="alert"` and a working Reload, while the crash boundary stays out of it. |
| `e2e/agent.spec.ts` | The programmatic-play harness end to end and headless: it drives `openGameSession` itself (reusing the suite's webServer), seeds a soft dirt tile under the spawn, and checks the observation sees the ship at the home base, the default pause model freezes `tick` between decisions, `start_run` brings the player into play, `Space` opens the station overlay in the observation, and holding `ArrowDown` burns fuel, advances the tick and scrolls the ASCII view down. |

Two notes on how the suite is wired:

- **The dev server, not `vite preview`.** React only double-invokes `<StrictMode>`
  effects in a development build, so the runtime's `dispose()` is only exercised
  there. `playwright.config.ts` starts `npm run dev` on port 5199 itself.
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
root and under the `/miner/` Pages project subpath.
