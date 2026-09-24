// The programmatic-play harness: one headed Chromium driving the game the way a
// human does, plus a back channel into the running simulation for pausing and
// reading the observation.
//
// It reaches the game exactly the way the e2e suite does (`e2e/support/game.ts`):
// no `window.__*` globals, only real trusted key/mouse events on the documented
// element ids, and — for the observation and the pause flag — a dynamic
// `import('/src/agent/bridge.ts')` served by the Vite dev server. That import is
// the same module `src/game/game.ts` registered its runtime into, so the call
// lands on the live game and nothing test-only is bolted onto production code.
//
// The pause/real-time model is the one decision that shapes everything else:
//
//   realtime = true  (default)  The sim is frozen between decisions and only runs
//                               while an action is in flight. Each action unpauses,
//                               fires its real events, lets two animation frames
//                               settle, then pauses again — so the headed window
//                               shows smooth human-speed motion during the action
//                               and holds still in between, and every returned
//                               observation is a stable snapshot.
//   realtime = false            The sim is never paused; it keeps running at
//                               wall-clock speed between decisions too. Actions
//                               still fire their events and settle two frames, but
//                               the world the next observation describes has moved
//                               on by however long the agent took to think.
//
// Everything here is pure Node: no React, no test runner. The MCP server
// (`agent/mcp-server.ts`) is the only intended caller besides `e2e/agent.spec.ts`.

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolveChromiumExecutable } from './chromium';
import type { AgentObservation } from '../src/agent/observation';

/** The default port the session serves the game on when none is given. */
export const DEFAULT_PORT = 5180;

/** Held in a variable so it is treated as a runtime URL, not a module to resolve. */
const BRIDGE_SPECIFIER = '/src/agent/bridge.ts';

/** The shape of the bridge singleton as seen from inside `page.evaluate`. */
interface BridgeModule {
  agentBridge: {
    observe(radius?: number): AgentObservation | null;
    setPaused(paused: boolean): void;
    isPaused(): boolean;
    screenPointForTile(x: number, y: number): {x: number; y: number} | null;
  };
}

export interface OpenGameSessionOptions {
  /** Show the Chromium window (the human's live view). Defaults to `true`. */
  headless?: boolean;
  /** Port to serve the game on; an existing server there is reused. */
  port?: number;
  /** Wipe the persisted save before the page loads, for a clean run. */
  freshSave?: boolean;
  /**
   * A script run in the page before any app code — after the `freshSave` wipe when
   * both are given. It runs in the browser, so it must be self-contained (no
   * closure over Node values); tests use it to seed a `localStorage` save.
   */
  initScript?: () => void;
}

/**
 * A control the harness is allowed to click. Two forms:
 *
 *   string  `'shipBtn'` (an id, with or without a leading `#`), or an attribute
 *           control in `name=value` form — `'data-craft=upgrade:drill:1'`. The
 *           two-attribute transfer controls take both values joined by a comma:
 *           `'data-cargo=take,ore:Iron'`, `'data-station=stow-one,ore:Coal'`.
 *   object  `{target, value?, kind?}`: `target` names the allowlisted control,
 *           `value` supplies the attribute value it needs, and `kind` is the
 *           second value used only by the transfer controls (`data-cargo-kind`
 *           and `data-station-kind`).
 */
export type ClickTarget = string | {target: string; value?: string; kind?: string};

export interface HoldOptions {
  /** Hold Shift for the duration (sprint), if a Booster is fitted. */
  shift?: boolean;
}

export interface GameSession {
  /** Splash → live run: presses Enter on the title card and waits for the HUD. */
  startRun(): Promise<AgentObservation>;
  /** One trusted key press on the focused canvas. */
  press(key: string): Promise<AgentObservation>;
  /** Type text into the focused input (e.g. after clicking `portalNameInput`). */
  type(text: string): Promise<AgentObservation>;
  /** Hold a key for `ms` of wall-clock time, optionally with Shift for sprint. */
  hold(key: string, ms: number, options?: HoldOptions): Promise<AgentObservation>;
  /** Click one allowlisted control; rejects anything else with the allowed list. */
  click(target: ClickTarget): Promise<AgentObservation>;
  /** Press a mine tile by world coordinate (canvas click at its centre). */
  pressTile(x: number, y: number): Promise<AgentObservation>;
  /** Let the sim run for `ms` of wall-clock time, then read it back. */
  wait(ms: number): Promise<AgentObservation>;
  /** The current observation, without touching the sim. */
  observe(radius?: number): Promise<AgentObservation>;
  /** A PNG screenshot of the window as a Buffer. */
  screenshot(): Promise<Buffer>;
  /** Switch the pause/real-time model; see the module notes. Returns the readback. */
  setRealtime(realtime: boolean): Promise<AgentObservation>;
  /** Whether the sim runs between decisions (`false`) or is frozen (`true`). */
  isRealtime(): boolean;
  /** The URL the game is served from. */
  readonly url: string;
  /** The Playwright page, for callers that need it (the e2e spec asserts on it). */
  readonly page: Page;
  /** Shut the browser and, if this session started it, the Vite server. */
  close(): Promise<void>;
}

/** Ids clickable on their own, with no attribute value. Ids with a `:` and all. */
const ID_TARGETS: ReadonlySet<string> = new Set([
  // HUD / action bar.
  'shipBtn', 'teleporterBtn', 'infoBtn', 'musicBtn', 'sfxBtn', 'inventoryToggleBtn',
  // Inventory slots.
  'scannerSlotBtn', 'dynamiteSlotBtn', 'containerSlotBtn', 'repairKitSlotBtn',
  'manufacturerSlotBtn', 'extractorSlotBtn', 'toolkitSlotBtn',
  'decor:steelPlateSlotBtn', 'decor:stoneBlockSlotBtn', 'decor:copperTrimSlotBtn', 'decor:lampPanelSlotBtn',
  'decor:leninPortraitSlotBtn',
  // Ship screen.
  'shipCloseBtn',
  // Station screen.
  'stowAllBtn', 'stationCloseBtn',
  // Fuel extractor screen.
  'loadCoalBtn', 'refuelBtn', 'extractorCloseBtn',
  // Cargo container screen.
  'cargoCloseBtn',
  // Wreck salvage screen.
  'lootAllBtn',
  // Trading-post screen.
  'tradeCloseBtn',
  // Portal screen.
  'portalSlotBtn', 'portalCloseBtn', 'portalNameInput', 'portalNameSaveBtn',
  // Info / cargo screen.
  'infoCloseBtn',
  // Intro.
  'introStartBtn'
]);

/** Attribute controls, each needing a value (some need a value and a kind). */
const ATTR_TARGETS: ReadonlySet<string> = new Set([
  'data-ship-equip', 'data-ship-unequip', 'data-craft', 'data-info-section', 'data-cargo', 'data-station', 'data-trade', 'data-portal'
]);

/**
 * The transfer controls that carry two attributes: an action `value` and a stack
 * `kind`. `data-cargo` → `data-cargo-action`/`data-cargo-kind`, `data-station` →
 * `data-station`/`data-station-kind`. Their `value,kind` string form joins the two
 * with a comma.
 */
const KIND_TARGETS: ReadonlySet<string> = new Set(['data-cargo', 'data-station', 'data-trade']);

/** The two attribute names a two-value transfer control resolves to. */
function kindTargetAttrs(name: string): {action: string; kind: string} {
  // `data-cargo` addresses its action through `data-cargo-action`; `data-station`
  // and `data-trade` through their bare attribute. All three name the kind with `-kind`.
  return {action: name === 'data-cargo' ? 'data-cargo-action' : name, kind: `${name}-kind`};
}

/** A human-readable roster of everything `click` accepts, for the refusal message. */
function allowedTargetsDescription(): string {
  return [
    `ids: ${[...ID_TARGETS].join(' ')}`,
    `attributes (need a value): ${[...ATTR_TARGETS].filter(a => !KIND_TARGETS.has(a)).join(' ')}`,
    'transfers (need value=action and kind): data-cargo (e.g. data-cargo=take,ore:Iron), data-station (e.g. data-station=stow-one,ore:Coal), data-trade (e.g. data-trade=sell,ore:Iron or data-trade=buy,repairKit)'
  ].join('; ');
}

function parseTarget(target: ClickTarget): {target: string; value?: string; kind?: string} {
  if (typeof target !== 'string') return target;
  const eq = target.indexOf('=');
  if (eq === -1) return {target: target.startsWith('#') ? target.slice(1) : target};
  const name = target.slice(0, eq);
  const rest = target.slice(eq + 1);
  if (KIND_TARGETS.has(name)) {
    const comma = rest.indexOf(',');
    if (comma === -1) return {target: name, value: rest};
    return {target: name, value: rest.slice(0, comma), kind: rest.slice(comma + 1)};
  }
  return {target: name, value: rest};
}

/** Turn a click target into a CSS selector, or throw with the allowed roster. */
function selectorForTarget(target: ClickTarget): string {
  const {target: name, value, kind} = parseTarget(target);
  if (ID_TARGETS.has(name)) {
    if (value !== undefined) throw new Error(`Control "${name}" takes no value.`);
    // Ids that carry a `:` (the decor slots) are illegal in a `#id` selector, so
    // address them by the attribute form instead.
    return name.includes(':') ? `[id="${name}"]` : `#${name}`;
  }
  if (ATTR_TARGETS.has(name)) {
    if (KIND_TARGETS.has(name)) {
      if (!value || !kind) throw new Error(`Control "${name}" needs both a value (action) and a kind.`);
      const attrs = kindTargetAttrs(name);
      return `[${attrs.action}="${value}"][${attrs.kind}="${kind}"]`;
    }
    if (value === undefined) throw new Error(`Control "${name}" needs a value.`);
    return `[${name}="${value}"]`;
  }
  throw new Error(`"${name}" is not a clickable control. Allowed — ${allowedTargetsDescription()}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/** Whether a dev server is already answering on this port; if so, we reuse it. */
async function serverIsListening(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(1000)});
    // Any HTTP answer means something is serving here; only a refused connection
    // (which throws) means the port is free.
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Open a session: ensure a dev server on `port` (reusing one already there),
 * launch Chromium (headed by default), load the game, and freeze the sim if the
 * default real-time model is in force.
 */
export async function openGameSession(options: OpenGameSessionOptions = {}): Promise<GameSession> {
  const {headless = false, port = DEFAULT_PORT, freshSave = false, initScript} = options;
  const url = `http://127.0.0.1:${port}/`;

  // Reuse a server already on the port (a running dev server, or the Playwright
  // suite's own webServer); otherwise start our own and own its shutdown.
  let ownedServer: ViteDevServer | null = null;
  let baseUrl = url;
  if (await serverIsListening(url)) {
    baseUrl = url;
  } else {
    ownedServer = await createServer({
      server: {host: '127.0.0.1', port, strictPort: true},
      logLevel: 'error'
    });
    await ownedServer.listen();
    baseUrl = ownedServer.resolvedUrls?.local?.[0] ?? url;
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({headless, executablePath: resolveChromiumExecutable()});
    context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await context.newPage();
    if (freshSave) {
      // The save lives in `localStorage` (`src/persistence.ts`); clearing before
      // any app script runs guarantees the game boots with pristine defaults.
      await page.addInitScript(() => localStorage.clear());
    }
    if (initScript) await page.addInitScript(initScript);
    await page.goto(baseUrl);
    await waitForBridge(page);

    let realtime = true;
    await setPaused(page, true);

    // Unpause (if realtime), run the action, settle two frames, pause again, then
    // read back the fresh observation — the whole action contract in one place.
    async function act(run: () => Promise<void>): Promise<AgentObservation> {
      if (realtime) await setPaused(page, false);
      await run();
      await settleFrames(page);
      if (realtime) await setPaused(page, true);
      return readObservation(page);
    }

    const bindings = {browser, context, ownedServer};
    return {
      url: baseUrl,
      page,
      isRealtime: () => realtime,
      startRun: () => act(async () => {
        // Enter starts the run from the splash wherever focus is (the intro's own
        // capture-phase handler); wait until the HUD is up and the mine has focus.
        await page.keyboard.press('Enter');
        await page.locator('#hud').waitFor({state: 'visible'});
        await page.locator('#intro').waitFor({state: 'detached'});
      }),
      press: key => act(() => page.keyboard.press(key)),
      type: text => act(() => page.keyboard.type(text)),
      hold: (key, ms, holdOptions) => act(async () => {
        if (holdOptions?.shift) await page.keyboard.down('Shift');
        await page.keyboard.down(key);
        await sleep(ms);
        await page.keyboard.up(key);
        if (holdOptions?.shift) await page.keyboard.up('Shift');
      }),
      click: target => {
        const selector = selectorForTarget(target);
        return act(() => page.click(selector));
      },
      pressTile: (x, y) => act(async () => {
        const point = await screenPointForTile(page, x, y);
        if (!point) throw new Error(`Tile (${x}, ${y}) is off-screen; no canvas point to press.`);
        await page.mouse.click(point.x, point.y);
      }),
      wait: async ms => {
        // A wait always lets the sim run for `ms`, whatever the model; only the
        // between-decisions state differs, so re-pause afterwards under realtime.
        await setPaused(page, false);
        await sleep(ms);
        if (realtime) await setPaused(page, true);
        return readObservation(page);
      },
      observe: radius => readObservation(page, radius),
      screenshot: () => page.screenshot(),
      setRealtime: async value => {
        realtime = value;
        // Match the sim to the new model at once: frozen between decisions when
        // realtime, free-running otherwise.
        await setPaused(page, value);
        return readObservation(page);
      },
      close: () => closeSession(bindings)
    };
  } catch (error) {
    await context?.close();
    await browser?.close();
    await ownedServer?.close();
    throw error;
  }
}

interface SessionBindings {
  browser: Browser;
  context: BrowserContext;
  ownedServer: ViteDevServer | null;
}

async function closeSession({browser, context, ownedServer}: SessionBindings): Promise<void> {
  await context.close();
  await browser.close();
  // Only shut the server this session started; a reused one belongs to someone else.
  await ownedServer?.close();
}

/** Poll until the game has booted and registered its runtime with the bridge. */
async function waitForBridge(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const ready = await page.evaluate(async spec => {
      try {
        const module = (await import(spec)) as BridgeModule;
        return module.agentBridge.observe() !== null;
      } catch {
        return false;
      }
    }, BRIDGE_SPECIFIER);
    if (ready) return;
    await sleep(100);
  }
  throw new Error('The agent bridge did not register within 15s; is the game booting?');
}

async function setPaused(page: Page, paused: boolean): Promise<void> {
  await page.evaluate(async ({spec, value}) => {
    const module = (await import(spec)) as BridgeModule;
    module.agentBridge.setPaused(value);
  }, {spec: BRIDGE_SPECIFIER, value: paused});
}

async function settleFrames(page: Page, frames = 2): Promise<void> {
  await page.evaluate(async count => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }, frames);
}

async function readObservation(page: Page, radius?: number): Promise<AgentObservation> {
  const observation = await page.evaluate(async ({spec, r}) => {
    const module = (await import(spec)) as BridgeModule;
    return module.agentBridge.observe(r);
  }, {spec: BRIDGE_SPECIFIER, r: radius});
  if (!observation) throw new Error('No live game to observe; has the session been started?');
  return observation;
}

async function screenPointForTile(page: Page, x: number, y: number): Promise<{x: number; y: number} | null> {
  return page.evaluate(async ({spec, tx, ty}) => {
    const module = (await import(spec)) as BridgeModule;
    return module.agentBridge.screenPointForTile(tx, ty);
  }, {spec: BRIDGE_SPECIFIER, tx: x, ty: y});
}
