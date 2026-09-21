// Shared fixtures for the end-to-end suite.
//
// Everything here drives the app the way a player does — keys and clicks on the
// documented element ids (`#intro`, `#game`, `#hud`, the dialog ids) — with one
// deliberate exception, `openOverlayDirectly()`, which is explained at its own
// definition.

import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';

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
 * Splash → a live run with the canvas holding the keyboard.
 *
 * A press is the whole flow. The corner of the card is deliberate for the pointer
 * variant — it is the backdrop, well clear of the start button.
 */
export async function startSoloRun(page: Page, how: 'keyboard' | 'click' = 'keyboard'): Promise<void> {
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
