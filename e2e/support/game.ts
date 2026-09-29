// Shared fixtures for the end-to-end suite.
//
// Everything here drives the app the way a player does — keys and clicks on the
// documented element ids (`#intro`, `#game`, `#hud`, the dialog ids) — with one
// deliberate exception, `openOverlayDirectly()`, which is explained at its own
// definition.

import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { HOME_ROW, HOME_X, WORLD_W } from '../../shared/constants';
import { SAVE_KEY, SAVE_VERSION } from '../../src/persistence';
import { TRADING_POST_MIN_ROW, tradingPostAt } from '../../src/world/world';

export { SAVE_KEY, SAVE_VERSION };

/** The fields of a save a spec seeds; `version` is always filled in as this build's. */
export type SaveSeed = Record<string, unknown>;

/**
 * An init script (as source text) that writes `partial` into `localStorage` as a
 * save from this build, before any app code runs. Text rather than a function so
 * values computed here in Node — the key, the version, coordinates found by the
 * world generator — travel into the page baked in; a function init script is
 * serialized without its closure. Init scripts rerun on every navigation, so
 * `once` guards a seed that must not clobber a save the game wrote itself (an
 * import reloads into what it just stored).
 */
export function seedSaveScript(partial: SaveSeed = {}, options: {once?: boolean} = {}): string {
  const write = `localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify({version: SAVE_VERSION, ...partial}))});`;
  if (!options.once) return write;
  return `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); ${write} }`;
}

/** Seed a save for `page` before it loads; call before `startRun`. */
export async function seedSave(page: Page, partial: SaveSeed = {}, options: {once?: boolean} = {}): Promise<void> {
  await page.addInitScript(seedSaveScript(partial, options));
}

/** The plain 2-hp dirt hatch directly under the spawn, as the generator lays it. */
export const DIRT_UNDER_HOME = {x: HOME_X, y: HOME_ROW + 1, tile: {type: 'dirt', hp: 2, maxHp: 2}} as const;

/**
 * The first trading post the generator places, scanning row by row from the
 * shallowest row a post may stand on. Worldgen is deterministic, so this is the
 * same post on every run — found rather than hard-coded, so a worldgen change
 * moves the fixture with it.
 */
export function firstTradingPost(): {x: number; y: number} {
  for (let y = TRADING_POST_MIN_ROW; y < TRADING_POST_MIN_ROW + 2000; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post generated in the first 2000 rows');
}

/**
 * The page has no favicon, so Chromium requests `/favicon.ico` by itself and logs
 * the 404 as a console error. It has nothing to do with the app and it arrives
 * whenever the browser gets round to it, so leaving it in would make every
 * "no console errors" assertion race the favicon.
 */
function isBrowserFaviconProbe(message: ConsoleMessage): boolean {
  return message.location().url.endsWith('/favicon.ico');
}

/**
 * Every console error and uncaught exception from here to the end of the test, as
 * lines to assert on (`expect(failures).toEqual([])` prints what went wrong).
 *
 * Console *errors* only: Chromium logs autoplay refusals and other advisory notes
 * at warning level, and those are expected here — no test spends a user gesture
 * before the run starts.
 */
export function collectPageFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error' || isBrowserFaviconProbe(message)) return;
    failures.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', error => {
    failures.push(`pageerror: ${error.message}`);
  });
  return failures;
}

/** The id of the currently focused element, or `''` when focus is on the body. */
export function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return '';
    return active.id;
  });
}

/** Whether the element currently matches `:focus-visible` (i.e. draws the ring). */
export function isFocusVisible(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => element.matches(':focus-visible'));
}

/** Open the title card and wait until it is on screen. */
export async function openIntro(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#intro')).toBeVisible();
}

/**
 * Seed a save that pins the tile directly under the spawn to the plain 2-hp dirt
 * hatch the generator lays there, so a test that counts drill hits and fuel keeps
 * its arithmetic even if worldgen later changes that tile. Call before `startRun`,
 * since the save has to be in place before the page loads.
 */
export async function seedDirtUnderHome(page: Page): Promise<void> {
  await seedSave(page, {tiles: [DIRT_UNDER_HOME]});
}

/**
 * Splash → a live run with the canvas holding the keyboard.
 *
 * A press is the whole flow. The corner of the card is deliberate for the pointer
 * variant — it is the backdrop, well clear of the start button.
 */
export async function startRun(page: Page, how: 'keyboard' | 'click' = 'keyboard'): Promise<void> {
  await openIntro(page);
  if (how === 'keyboard') await page.keyboard.press('Enter');
  else await page.locator('#intro').click({position: {x: 8, y: 8}});
  await expect(page.locator('#intro')).toHaveCount(0);
  await expect(page.locator('#hud')).toBeVisible();
  // `claimFocusForRun()` retries across a few frames, because React has not
  // necessarily committed the phase change when the press returns.
  await expect(page.locator('#game')).toBeFocused();
}

/**
 * Drill one hit downward and wait for the ship to have paid for it.
 *
 * Presses have to be separated by at least one simulation step: `keyImpulse` is a
 * single slot, so two keydowns inside one 60 Hz tick collapse into one move. Fuel
 * is the cheapest proof that the step happened — every drill hit, cleared tile or
 * not, charges for itself.
 */
export async function drillDown(page: Page): Promise<void> {
  const fuel = page.locator('#fuelLabel');
  const before = (await fuel.textContent()) ?? '';
  await page.keyboard.press('ArrowDown');
  await expect(fuel).not.toHaveText(before);
}

/** Metres of depth currently on the HUD. */
export async function readDepth(page: Page): Promise<number> {
  const text = (await page.locator('#depth').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

/** Units of fuel currently on the HUD (the `nnn/mmm` readout's numerator). */
export async function readFuel(page: Page): Promise<number> {
  const text = (await page.locator('#fuelLabel').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

/**
 * Open an overlay through the game's own command table instead of its button.
 *
 * Needed for exactly one thing: "ship and info requested at the same time". Both
 * are modal `<dialog>`s, so while one is up the button that opens the other is
 * inert and genuinely unclickable — which is the whole point of `activeOverlay`
 * being one field. There is therefore no pointer path into the case, and the
 * handover still has to be tested.
 *
 * This is not a test hook bolted onto production code: the dev server serves the
 * app's own ES modules, so importing `/src/ui/commands.ts` by its module URL hands
 * back the very table `game.ts` registered into, and the call goes through
 * `openShipScreen()`/`openInfoScreen()` exactly as a click would.
 */
export async function openOverlayDirectly(page: Page, overlay: 'ship' | 'info'): Promise<void> {
  await page.evaluate(async name => {
    // Held in a variable so TypeScript treats it as a runtime URL rather than a
    // module it should resolve from this config.
    const specifier = '/src/ui/commands.ts';
    const {uiCommands} = await (import(specifier) as Promise<{uiCommands: {openShip(): void; openInfo(): void}}>);
    if (name === 'ship') uiCommands.openShip();
    else uiCommands.openInfo();
  }, overlay);
}
