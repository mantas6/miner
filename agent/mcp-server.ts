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
// here ever writes to it — every log goes to stderr via `console.error`. SIGINT
// and SIGTERM close the session before the process exits.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openGameSession, type ClickTarget, type GameSession } from './session';
import { VIEW_LEGEND, type AgentObservation } from '../src/agent/observation';
import { RECIPES } from '../src/core/crafting';
import { itemForKind } from '../src/core/items';

/** The single live session, or `null` when none is open. One at a time. */
let session: GameSession | null = null;

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
    '    every other move burns fuel.',
    '  Shift (hold with a direction, `hold key ms shift:true`) — sprint/boost. Inert',
    '    unless a Booster is fitted to the ship.',
    '  Space — open the home station (Manufacturer or Oil Extractor) the ship is',
    '    parked beside; press Space or Escape again to close it.',
    '  e — arm/disarm a stick of dynamite, then `press_tile` the target to plant it.',
    '  t — use a teleporter (returns you to the surface, or back down).',
    '  c — open/close the cargo container under or beside the ship.',
    '  r — reset the run (press twice within ~3.5s mid-run to confirm).',
    '  Escape — cancel an armed placement, or close the ship/info/container overlay.',
    '  Enter — start the run from the title splash (use the `start_run` tool).',
    '  Click a tile with `press_tile` to move/drill toward it, plant an armed device,',
    '    or open a station. Click named UI controls with `click`.',
    '',
    'VIEW LEGEND (the `view.rows` ASCII grid, ~15x11 around the ship @):',
    `  ${legendText()}`,
    '  Fogged tiles you have not yet explored are ? and never appear in `notable`.',
    '',
    'CRAFTING RECIPES (at the Manufacturer; consume from and produce into station stock):',
    recipesText(),
    '',
    'PLAY TIPS:',
    '  - Keep a fuel reserve: `hud.fuelReserve` tells you the fuel needed to climb',
    '    back to the surface and your current margin. Running dry underground is fatal.',
    '  - Return to the surface to sell ore and refuel; the Oil Extractor refuels the',
    '    ship, the Manufacturer crafts and stores.',
    '  - Station stock, extractor buffers and container contents are only in the',
    '    observation while that overlay is open (`overlay`) — open it to see them.',
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

/** Run an action against the live session, or report that none is open. */
async function withSession(run: (game: GameSession) => Promise<AgentObservation>) {
  if (!session) return noSessionResult();
  return observationResult(await run(session));
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
    if (session) {
      return {
        content: [{type: 'text' as const, text: 'A game session is already open. Call game_stop before starting another.'}],
        isError: true
      };
    }
    session = await openGameSession({headless: headless ?? false, freshSave: freshSave ?? false, port});
    return observationResult(await session.observe());
  }
);

server.registerTool(
  'game_stop',
  {description: 'Close the game session (shuts the browser and any server this session started).'},
  async () => {
    if (!session) return noSessionResult();
    await session.close();
    session = null;
    return {content: [{type: 'text' as const, text: 'Session closed.'}]};
  }
);

server.registerTool(
  'observe',
  {
    description: 'Return the current observation without changing the world.',
    inputSchema: {radius: z.number().int().positive().optional().describe('Horizontal view radius; 2·r+1 tiles across. Default 7.')}
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
    description: 'Press one key once. See the controls in the server instructions for key names (e.g. ArrowDown, w, Space, e, t, c, Escape).',
    inputSchema: {key: z.string().describe('The key to press, e.g. "ArrowDown", "w", "Space", "e".')}
  },
  ({key}) => withSession(game => game.press(key))
);

server.registerTool(
  'hold',
  {
    description: 'Hold a key for `ms` of wall-clock time (the sim runs during the hold). Set `shift` to sprint/boost (needs a Booster fitted).',
    inputSchema: {
      key: z.string().describe('The key to hold, e.g. "ArrowDown" or "d".'),
      ms: z.number().int().nonnegative().describe('How long to hold the key, in milliseconds.'),
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
      'attribute controls (e.g. target "data-craft", value "drill"); the cargo ' +
      'control also needs `kind` (target "data-cargo", value "take", kind "ore:Iron"). ' +
      'A wrong target is refused with the full allowed list.',
    inputSchema: {
      target: z.string().describe('The control id or attribute name.'),
      value: z.string().optional().describe('The attribute value, for attribute controls.'),
      kind: z.string().optional().describe('The second attribute value, only for data-cargo (data-cargo-kind).')
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
    description: 'Press a mine tile by world coordinate (clicks its centre on the canvas). Moves/drills toward it, plants an armed device, or opens a station.',
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
    inputSchema: {ms: z.number().int().nonnegative().describe('How long to let the sim run, in milliseconds.')}
  },
  ({ms}) => withSession(game => game.wait(ms))
);

server.registerTool(
  'screenshot',
  {description: 'Return a PNG screenshot of the game window as image content.'},
  async () => {
    if (!session) return noSessionResult();
    const png = await session.screenshot();
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

/** Close the session, if any, swallowing errors — we are on the way out. */
async function shutdown(): Promise<void> {
  try {
    await session?.close();
  } catch (error) {
    console.error('Error while closing the game session on shutdown:', error);
  } finally {
    session = null;
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.error(`Received ${signal}; closing the game session.`);
    void shutdown().then(() => process.exit(0));
  });
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('miner MCP server ready on stdio.');
}

main().catch(error => {
  console.error('Fatal error starting the miner MCP server:', error);
  process.exit(1);
});
