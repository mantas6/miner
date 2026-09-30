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
//                               fires its real events, settles until the sim has
//                               ticked past them (`settle`), then pauses again — so
//                               the headed window shows smooth human-speed motion
//                               during the action and holds still in between, and
//                               every returned observation is a stable snapshot
//                               that already shows what the action did.
//   realtime = false            The sim is never paused; it keeps running at
//                               wall-clock speed between decisions too. Actions
//                               still fire their events and settle the same way,
//                               but the world the next observation describes has
//                               moved on by however long the agent took to think.
//
// Everything here is pure Node: no React, no test runner. The MCP server
// (`agent/mcp-server.ts`) is the only intended caller besides `e2e/agent.spec.ts`.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Download, type Page, type Request } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolveChromiumExecutable } from './chromium';
import type { AgentObservation, ObservationDetail } from '../src/agent/observation';
import { FIXED_STEP_MS } from '../src/core/fixed-step';
import {
  allowedTargetsDescription,
  ATTR_TARGETS,
  FLAG_ATTR_TARGETS,
  ID_TARGETS,
  KIND_TARGETS,
  kindTargetAttrs
} from './targets';

/** The default port the session serves the game on when none is given. */
export const DEFAULT_PORT = 5180;

/** Held in a variable so it is treated as a runtime URL, not a module to resolve. */
const BRIDGE_SPECIFIER = '/src/agent/bridge.ts';

/** The repo root, from this file's own location, so the server works from any cwd. */
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** How long a `click` may wait on Playwright's own actionability checks. */
const CLICK_TIMEOUT_MS = 2000;

/** Cap on the page errors kept for the bridge-timeout diagnosis. */
const PAGE_ERROR_CAP = 10;

/**
 * Sim ticks an action waits to see run after its input lands, before it pauses
 * again and reads back. Two, because the first frame after an unpause only
 * re-anchors the fixed-step clock: settling on a frame count alone could re-pause
 * before a single tick had run, leaving a press's impulse queued and unseen.
 */
const SETTLE_TICKS = 2;

/** The most frames a settle waits for those ticks before giving up (a stalled or hidden page). */
const SETTLE_FRAME_CAP = 60;

/** How long an Export click waits for its file download to start. */
const DOWNLOAD_TIMEOUT_MS = 5000;

/** The shape of the bridge singleton as seen from inside `page.evaluate`. */
interface BridgeModule {
  agentBridge: {
    observe(radius?: number, detail?: ObservationDetail): AgentObservation | null;
    setPaused(paused: boolean): void;
    isPaused(): boolean;
    tick(): number | null;
    screenPointForTile(x: number, y: number): {x: number; y: number} | null;
    tilePressRefusal(x: number, y: number): string | null;
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
   * both are given: a function, or its source text. It runs in the browser, so a
   * function must be self-contained (no closure over Node values); text can carry
   * values computed in Node baked in. Tests use it to seed a `localStorage` save.
   * Like any init script it reruns on every navigation, reloads included, so a
   * seed that must not clobber an imported save has to guard itself.
   */
  initScript?: (() => void) | string;
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
 *
 * A valueless attribute control (the cheat menu's `data-developer-grant-ores` and
 * `data-developer-fill-extractor`) is named bare, with no `=value`.
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
  /**
   * Hold a key for `ms` of sim time after its first step (`holdForSimTime`),
   * optionally with Shift for sprint: a held direction steps once at once, then
   * once per repeat interval due within `ms`.
   */
  hold(key: string, ms: number, options?: HoldOptions): Promise<AgentObservation>;
  /** Click one allowlisted control; rejects anything else with the allowed list. */
  click(target: ClickTarget): Promise<AgentObservation>;
  /**
   * Press a mine tile by world coordinate (canvas click at its centre). Refused up
   * front, with the reason, when the press could do nothing: unarmed and out of
   * reach of the ship (`tilePressRefusal`), off-screen, or under the HUD/a dialog.
   */
  pressTile(x: number, y: number): Promise<AgentObservation>;
  /** Let the sim run for `ms` of wall-clock time, then read it back. */
  wait(ms: number): Promise<AgentObservation>;
  /**
   * The current observation, without touching the sim. `detail` asks for what is
   * left out by default (`'recipes'`: an open station's whole recipe list).
   */
  observe(radius?: number, detail?: ObservationDetail): Promise<AgentObservation>;
  /** A PNG screenshot of the window as a Buffer. */
  screenshot(): Promise<Buffer>;
  /** Switch the pause/real-time model; see the module notes. Returns the readback. */
  setRealtime(realtime: boolean): Promise<AgentObservation>;
  /** Whether the sim runs between decisions (`false`) or is frozen (`true`). */
  isRealtime(): boolean;
  /**
   * Whether the session can no longer act: the browser disconnected, the page
   * closed, or `close()` ran. Every action on a dead session rejects at once.
   */
  isDead(): boolean;
  /** The URL the game is served from. */
  readonly url: string;
  /** The Playwright page, for callers that need it (the e2e spec asserts on it). */
  readonly page: Page;
  /** Shut the browser and, if this session started it, the Vite server. */
  close(): Promise<void>;
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
  if (FLAG_ATTR_TARGETS.has(name)) {
    if (value !== undefined) throw new Error(`Control "${name}" takes no value.`);
    return `[${name}]`;
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

/**
 * Run `body`, then `cleanup` whatever happens — a `try/finally` whose cleanup
 * failure surfaces only when the body succeeded, so it never masks the body's
 * own error.
 */
async function withCleanup(body: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
  await cleanup();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * What is answering on this port: this game's dev server (reuse it), something
 * else (refuse — we cannot drive it, and our own server could not bind), or
 * nothing at all (start our own). The probe asks for the bridge module itself,
 * which only this project's dev server serves.
 */
async function probeServer(url: string): Promise<'game' | 'other' | 'free'> {
  try {
    const response = await fetch(new URL(BRIDGE_SPECIFIER, url), {signal: AbortSignal.timeout(5000)});
    if (!response.ok) return 'other';
    return (await response.text()).includes('agentBridge') ? 'game' : 'other';
  } catch (error) {
    // A refused connection means the port is free; a hung one is still taken.
    return error instanceof Error && error.name === 'TimeoutError' ? 'other' : 'free';
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

  // Reuse this game's dev server if one is already on the port (a running
  // `npm run dev`, or the Playwright suite's own webServer); refuse a port some
  // other server holds; otherwise start our own and own its shutdown.
  let ownedServer: ViteDevServer | null = null;
  let baseUrl = url;
  const probe = await probeServer(url);
  if (probe === 'other') {
    throw new Error(`Port ${port} is already serving something that is not this game (no ${BRIDGE_SPECIFIER} there); pass a different port.`);
  }
  if (probe === 'free') {
    ownedServer = await createServer({
      root: PROJECT_ROOT,
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

    // Once the browser or the page is gone every further action would hang or
    // throw a cryptic Playwright error; record why, and fail fast with it instead.
    let deadReason: string | null = null;
    browser.on('disconnected', () => { deadReason ??= 'The game browser closed'; });
    page.on('close', () => { deadReason ??= 'The game page closed'; });
    function assertAlive(): void {
      if (deadReason) throw new Error(`${deadReason}; call game_start to open a new session.`);
    }

    // Uncaught page errors, kept for the bridge-timeout diagnosis.
    const pageErrors: string[] = [];
    page.on('pageerror', error => {
      pageErrors.push(error.message);
      if (pageErrors.length > PAGE_ERROR_CAP) pageErrors.shift();
    });

    if (freshSave) {
      // The save lives in `localStorage` (`src/persistence.ts`); clearing before
      // any app script runs guarantees the game boots with pristine defaults.
      // Init scripts rerun on every navigation, so the wipe is one-shot per tab:
      // a save import (or any reload the game asks for) must boot what it wrote.
      await page.addInitScript(() => {
        if (sessionStorage.getItem('agent-fresh-save-done')) return;
        sessionStorage.setItem('agent-fresh-save-done', '1');
        localStorage.clear();
      });
    }
    if (initScript) await page.addInitScript(initScript);
    // The two cheat-menu resets ask through a native `confirm()`. The agent has no
    // other way to answer one, and the click that raised it is the intent, so yes.
    page.on('dialog', dialog => { void dialog.accept(); });
    await page.goto(baseUrl);
    await waitForBridge(page, pageErrors);

    let realtime = true;
    await setPaused(page, true);

    // Export's file download, saved where the agent can read it: a per-session
    // temp directory, made on the first export and left behind on close (the file
    // is the agent's to keep). The observation names the last one saved.
    let downloadDir: string | null = null;
    let exportPath: string | null = null;
    async function captureDownload(download: Download): Promise<void> {
      downloadDir ??= await mkdtemp(join(tmpdir(), 'miner-agent-'));
      const target = join(downloadDir, download.suggestedFilename());
      await download.saveAs(target);
      exportPath = target;
    }

    /** The observation, with the harness's own `saveExportPath` beside the export it saved. */
    async function readBack(radius?: number, detail?: ObservationDetail): Promise<AgentObservation> {
      const observation = await readObservation(page, radius, detail);
      const overlay = observation.overlay;
      if (exportPath && overlay?.kind === 'info' && overlay.saveExport !== undefined) overlay.saveExportPath = exportPath;
      return observation;
    }

    // Unpause (if realtime), run the action, settle until the sim has ticked past
    // it, pause again, then read back the fresh observation — the whole action
    // contract in one place. The re-pause sits in a `finally`, so an action that
    // throws still leaves the sim frozen as promised. An action that reloads the
    // page (a save import, a full reset) is waited out: the new document boots,
    // its bridge registers, and the pause model is reapplied to it before the
    // readback.
    async function act(run: () => Promise<void>): Promise<AgentObservation> {
      assertAlive();
      let navigated = false;
      const onRequest = (request: Request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigated = true;
      };
      page.on('request', onRequest);
      await withCleanup(async () => {
        if (realtime) await setPaused(page, false);
        await run();
        // A reload tears the old document down mid-settle; that is not a failure.
        try { await settle(page); } catch (error) { if (!navigated) throw error; }
        if (navigated) {
          await page.waitForLoadState('load');
          await waitForBridge(page, pageErrors);
        }
      }, async () => {
        page.off('request', onRequest);
        await repause();
      });
      return readBack();
    }

    /** Freeze the sim again under the realtime model, unless the page is gone. */
    async function repause(): Promise<void> {
      if (realtime && !deadReason) await setPaused(page, true);
    }

    let closed = false;
    const bindings = {browser, context, ownedServer};
    return {
      url: baseUrl,
      page,
      isRealtime: () => realtime,
      isDead: () => deadReason !== null,
      startRun: () => act(async () => {
        // Enter starts the run from the splash wherever focus is (the intro's own
        // capture-phase handler); wait until the HUD is up and the mine has focus.
        await page.keyboard.press('Enter');
        await page.locator('#hud').waitFor({state: 'visible'});
        await page.locator('#intro').waitFor({state: 'detached'});
      }),
      press: key => act(async () => {
        await routeKeysToGame(page, key);
        await page.keyboard.press(key);
      }),
      type: async text => {
        assertAlive();
        // Without a focused field the keystrokes would drive the mine instead.
        const focused = await page.evaluate(() => {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return null;
          if (!active) return 'nothing';
          return `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}`;
        });
        if (focused !== null) {
          throw new Error(`type needs a focused text field, but focus is on ${focused}; click portalNameInput or importSaveText first.`);
        }
        return act(() => page.keyboard.type(text));
      },
      hold: (key, ms, holdOptions) => act(async () => {
        // Release in a `finally`: a key left down would keep driving the ship
        // through every later action.
        let shiftDown = false;
        let keyDown = false;
        await routeKeysToGame(page, key);
        await withCleanup(async () => {
          // The key goes down on a frozen sim, so no tick can take its first step
          // before `holdForSimTime` has read the tick it counts from — under load
          // that round trip is several ticks, and each was a tick held too long.
          await setPaused(page, true);
          if (holdOptions?.shift) { await page.keyboard.down('Shift'); shiftDown = true; }
          await page.keyboard.down(key);
          keyDown = true;
          // Held for `ms` of sim time after the first step, then frozen on the
          // spot while the key comes up, so the step count is the hold's length
          // rather than whatever the wall clock and the frame timing let through.
          await holdForSimTime(page, ms);
        }, async () => {
          try {
            if (keyDown) await page.keyboard.up(key);
          } finally {
            try {
              if (shiftDown) await page.keyboard.up('Shift');
            } finally {
              // Running again for the settle; the action's own cleanup re-pauses.
              if (!deadReason) await setPaused(page, false);
            }
          }
        });
      }),
      click: async target => {
        assertAlive();
        const selector = selectorForTarget(target);
        const {target: name} = parseTarget(target);
        // Refuse a click that cannot land before the sim is unpaused, with the
        // reason, rather than let Playwright sit out its actionability timeout.
        const control = await clickableControl(page, selector, name);
        // Export also hands the save over as a file: catch it, so the observation
        // can say where it landed (`overlay.saveExportPath`).
        const exporting = name === 'exportSaveBtn';
        return act(async () => {
          const download = exporting ? page.waitForEvent('download', {timeout: DOWNLOAD_TIMEOUT_MS}).catch(() => null) : null;
          await control.click({timeout: CLICK_TIMEOUT_MS});
          const started = await download;
          if (started) await captureDownload(started).catch(error => console.error('Could not save the exported file:', error));
        });
      },
      pressTile: async (x, y) => {
        assertAlive();
        // A press the game would ignore (unarmed, out of every reach) is refused
        // with the reason rather than clicked: it would change nothing but unlock
        // the audio, which is easy to mistake for the music button toggling.
        const refusal = await tilePressRefusal(page, x, y);
        if (refusal) throw new Error(refusal);
        const point = await screenPointForTile(page, x, y);
        if (!point) throw new Error(`Tile (${x}, ${y}) is off-screen; no canvas point to press.`);
        // The HUD cards and any open dialog sit above the canvas and take presses
        // there, so a click at a covered point would hit them, not the mine.
        const cover = await page.evaluate(({px, py}) => {
          const hit = document.elementFromPoint(px, py);
          if (hit instanceof HTMLCanvasElement && hit.id === 'game') return null;
          if (!hit) return 'nothing';
          const host = hit.closest('dialog, [id]') ?? hit;
          return `${host.tagName.toLowerCase()}${host.id ? `#${host.id}` : ''}`;
        }, {px: point.x, py: point.y});
        if (cover !== null) {
          throw new Error(`Tile (${x}, ${y}) is covered by the HUD/overlay (${cover}) at its screen point, not the #game canvas; close the overlay or press a tile clear of the HUD.`);
        }
        return act(() => page.mouse.click(point.x, point.y));
      },
      wait: async ms => {
        assertAlive();
        // A wait always lets the sim run for `ms`, whatever the model; only the
        // between-decisions state differs, so re-pause afterwards under realtime.
        await withCleanup(async () => {
          await setPaused(page, false);
          await sleep(ms);
        }, repause);
        return readBack();
      },
      observe: (radius, detail) => {
        assertAlive();
        return readBack(radius, detail);
      },
      screenshot: () => {
        assertAlive();
        return page.screenshot();
      },
      setRealtime: async value => {
        assertAlive();
        realtime = value;
        // Match the sim to the new model at once: frozen between decisions when
        // realtime, free-running otherwise.
        await setPaused(page, value);
        return readBack();
      },
      close: async () => {
        if (closed) return;
        closed = true;
        deadReason ??= 'The game session was closed';
        await closeSession(bindings);
      }
    };
  } catch (error) {
    await closeSession({browser, context, ownedServer}).catch(() => {});
    throw error;
  }
}

interface SessionBindings {
  browser: Browser | undefined;
  context: BrowserContext | undefined;
  ownedServer: ViteDevServer | null;
}

/**
 * Shut everything down, attempting every step even when an earlier one fails (a
 * browser that already disconnected must not leave the owned server running),
 * then report the first failure.
 */
async function closeSession({browser, context, ownedServer}: SessionBindings): Promise<void> {
  // The context must shut before its browser: closing the browser disposes every
  // context it owns, so a concurrent `context.close()` races it and rejects.
  const shutBrowser = async () => {
    const contextClosed = await Promise.allSettled([context?.close()]);
    await browser?.close();
    if (contextClosed[0].status === 'rejected') throw contextClosed[0].reason;
  };
  const results = await Promise.allSettled([
    shutBrowser(),
    // Only shut the server this session started; a reused one belongs to someone else.
    ownedServer?.close()
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * The locator for an allowlisted control, once it is known a click can land:
 * rendered, visible, enabled, and not under another surface (an open modal's
 * backdrop, a HUD card). Throws the specific reason otherwise. "Enabled" is
 * Playwright's reading, which honours `aria-disabled` as well as `disabled`: an
 * unaffordable Craft button stays focusable for a human but is refused here.
 */
async function clickableControl(page: Page, selector: string, name: string) {
  const control = page.locator(selector).first();
  if (await control.count() === 0) {
    throw new Error(`Control "${name}" is not rendered right now (nothing matches ${selector}); is its screen open? Check activeOverlay.`);
  }
  if (!await control.isVisible()) {
    throw new Error(`Control "${name}" is not rendered visibly right now (it exists but is hidden).`);
  }
  if (!await control.isEnabled()) {
    throw new Error(`Control "${name}" is disabled right now; its action is not available (see the overlay's affordances).`);
  }
  await control.scrollIntoViewIfNeeded({timeout: CLICK_TIMEOUT_MS});
  // A dialog may still be settling into place, so give the hit test a few frames.
  let cover: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    cover = await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || hit === element || element.contains(hit)) return null;
      if (hit instanceof HTMLLabelElement && hit.control === element) return null;
      const host = hit.closest('dialog, [id]') ?? hit;
      return `${host.tagName.toLowerCase()}${host.id ? `#${host.id}` : ''}`;
    });
    if (cover === null) return control;
    await sleep(50);
  }
  throw new Error(`Control "${name}" is covered by open overlay ${cover}; close that first.`);
}

/**
 * Make sure a key press reaches the game, not whichever button last took focus —
 * what a player's own click back on the mine does. A click on a HUD control leaves
 * focus on it, and a closing dialog hands focus back to its opener, so a later
 * Space or Enter would activate that button (`input.ts` leaves a focused control's
 * own activation keys alone) instead of opening the station beside the ship.
 *
 *   no dialog open   focus the `#game` canvas, the mine's keyboard target
 *   a dialog open    leave focus where it is, except that Space/Enter on a focused
 *                    button, tab or link inside it drops that focus first, so the
 *                    key does what the overlay's keys do (Space shuts a station
 *                    screen) rather than pressing a control — `click` is for those
 *
 * A focused text field is always left alone (typing is `type`'s job, and Escape
 * there is the way out), and so is the title splash, which owns its own keys.
 */
async function routeKeysToGame(page: Page, key: string): Promise<void> {
  await page.evaluate(pressed => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (document.getElementById('intro')) return;
    if (!document.querySelector('dialog[open]')) {
      const canvas = document.getElementById('game');
      if (canvas && active !== canvas) canvas.focus({preventScroll: true});
      return;
    }
    const activation = pressed === ' ' || pressed === 'Space' || pressed === 'Enter';
    if (activation && active instanceof HTMLElement && active.closest('button, [role=tab], a')) active.blur();
  }, key);
}

/**
 * Poll until the game has booted and registered its runtime with the bridge. On a
 * timeout the error carries what the page itself reported — the "Mine offline" /
 * "Interface crashed" notice and any uncaught page errors — so a broken boot is
 * diagnosable without opening a browser.
 */
async function waitForBridge(page: Page, pageErrors: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (page.isClosed()) throw new Error('The game page closed while waiting for the agent bridge.');
    const ready = await page.evaluate(async spec => {
      try {
        const module = (await import(spec)) as BridgeModule;
        return module.agentBridge.observe() !== null;
      } catch {
        return false;
      }
    }, BRIDGE_SPECIFIER).catch(() => false); // a document mid-navigation is not ready yet
    if (ready) return;
    await sleep(100);
  }
  const notice = await page.evaluate(() => document.getElementById('runtime-failure')?.textContent?.trim() || null).catch(() => null);
  const details = [
    notice ? `Runtime failure notice: ${notice}` : null,
    pageErrors.length > 0 ? `Page errors:\n${pageErrors.map(message => `  - ${message}`).join('\n')}` : null
  ].filter(line => line !== null);
  throw new Error(['The agent bridge did not register within 15s; is the game booting?', ...details].join('\n'));
}

async function setPaused(page: Page, paused: boolean): Promise<void> {
  await page.evaluate(async ({spec, value}) => {
    const module = (await import(spec)) as BridgeModule;
    module.agentBridge.setPaused(value);
  }, {spec: BRIDGE_SPECIFIER, value: paused});
}

/**
 * Let the action's input be simulated before the sim is frozen again: at least
 * two animation frames, and until `SETTLE_TICKS` sim ticks have run since the
 * input landed. Two frames alone were not enough — resuming re-anchors the fixed
 * stepper, so the first frame runs no tick and the second may run none either
 * when it arrives a hair under 1/60 s later — and a press re-paused there left
 * its move queued: the observation showed the ship where it was, and the next
 * press of the same key overwrote the queued one, so a press was lost outright.
 * Capped, so a page whose sim is not ticking (a hidden tab) never hangs it.
 */
async function settle(page: Page): Promise<void> {
  // No named helpers in here: the function body is serialised into the page, and
  // the esbuild that `tsx` runs this file through would wrap one in a `__name`
  // call the page does not define.
  await page.evaluate(async ({spec, ticks, cap}) => {
    const module = (await import(spec)) as BridgeModule;
    const start = module.agentBridge.tick();
    for (let i = 0; i < cap; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (i === 0) continue;
      const now = module.agentBridge.tick();
      if (start === null || now === null || now - start >= ticks) return;
    }
  }, {spec: BRIDGE_SPECIFIER, ticks: SETTLE_TICKS, cap: SETTLE_FRAME_CAP});
}

/**
 * Keep a held key down for `ms` of sim time after the step it lands on, then
 * freeze the sim for the release. The key goes down on a frozen sim (`hold`
 * pauses first), and this reads the tick before resuming it, so the count cannot
 * start late however slow the round trip. The first tick after that takes the
 * step at once; the key then stays down through `ceil(ms / FIXED_STEP_MS)`
 * more ticks, so every repeat due within `ms` of that step lands — a hold of
 * 5 × 105 ms takes six steps, not five — and none after it, since the sim is
 * frozen, from the page, in the very frame the last of those ticks ran, before
 * the keyup travels back. Sleeping `ms` on the wall clock instead lost the start
 * to the resume's anchor frame and the keydown's trip into the page, and a hold
 * sized to its steps came up one short. Capped on the wall clock, so a page that
 * is not ticking (a hidden tab) still lets go.
 */
async function holdForSimTime(page: Page, ms: number): Promise<void> {
  // No named helpers in here either (see `settle`).
  await page.evaluate(async ({spec, steps, cap}) => {
    const bridge = ((await import(spec)) as BridgeModule).agentBridge;
    // The sim was frozen for the keydown: the count starts here, then it runs.
    const start = bridge.tick();
    bridge.setPaused(false);
    if (start === null) return;
    const target = start + 1 + steps;
    const deadline = performance.now() + cap;
    for (let now = start; now < target && performance.now() < deadline;) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      now = bridge.tick() ?? target;
    }
    bridge.setPaused(true);
  }, {spec: BRIDGE_SPECIFIER, steps: Math.ceil(ms / FIXED_STEP_MS - 1e-9), cap: ms + 2000});
}

async function readObservation(page: Page, radius?: number, detail?: ObservationDetail): Promise<AgentObservation> {
  const observation = await page.evaluate(async ({spec, r, d}) => {
    const module = (await import(spec)) as BridgeModule;
    return module.agentBridge.observe(r, d);
  }, {spec: BRIDGE_SPECIFIER, r: radius, d: detail});
  if (!observation) throw new Error('No live game to observe; has the session been started?');
  return observation;
}

async function tilePressRefusal(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(async ({spec, tx, ty}) => {
    const module = (await import(spec)) as BridgeModule;
    return module.agentBridge.tilePressRefusal(tx, ty);
  }, {spec: BRIDGE_SPECIFIER, tx: x, ty: y});
}

async function screenPointForTile(page: Page, x: number, y: number): Promise<{x: number; y: number} | null> {
  return page.evaluate(async ({spec, tx, ty}) => {
    const module = (await import(spec)) as BridgeModule;
    return module.agentBridge.screenPointForTile(tx, ty);
  }, {spec: BRIDGE_SPECIFIER, tx: x, ty: y});
}
