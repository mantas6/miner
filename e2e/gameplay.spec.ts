// Keyboard mining: the loop, the input layer and the HUD, end to end.
//
// The fuel numbers below are exact on purpose. They are the only way a test can
// tell "one keypress charged the ship once" apart from "one keypress charged it
// twice", which is what a second set of keyboard listeners on one runtime, or a
// fixed stepper that replays an impulse, would produce. The arithmetic is:
//
//   base move  0.25  + vertical 0.08              = 1 tile of travel
//   drilling   + 0.90 surcharge, then x1.5        = 1.845 fuel per drill hit
//
// and the HUD rounds up, so 100 → 98.155 reads `99/100` and 96.31 reads `97/100`.
// The ship spawns on the home-cavern floor (`HOME_ROW`, depth 0 m). That floor is
// now paved with stone (48 hp), which would take ~5 s to drill, so the tests that
// care about a clean one-tile dig seed a plain 2-hp dirt tile under the spawn with
// `seedDirtUnderHome`: against a starting drill of 1 it takes exactly two hits to
// clear and the ship then stands one tile down — 10 m. If balance moves, these
// constants move with it.

import { expect, test } from '@playwright/test';
import { collectPageFailures, drillDown, readDepth, readFuel, seedDirtUnderHome, startSoloRun } from './support/game';

test.describe('gameplay', () => {
  test('one keypress is charged exactly once and clears exactly one tile', async ({page}) => {
    await seedDirtUnderHome(page);
    await startSoloRun(page);
    const depth = page.locator('#depth');
    const fuel = page.locator('#fuelLabel');
    await expect(depth).toHaveText('0 m');
    await expect(fuel).toHaveText('100/100');

    await drillDown(page);
    // First hit: the tile has 1 hp left, so the ship has not moved yet — but it
    // has paid for exactly one drill hit.
    await expect(fuel).toHaveText('99/100');
    await expect(depth).toHaveText('0 m');

    await drillDown(page);
    // Second hit clears the tile and the ship advances one tile: 10 m, not 20.
    await expect(fuel).toHaveText('97/100');
    await expect(depth).toHaveText('10 m');
  });

  test('mining downward increases depth and burns fuel', async ({page}) => {
    const failures = collectPageFailures(page);
    await seedDirtUnderHome(page);
    await startSoloRun(page);

    let fuel = await readFuel(page);
    // Ten hits are more than enough to get clear of the seeded dirt floor and into
    // the starter seam below, whatever the generator put under it.
    for (let hit = 0; hit < 10; hit++) {
      await drillDown(page);
      const remaining = await readFuel(page);
      expect(remaining).toBeLessThan(fuel);
      fuel = remaining;
    }

    expect(await readDepth(page)).toBeGreaterThanOrEqual(20);
    expect(failures).toEqual([]);
  });

  test('digging below home leaves the base and drops into the mine', async ({page}) => {
    await seedDirtUnderHome(page);
    await startSoloRun(page);
    // The ship spawns on the home-cavern floor, so depth reads zero and the live
    // region says it is at the base. The Ship button is always available.
    await expect(page.locator('#depth')).toHaveText('0 m');
    await expect(page.locator('#shipBtn')).toBeVisible();
    await expect(page.locator('#game-status')).toHaveText('At home base.');

    // Two hits clear the dirt tile below and the ship stands one tile down.
    await drillDown(page);
    await drillDown(page);
    await expect(page.locator('#depth')).toHaveText('10 m');

    // Below the cavern floor the ship is out in the mine, and the depth tracker
    // counts down to the next landmark rather than up from zero.
    await expect(page.locator('#game-status')).toHaveText('In the mine.');
    await expect(page.locator('#depthTarget')).toContainText('m to');
  });

  /**
   * The manufacturing station is where consumables come from now, so this walks
   * the browser path the unit tests cannot: a restored save parking the ship
   * beside the station with the scanner recipe's materials in its stock, then the
   * craft-and-take round trip that lands the device in the bay as its own armable
   * slot.
   *
   * The materials are seeded into the station rather than mined, because
   * everything under test here happens at the base and digging up 2 Copper and a
   * Silver first would test the drill instead. The ship's `x`/`y` put it one tile
   * from the manufacturing station (`STATIONS.manufacturer` at `HOME_X-1`).
   */
  test('a scanner crafted at the manufacturing station is taken aboard', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('moleload-progress-v1', JSON.stringify({
        version: 18,
        x: 43,
        y: 20,
        stations: [
          {kind: 'manufacturer', x: 44, y: 20, items: [{kind: 'ore:Copper', count: 2}, {kind: 'ore:Silver', count: 1}]},
          {kind: 'extractor', x: 46, y: 20}
        ]
      }));
    });
    await startSoloRun(page);

    // Space opens the station the ship is parked beside; its stock holds the
    // recipe's ore.
    await page.keyboard.press(' ');
    await expect(page.locator('#station-screen')).toBeVisible();
    await expect(page.locator('[data-station="take"][data-station-kind="ore:Copper"]')).toBeVisible();

    // Crafting the scanner consumes the ore and lands the device in the stock.
    await page.locator('[data-craft="scanner"]').click();
    await expect(page.locator('[data-station="take"][data-station-kind="scanner"]')).toBeVisible();
    await expect(page.locator('[data-station="take"][data-station-kind="ore:Copper"]')).toHaveCount(0);

    // Take it aboard and close the station: it shows up in the cargo bay as its
    // own armable slot, counting toward the bay's capacity.
    await page.locator('[data-station="take"][data-station-kind="scanner"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#station-screen')).toBeHidden();

    const slot = page.locator('#scannerSlotBtn');
    await expect(slot).toHaveText('Scanner×1');
    await expect(slot).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#inventoryToggleBtn')).toContainText('1/20');

    // Arming and standing the device down again is the slot's whole control
    // surface, and it never leaves the bay while doing so.
    await slot.click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(slot).toHaveAttribute('aria-pressed', 'false');
    await expect(slot).toHaveText('Scanner×1');
  });

  /**
   * The other half of the gesture: a press on the mine puts the device on the
   * tile that was pressed. The save below hollows out and surveys rows 18–45 of
   * the whole mine — the band starts at the cavern ceiling (`HOME_CAVERN_TOP`),
   * and runs deep enough that the middle of the canvas is a legal target whatever
   * the framing, since the ship spawns down at the home cavern floor rather than
   * at the top of the world. The test is about the screen-to-tile conversion, not
   * about aiming.
   */
  test('a press on the mine deploys the armed scanner and spends it', async ({page}) => {
    await page.addInitScript(() => {
      const worldWidth = 90;
      const cavernTop = 18;
      const tiles = [];
      for (let y = cavernTop; y <= 45; y++) {
        for (let x = 0; x < worldWidth; x++) tiles.push({x, y, tile: {type: 'air'}});
      }
      localStorage.setItem('moleload-progress-v1', JSON.stringify({
        version: 18,
        bay: [{kind: 'scanner', count: 1}],
        explored: `${cavernTop * worldWidth}-${46 * worldWidth - 1}`,
        tiles
      }));
    });
    await startSoloRun(page);

    const slot = page.locator('#scannerSlotBtn');
    await slot.click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.locator('#game');
    const box = (await canvas.boundingBox())!;
    await canvas.click({position: {x: box.width * 0.55, y: box.height * 0.5}});

    await expect(page.locator('#toast')).toContainText('Scanner deployed');
    // The device left the bay with the press, and the slot with it.
    await expect(page.locator('#scannerSlotBtn')).toHaveCount(0);
    await expect(page.locator('#inventoryToggleBtn')).toContainText('0/20');
    // The keyboard is back on the mine, so play resumes without a second click.
    await expect(canvas).toBeFocused();
  });

  /**
   * Dynamite is placed the same way, but it is the fuse that makes it worth an
   * end-to-end test: the stick has to leave the bay on the press, sit on the tile
   * for five real seconds, and then go off on its own with nothing else touching
   * it. The same hollowed-out, surveyed mine as the scanner test above; the stick
   * goes well below the ship (which sits near the middle of the canvas now that it
   * spawns at the cavern floor) so the blast is not the ship's own.
   */
  test('a planted stick leaves the bay, burns its fuse, and blows on its own', async ({page}) => {
    await page.addInitScript(() => {
      const worldWidth = 90;
      const cavernTop = 18;
      const tiles = [];
      for (let y = cavernTop; y <= 45; y++) {
        for (let x = 0; x < worldWidth; x++) tiles.push({x, y, tile: {type: 'air'}});
      }
      localStorage.setItem('moleload-progress-v1', JSON.stringify({
        version: 18,
        bay: [{kind: 'dynamite', count: 2}],
        explored: `${cavernTop * worldWidth}-${46 * worldWidth - 1}`,
        tiles
      }));
    });
    await startSoloRun(page);

    // E is the shortcut for the slot, and Escape stands it down again.
    const slot = page.locator('#dynamiteSlotBtn');
    await expect(slot).toHaveText('Dynamite×2');
    await page.keyboard.press('e');
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(slot).toHaveAttribute('aria-pressed', 'false');

    await slot.click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.locator('#game');
    const box = (await canvas.boundingBox())!;
    // Low on the canvas: several tiles below the centred ship, clear of the
    // 2-tile blast so the detonation is not a "caught in your own blast" refusal.
    await canvas.click({position: {x: box.width * 0.55, y: box.height * 0.85}});

    await expect(page.locator('#toast')).toContainText('Fuse lit');
    // The stick left the bay with the press; the other one is still aboard.
    await expect(slot).toHaveText('Dynamite×1');
    await expect(canvas).toBeFocused();

    // Nothing else happens in between: the fuse runs on the simulation's clock.
    await expect(page.locator('#toast')).toContainText('Dynamite', {timeout: 15_000});
  });

  test('the canvas keeps the keyboard while mining', async ({page}) => {
    // A plain dirt tile under the spawn, so one keypress drills something that
    // charges fuel rather than chipping free hits off the stone-paved floor.
    await seedDirtUnderHome(page);
    await startSoloRun(page);
    await drillDown(page);
    await expect(page.locator('#game')).toBeFocused();
  });
});
