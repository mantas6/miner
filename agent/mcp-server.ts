// The stdio MCP server: the LLM agent's whole interface to the game.
//
// It owns exactly one game session at a time (`agent/session.ts`), which drives a
// headed Chromium the human can watch. Every tool below is a thin wrapper over the
// session, and every action tool returns the fresh observation as JSON so the
// agent's next decision is always made against the state its last action produced.
//
// The server's `instructions` — and the per-tool descriptions — carry everything
// the agent needs to play without seeing the screen: the controls (verified
// against `src/game/input.ts`), the ASCII legend (imported from
// `src/agent/observation.ts`, not duplicated), the crafting recipes (generated
// from the `RECIPES` table so they never drift), and the play tips that explain
// the pause model and the fog-respecting observation.
//
// Discipline that keeps stdio clean: the MCP transport owns stdout, so nothing
// here ever writes to it — every log goes to stderr via `console.error`. SIGINT,
// SIGTERM and SIGHUP, stdin ending, and the transport closing all close the
// session before the process exits, so a vanished client never strands a browser.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openGameSession, type ClickTarget, type GameSession } from './session';
import { VIEW_LEGEND, type AgentObservation } from '../src/agent/observation';
import { EXTRACTOR } from '../src/core/balance';
import { RECIPES } from '../src/core/crafting';
import { itemForKind } from '../src/core/items';
import { SHIPS, SHIP_ORDER } from '../src/core/ships';
import { MAX_ZOOM, MIN_ZOOM } from '../src/game/zoom';
import { INFO_NAVIGATION_SECTIONS } from '../src/ui/info-navigation';

/** The single live session, or `null` when none is open. One at a time. */
let session: GameSession | null = null;

/**
 * A `game_start` still launching its browser. Held so a second concurrent start
 * is refused rather than racing it into two sessions, and so a shutdown mid-start
 * still closes what the start produces.
 */
let starting: Promise<GameSession> | null = null;

/** The legend, as `@=ship .=air …`, straight from the observation's own table. */
function legendText(): string {
  return Object.entries(VIEW_LEGEND).map(([glyph, name]) => `${glyph}=${name}`).join('  ');
}

/** The recipe table as text, e.g. `Dynamite ×1 ← 2 Coal, 1 Iron`, generated from data. */
function recipesText(): string {
  return RECIPES.map(recipe => {
    const output = itemForKind(recipe.output).label;
    const count = recipe.count > 1 ? ` ×${recipe.count}` : '';
    const inputs = recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ');
    return `  ${output}${count} \u2190 ${inputs}`;
  }).join('\n');
}

/** The ship ladder as text, e.g. `Hauler: 4 slots, 150 fuel … ← 24 Iron, …`, generated from data. */
function shipsText(): string {
  return SHIP_ORDER.map(id => {
    const ship = SHIPS[id];
    const {fuelMax, hullMax, cargoMax, drill} = ship.base;
    const stats = `${ship.slots} slots, ${fuelMax} fuel, ${hullMax} hull, ${cargoMax} cargo, drill ${drill}`;
    const inputs = ship.inputs.length
      ? ship.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ')
      : 'the starter';
    return `  ${ship.label} ("${id}"): ${stats} ← ${inputs}`;
  }).join('\n');
}

/** The Info tabs as `"info-objective" (Objective & Cargo), …`, straight from the tablist. */
function infoSectionsText(): string {
  return INFO_NAVIGATION_SECTIONS.map(section => `"${section.id}" (${section.label})`).join(', ');
}

/** The server-level guide the client shows before any tool call. */
function instructions(): string {
  return [
    'Drive a 2D mining game through a headed Chromium window a human can watch. You',
    'read the world from the observation JSON each tool returns; you act with real',
    'key presses, clicks on named controls, and tile presses — the same inputs a',
    'human uses. Start with `game_start`, then `start_run`, then dig.',
    '',
    'CONTROLS (keys for `press` / `hold`):',
    '  ArrowLeft/Right/Up/Down or a/d/w/s — move. Moving into terrain drills it;',
    '    moving into open space flies. Falling straight down through open air is free;',
    '    every other move burns fuel. The drill never digs upward; a side dig with open',
    '    air under the ship costs 50% more fuel (`hud.scanner` ends "Hover: +50 % fuel.").',
    '  Shift (hold with a direction, `hold key ms shift:true`) — sprint/boost. Inert',
    '    unless a Booster is fitted to the ship.',
    '  Space — open the station-like thing the ship is parked beside: a home station',
    '    (Manufacturer or Fuel Extractor), a Trading Post, a Portal, or a grave; a Portal opens',
    '    the travel list of every other built portal (`overlay.kind === "portal"`,',
    '    `mode "travel"`) — click a `data-portal` row (value "x,y") to jump there for',
    '    free. Press Space or Escape again to close it. A grave shows its stone',
    '    (`overlay.kind === "grave"`: name, born, died, cause); dismiss it with',
    '    graveOkBtn, Enter, Space or Escape.',
    '  e — arm/disarm a stick of dynamite, then `press_tile` the target to plant it.',
    '    While any placeable device is armed, `placement` lists the valid `sites`',
    '    around the ship (the green grid) and, after a press, the `target` tile and',
    '    whether it was `valid` (a refused press leaves the device armed).',
    '  t — open the portal list with a teleporter aboard (`mode "teleporter"`, the',
    '    portals out of reach); picking a destination spends one teleporter and moves',
    '    the ship there. `hud.teleport` reports how many charges are aboard and',
    '    whether pressing t would open the list right now.',
    '  c — open/close the cargo container, wreck or chest under or beside the ship,',
    '    whichever is nearest. A wreck or chest opens a take-only menu',
    '    (`overlay.kind` "wreck"/"chest"); click lootAllBtn to haul everything that',
    '    fits aboard, or the data-cargo take / take-one controls for one stack.',
    '  Construction gear is placed and lifted from inventory slots (click controls,',
    '    then a tile press): manufacturerSlotBtn / extractorSlotBtn / portalSlotBtn arm',
    '    a crafted Manufacturing Station / Fuel Extractor / Portal to set down;',
    '    toolkitSlotBtn arms the Construction Toolkit, whose press packs an empty',
    '    station, container or portal back into the bay. Placed stations show as',
    '    M / X / P in the view and notable.',
    '  Spent with one click: repairKitSlotBtn uses a Repair Kit on the hull, and',
    '    fuelCellSlotBtn uses a Fuel Cell (crafted from Uranium) to fill the tank —',
    '    refused while the tank is already full.',
    '  Naming a portal: in the travel overlay, `click` portalNameInput to focus it,',
    '    `type` the new name (max 16 chars), then `click` portalNameSaveBtn (Enter also',
    '    saves). The new name echoes back in `overlay.name` and the portal notable.',
    '  + (or =) / - — step the camera zoom in / out in 0.25 steps, between',
    `    ${MIN_ZOOM}x and ${MAX_ZOOM}x (remembered). \`view.zoom\` reports the level. The ASCII`,
    '    window does not change with it, but zooming in leaves fewer tiles on screen,',
    '    and `press_tile` refuses one that is off-screen.',
    '  Info screen: click infoBtn, then a tab with data-info-section, value one of',
    `    ${infoSectionsText()}.`,
    '    `overlay.sections` lists them; only the visible tab\'s contents are mirrored',
    '    (`overlay.objective` / `stats` / `prospecting` / `hazards` / `controls` /',
    '    `settings`). Settings: settingsMusicBtn / settingsSfxBtn (state in `audio`),',
    '    cheatsToggleBtn expands the cheat menu (`settings.cheatsOpen`), whose grants are',
    '    the valueless targets data-developer-grant-ores and data-developer-fill-extractor',
    '    (click with no value); resetGameBtn asks inline (`settings.confirmingReset`),',
    '    resetGameCancelBtn backs out, resetGameConfirmBtn wipes everything and reloads.',
    '  Ship screen: shipBtn opens it (`overlay.ship` names the hull). data-ship-equip value',
    '    an upgrade kind (e.g. "upgrade:tank:1") fits it from the bay into the first empty',
    '    open slot (swapping into slot 0 when every open slot is full). data-ship-unequip',
    '    value is the 0-based slot index — the `index` in `overlay.slots` and the position',
    '    in `ship.equipment` — and moves that slot\'s upgrade back to the bay; an empty',
    '    slot\'s button is disabled. The last slot of every hull is `locked` until any Mk II',
    '    upgrade is crafted. Fitting or',
    '    unfitting a tank or plating moves fuel/hull by the same amount as its maximum,',
    '    and is refused when that would leave less than 1.',
    '  Save export/import: click infoBtn, then data-info-section value "info-settings".',
    '    exportSaveBtn puts the save JSON in `overlay.saveExport` (and downloads it).',
    '    To import, click importSaveText, `type` the JSON, click importSaveBtn, then',
    '    importSaveConfirmBtn (importSaveCancelBtn backs out); only the current save',
    '    version is accepted. The page reloads to the title splash with the imported',
    '    run loaded; call `start_run` again.',
    '  r — reset the run (press twice within ~3.5s of sim time, 210 ticks, mid-run to',
    '    confirm; a paused sim holds the window open). With two or',
    '    more portals built, a lost or reset ship raises a portal overlay in `mode',
    '    "respawn"` that cannot be dismissed (Escape/Space are ignored) — pick a',
    '    `data-portal` row to redeploy the ship at that portal. Each row\'s',
    '    `respawnFuel` is the fuel the replacement deploys with: a full base tank of the',
    '    hull at home, half of one at a field portal.',
    '  Game over (`gameOver: true`, the ship is lost): press r to deploy a new ship at',
    '    once (no confirm), or `press_tile` any mine tile — a click anywhere outside the',
    '    dialogs restarts, like the "Tap anywhere to restart" banner says. With two or',
    '    more portals the respawn prompt above comes up instead.',
    '  Escape — cancel an armed placement, or close the ship/info/container/wreck/chest/grave overlay.',
    '  Enter — start the run from the title splash (use the `start_run` tool).',
    '  Click a tile with `press_tile` to move/drill toward it, plant an armed device,',
    '    or open a station, trading post, wreck, chest, or grave. Click named UI controls with `click`.',
    '  Keys always reach the game: `press`/`hold` hand focus back to the mine first when',
    '    no dialog is open, and inside a dialog Space/Enter drop focus off a button so',
    '    they act as the overlay keys (use `click` to press a button).',
    '  inventoryToggleBtn folds the HUD inventory list (`hud.inventoryCollapsed`); the',
    '    slot buttons are only there while it is unfolded.',
    '',
    'VIEW LEGEND (the `view.rows` ASCII grid, ~15x11 around the ship @):',
    `  ${legendText()}`,
    '  Fogged tiles you have not yet explored are ? and never appear in `notable`.',
    '  The `@` hides the ship\'s own tile; `ship.on` names it (`tile`) and anything',
    '    notable standing there (`what`/`detail`, e.g. a portal or trading post).',
    '',
    'CRAFTING RECIPES (at the Manufacturer; consume from and produce into station stock):',
    recipesText(),
    '',
    'SHIPYARD (every Manufacturer, `station.shipyard`): a one-way ladder of hulls, each with',
    '  one more fitting slot and a bigger base tank, hull, bay and drill:',
    shipsText(),
    '  Only the next hull up is buildable (`shipyard.next`: craftable, inputs, missing,',
    '  gains); click data-craft-ship with its id (e.g. "hauler"). The ore comes out of the',
    '  station stock, fitted upgrades carry over into the bigger hull, and fuel/hull are',
    '  kept, not refilled. `ship.class` / `ship.shipLabel` / `ship.slots` name the hull flown.',
    '  The hull survives a death (its slots come back empty); only a full player-data',
    '  reset returns the Scout.',
    '',
    'PLAY TIPS:',
    '  - Keep a fuel reserve: `hud.fuelReserve` tells you the fuel needed to fly to',
    '    the cheapest exit and your margin after it. `exit` names it: "Home", or a',
    '    field portal (`Portal "Deep"`) you can jump home from for free while a portal',
    '    stands in the home cavern. It prices a clear flight plus a small allowance,',
    '    not your real tunnel. Running dry underground is fatal.',
    '  - Return to the surface to refuel and craft; the Manufacturer crafts and stores.',
    '    Parking on the Fuel Extractor (X) keeps the tank topped up while you stay.',
    `    Load coal into it: each coal converts to ${EXTRACTOR.fuelPerCoal} fuel, well over what digging`,
    '    one costs. `hud.base` is the home extractor\'s stored fuel and queued coal;',
    '    `alert` means the two could no longer fill a tank — go mine coal.',
    '  - Trading Posts (T) stand deep in the mine: sell ore for cash there, and buy',
    '    a small, limited stock of gear. `hud.cash` is your wallet; the open post\'s',
    '    sell prices and buy offers are in the `trade` overlay. tradeFuelBtn fills the',
    '    tank for cash (`trade.fuel`: unitPrice, and the amount/cost a fill buys now).',
    '    Find one by its beacon: `hud.postHint` ("Trading post ≈9 tiles ↙") points at',
    '    the nearest post within 12 tiles, fog or not, and goes empty once one is in',
    '    reach. Posts seen so far are listed in Info → Prospecting',
    '    (`overlay.prospecting.posts`: x, y, depth in metres).',
    '  - Spend cash at home too: the home Manufacturer\'s Supply (`station.supply`,',
    '    click data-supply with the kind) sells repair kits, dynamite, scanners and',
    '    containers into its stock, and the home extractor\'s extractorBuyFuelBtn',
    '    orders fuel into its store (`extractor.fuelOrder`).',
    '  - A lost or reset ship leaves a wreck (W) on the tile it died on, holding the',
    '    ore and fitted upgrades that did not survive — up to 5 stand at once, oldest',
    '    dropped. Fly back, press its tile (or `c` alongside it), and salvage with',
    '    lootAllBtn or the take controls; the wreck vanishes once emptied. Each later',
    '    death or reset wears every wreck down, and it crumbles to scrap after 3',
    '    (`notable` detail "2 items, crumbles in 2 deaths"; `wreck.deathsLeft`).',
    '  - Fuel and hull are saved: a reload or an import resumes with the tank you had.',
    '  - Chests (H) lie buried throughout the mine, each in a one-tile pocket: dig to',
    '    one, press its tile (or `c` beside it), and loot ore, tools, decorations and',
    '    now and then a ship upgrade — never cash. `notable` counts what one holds',
    '    ("3 items"); a chest emptied bare is gone for good.',
    '  - Graves (+) lie in small nooks through the mine, each the stone of a miner',
    '    who never made it back. Nothing to take — Space beside one (or press its',
    '    tile) reads it; the deeper the grave, the older it is.',
    '  - Station stock, extractor buffers, container, wreck and chest contents are only in the',
    '    observation while that overlay is open (`overlay`) — open it to see them.',
    '  - Every item row inside an open overlay carries `info: string[]` — the hover',
    '    tooltip lines describing that item; a recipe\'s `info` also lists each input\'s',
    '    have/need count. The top-level `bay` stays lean and omits it.',
    '  - `runtime` reports whether the simulation is up (`status` "ready"); a failed',
    '    boot shows a notice whose failureReloadBtn reloads the page.',
    '  - Pause model: by default the sim is FROZEN between tool calls and only runs',
    '    at wall-clock speed during `hold` and `wait`. Use `set_realtime enabled:false`',
    '    to let it run continuously between calls instead.'
  ].join('\n');
}

/** Wrap an observation as MCP text content. */
function observationResult(observation: AgentObservation) {
  return {content: [{type: 'text' as const, text: JSON.stringify(observation, null, 2)}]};
}

/** A clear error result when a tool needs a session and none is open. */
function noSessionResult() {
  return {
    content: [{type: 'text' as const, text: 'No game session is open. Call game_start first.'}],
    isError: true
  };
}

/** A plain error result. */
function errorResult(text: string) {
  return {content: [{type: 'text' as const, text}], isError: true};
}

/**
 * The live session, or an error result: none open, or one whose browser has gone
 * away underneath it (closed window, crash). A dead one is dropped — and closed,
 * to release any server it started — so the next `game_start` can proceed.
 */
async function liveSession(): Promise<GameSession | ReturnType<typeof errorResult>> {
  if (!session) return noSessionResult();
  if (session.isDead()) {
    const dead = session;
    session = null;
    await dead.close().catch(error => console.error('Error while closing a dead game session:', error));
    return errorResult('The game browser closed; call game_start to open a new session.');
  }
  return session;
}

/** Run an action against the live session, or report why there is none. */
async function withSession(run: (game: GameSession) => Promise<AgentObservation>) {
  const game = await liveSession();
  if ('content' in game) return game;
  return observationResult(await run(game));
}

const server = new McpServer(
  {name: 'miner', version: '0.1.0'},
  {instructions: instructions()}
);

server.registerTool(
  'game_start',
  {
    description:
      'Open the game: start (or reuse) a dev server, launch Chromium (headed by ' +
      'default so a human can watch), load the game, and return the initial ' +
      'observation. Errors if a session is already open — call game_stop first.',
    inputSchema: {
      headless: z.boolean().optional().describe('Hide the Chromium window. Default false (visible).'),
      freshSave: z.boolean().optional().describe('Wipe the saved game before loading. Default false.'),
      port: z.number().int().positive().optional().describe('Port to serve the game on. Default 5180.')
    }
  },
  async ({headless, freshSave, port}) => {
    if (starting) return errorResult('A game session is already starting. Wait for it, then use it or call game_stop.');
    if (session?.isDead()) await liveSession(); // drop the dead one, then start afresh
    if (session) return errorResult('A game session is already open. Call game_stop before starting another.');
    starting = openGameSession({headless: headless ?? false, freshSave: freshSave ?? false, port});
    try {
      session = await starting;
    } finally {
      starting = null;
    }
    return observationResult(await session.observe());
  }
);

server.registerTool(
  'game_stop',
  {description: 'Close the game session (shuts the browser and any server this session started).'},
  async () => {
    if (!session) return noSessionResult();
    const closing = session;
    try {
      await closing.close();
    } finally {
      // Cleared even when the close throws, so the next game_start is never blocked.
      session = null;
    }
    return {content: [{type: 'text' as const, text: 'Session closed.'}]};
  }
);

server.registerTool(
  'observe',
  {
    description: 'Return the current observation without changing the world.',
    inputSchema: {radius: z.number().int().positive().max(40).optional().describe('Horizontal view radius; 2·r+1 tiles across. Default 7, max 40.')}
  },
  ({radius}) => withSession(game => game.observe(radius))
);

server.registerTool(
  'start_run',
  {description: 'Start the run from the title splash (presses Enter, waits for the HUD).'},
  () => withSession(game => game.startRun())
);

server.registerTool(
  'press',
  {
    description: 'Press one key once. See the controls in the server instructions for key names (e.g. ArrowDown, w, Space, e, t, c, +, -, Escape).',
    inputSchema: {key: z.string().describe('The key to press, e.g. "ArrowDown", "w", "Space", "e".')}
  },
  ({key}) => withSession(game => game.press(key))
);

server.registerTool(
  'type',
  {
    description: 'Type text into the focused input, e.g. after clicking portalNameInput or importSaveText.',
    inputSchema: {text: z.string().describe('The text to type into the focused input.')}
  },
  ({text}) => withSession(game => game.type(text))
);

server.registerTool(
  'hold',
  {
    description: 'Hold a key for `ms` of wall-clock time (the sim runs during the hold). Set `shift` to sprint/boost (needs a Booster fitted).',
    inputSchema: {
      key: z.string().describe('The key to hold, e.g. "ArrowDown" or "d".'),
      ms: z.number().int().nonnegative().max(60000).describe('How long to hold the key, in milliseconds (max 60000).'),
      shift: z.boolean().optional().describe('Hold Shift too, for a sprint. Default false.')
    }
  },
  ({key, ms, shift}) => withSession(game => game.hold(key, ms, {shift}))
);

server.registerTool(
  'click',
  {
    description:
      'Click one allowlisted UI control. Use `target` for an id (e.g. "shipBtn", ' +
      '"stationCloseBtn") or an attribute name (e.g. "data-craft"); pass `value` for ' +
      'attribute controls (e.g. target "data-craft", value "upgrade:drill:1"; at the home ' +
      'Manufacturer target "data-supply", value e.g. "repairKit", buys a Supply item for ' +
      'cash into the station stock); the ' +
      'transfer controls also need `kind` — the station (target "data-station", value ' +
      '"take"|"take-one"|"stow"|"stow-one", kind e.g. "ore:Coal"), the cargo container ' +
      '(target "data-cargo", value "store"|"store-one"|"take"|"take-one", kind e.g. "ore:Iron"; ' +
      'a wreck or chest menu takes only "take"|"take-one", and lootAllBtn hauls it all), ' +
      'and the trading post (target "data-trade", value "sell"|"sell-one"|"buy", kind e.g. ' +
      '"ore:Iron" to sell or "repairKit" to buy; tradeFuelBtn fills the tank for cash). ' +
      'extractorBuyFuelBtn orders fuel for cash into the home Fuel Extractor. A portal travel/respawn row is target ' +
      '"data-portal", value the destination "x,y" (e.g. "48,20"). An info tab is target ' +
      '"data-info-section", value e.g. "info-settings". data-craft-ship builds the next hull ' +
      'at a Manufacturer (value its id, e.g. "hauler"). data-ship-unequip takes the ' +
      '0-based fitting-slot index (e.g. "0"). Inventory slot buttons such as ' +
      'repairKitSlotBtn and fuelCellSlotBtn spend one item per click. The cheat grants data-developer-grant-ores ' +
      'and data-developer-fill-extractor take no value. A click that reloads the page ' +
      '(importSaveConfirmBtn, resetGameConfirmBtn) returns once the game is back. ' +
      'A wrong target is refused with the full allowed list.',
    inputSchema: {
      target: z.string().describe('The control id or attribute name.'),
      value: z.string().optional().describe('The attribute value (for data-station/data-cargo it is the transfer action).'),
      kind: z.string().optional().describe('The stack kind, for the transfer controls (data-station-kind / data-cargo-kind).')
    }
  },
  ({target, value, kind}) => withSession(game => {
    const clickTarget: ClickTarget = value === undefined && kind === undefined ? target : {target, value, kind};
    return game.click(clickTarget);
  })
);

server.registerTool(
  'press_tile',
  {
    description: 'Press a mine tile by world coordinate (clicks its centre on the canvas). Moves/drills toward it, plants an armed device, or opens a station, trading post, wreck, chest or grave beside the ship.',
    inputSchema: {
      x: z.number().int().describe('Tile world x-coordinate.'),
      y: z.number().int().describe('Tile world y-coordinate.')
    }
  },
  ({x, y}) => withSession(game => game.pressTile(x, y))
);

server.registerTool(
  'wait',
  {
    description: 'Let the sim run for `ms` of wall-clock time, then return the observation.',
    inputSchema: {ms: z.number().int().nonnegative().max(60000).describe('How long to let the sim run, in milliseconds (max 60000).')}
  },
  ({ms}) => withSession(game => game.wait(ms))
);

server.registerTool(
  'screenshot',
  {description: 'Return a PNG screenshot of the game window as image content.'},
  async () => {
    const game = await liveSession();
    if ('content' in game) return game;
    const png = await game.screenshot();
    return {content: [{type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png'}]};
  }
);

server.registerTool(
  'set_realtime',
  {
    description:
      'Switch the pause model. enabled=true (default): the sim is frozen between ' +
      'tool calls and runs only during hold/wait. enabled=false: the sim runs ' +
      'continuously between calls too. Returns the observation.',
    inputSchema: {enabled: z.boolean().describe('true to freeze between calls (default model); false to run continuously.')}
  },
  ({enabled}) => withSession(game => game.setRealtime(enabled))
);

/**
 * Close the session, if any — including one a `game_start` is still launching —
 * swallowing errors, since we are on the way out.
 */
async function shutdown(): Promise<void> {
  const pending = starting;
  try {
    await session?.close();
  } catch (error) {
    console.error('Error while closing the game session on shutdown:', error);
  } finally {
    session = null;
  }
  if (pending) {
    try {
      await (await pending).close();
    } catch (error) {
      console.error('Error while closing a starting game session on shutdown:', error);
    }
  }
}

/** Shut down once, whichever of the exit triggers fires first, then exit. */
let exiting = false;
function exitAfterShutdown(reason: string): void {
  if (exiting) return;
  exiting = true;
  console.error(`${reason}; closing the game session.`);
  void shutdown().then(() => process.exit(0));
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => exitAfterShutdown(`Received ${signal}`));
}
// The client going away closes our stdin; without these the browser would outlive it.
process.stdin.on('end', () => exitAfterShutdown('stdin ended'));
process.stdin.on('close', () => exitAfterShutdown('stdin closed'));

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  // Set before `connect`, which chains its own handler after this one.
  transport.onclose = () => exitAfterShutdown('MCP transport closed');
  await server.connect(transport);
  console.error('miner MCP server ready on stdio.');
}

main().catch(error => {
  console.error('Fatal error starting the miner MCP server:', error);
  process.exit(1);
});
