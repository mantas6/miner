// The overlays, which is where the browser does the work: native modal
// `<dialog>`s contain Tab, make the page behind them inert, and answer Escape with
// a close request. None of that exists in a jsdom/happy-dom unit test.

import { expect, test } from '@playwright/test';
import { HOME_ROW, STATIONS } from '../shared/constants';
import {
  activeElementId,
  collectPageFailures,
  openOverlayDirectly,
  seedSave,
  startSoloRun
} from './support/game';

test.describe('ship dialog', () => {
  test('opens focused inside itself and Escape restores focus to the trigger', async ({page}) => {
    const failures = collectPageFailures(page);
    await startSoloRun(page);

    await page.locator('#shipBtn').click();
    await expect(page.locator('#ship-screen')).toBeVisible();
    // The dialog focuses its own close button, so the first Tab and the first
    // Escape both act on the ship screen rather than on the mine behind it.
    await expect(page.locator('#shipCloseBtn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#ship-screen')).toBeHidden();
    await expect(page.locator('#shipBtn')).toBeFocused();
    expect(failures).toEqual([]);
  });

  test('the × button closes it and restores focus too', async ({page}) => {
    await startSoloRun(page);
    await page.locator('#shipBtn').click();
    await page.locator('#shipCloseBtn').click();
    await expect(page.locator('#ship-screen')).toBeHidden();
    await expect(page.locator('#shipBtn')).toBeFocused();
  });

  test('a press on the dimmed area around the card closes it', async ({page}) => {
    await startSoloRun(page);
    await page.locator('#shipBtn').click();
    await expect(page.locator('#ship-screen')).toBeVisible();
    // The very top-left of the dialog box is padding, never the card.
    await page.locator('#ship-screen').click({position: {x: 4, y: 4}});
    await expect(page.locator('#ship-screen')).toBeHidden();
  });

  test('Tab cannot walk out of the dialog into the HUD behind it', async ({page}) => {
    // Two upgrades in the bay give the screen more than its close button to
    // cycle, so the wrap is a real cycle rather than one control standing still.
    await seedSave(page, {bay: [{kind: 'upgrade:tank:1', count: 1}, {kind: 'upgrade:drill:1', count: 1}]});
    await startSoloRun(page);
    await page.locator('#shipBtn').click();
    await expect(page.locator('#shipCloseBtn')).toBeFocused();

    // Everything outside a modal `<dialog>` is inert, so the cycle can only ever
    // visit the dialog's own enabled controls — Chromium routes the wrap-around
    // through the document itself, which is why `:wrap` is an accepted stop.
    const visited: string[] = [];
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press('Tab');
      visited.push(await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) return ':wrap';
        return active.closest('#ship-screen') ? `ship:${active.id}` : `outside:${active.id}`;
      }));
    }

    expect(visited.filter(stop => stop.startsWith('outside:'))).toEqual([]);
    // And it really did move: the cycle is not one element standing still.
    expect(new Set(visited).size).toBeGreaterThan(1);
  });
});

test.describe('station dialog', () => {
  test('Space opens it beside a station, focused inside, and Escape closes it', async ({page}) => {
    // Park the ship one tile from the manufacturing station so Space reaches it.
    await seedSave(page, {x: STATIONS.manufacturer.x - 1, y: HOME_ROW});
    await startSoloRun(page);

    await page.keyboard.press(' ');
    await expect(page.locator('#station-screen')).toBeVisible();
    await expect(page.locator('#stationCloseBtn')).toBeFocused();

    // Escape closes it and hands the keyboard back to the mine it was opened from.
    await page.keyboard.press('Escape');
    await expect(page.locator('#station-screen')).toBeHidden();
    await expect(page.locator('#game')).toBeFocused();
  });
});

test.describe('info dialog', () => {
  test('opens focused inside itself and Escape restores focus to the trigger', async ({page}) => {
    await startSoloRun(page);

    await page.locator('#infoBtn').click();
    await expect(page.locator('#info-screen')).toBeVisible();
    await expect(page.locator('#infoCloseBtn')).toBeFocused();
    // Info always opens on its first tab.
    await expect(page.locator('#info-objective')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#info-screen')).toBeHidden();
    await expect(page.locator('#infoBtn')).toBeFocused();
  });

  test('the tablist swaps panels by click and moves focus with the arrow keys', async ({page}) => {
    await startSoloRun(page);
    await page.locator('#infoBtn').click();

    await page.locator('#info-tab-controls').click();
    await expect(page.locator('#info-controls')).toBeVisible();
    // Only the selected panel is mounted, so the previous one is gone rather than
    // hidden — and only the selected tab is a tab stop.
    await expect(page.locator('#info-objective')).toHaveCount(0);
    await expect(page.locator('#info-tab-controls')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#info-tab-objective')).toHaveAttribute('tabindex', '-1');

    // Roving focus wraps: End jumps to the last tab, so → lands back on the first.
    // Going through End keeps this independent of how many tabs the panel has.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    expect(await activeElementId(page)).toBe('info-tab-objective');
    await page.keyboard.press('Enter');
    await expect(page.locator('#info-objective')).toBeVisible();
  });
});

test.describe('overlay exclusivity', () => {
  test('requesting info while the ship screen is up hands the screen over', async ({page}) => {
    await startSoloRun(page);
    await page.locator('#shipBtn').click();
    await expect(page.locator('#ship-screen')).toBeVisible();

    await openOverlayDirectly(page, 'info');
    await expect(page.locator('#info-screen')).toBeVisible();
    // The outgoing dialog's own close request must not have cleared the incoming
    // one's claim on the screen.
    await expect(page.locator('#ship-screen')).toBeHidden();
    await expect(page.locator('#ship-card')).toHaveCount(0);
    await expect(page.locator('#infoCloseBtn')).toBeFocused();

    // And the surviving overlay still closes normally.
    await page.keyboard.press('Escape');
    await expect(page.locator('#info-screen')).toBeHidden();
  });

  test('requesting the ship screen while info is up hands the screen back', async ({page}) => {
    await startSoloRun(page);
    await page.locator('#infoBtn').click();
    await expect(page.locator('#info-screen')).toBeVisible();

    await openOverlayDirectly(page, 'ship');
    await expect(page.locator('#ship-screen')).toBeVisible();
    await expect(page.locator('#info-screen')).toBeHidden();
    await expect(page.locator('#info-card')).toHaveCount(0);
  });
});

test.describe('keyboard and hover inside an open dialog', () => {
  /** Park the ship beside the manufacturer, whose stock holds a few iron. */
  async function openStationWithIron(page: import('@playwright/test').Page): Promise<void> {
    await seedSave(page, {
      x: STATIONS.manufacturer.x - 1, y: HOME_ROW,
      stations: [
        {kind: 'manufacturer', ...STATIONS.manufacturer, items: [{kind: 'ore:Iron', count: 3}]},
        {kind: 'extractor', ...STATIONS.extractor}
      ]
    });
    await startSoloRun(page);
    await page.keyboard.press(' ');
    await expect(page.locator('#station-screen')).toBeVisible();
  }

  test('an item tooltip paints above the open dialog, not under it', async ({page}) => {
    await openStationWithIron(page);

    const row = page.locator('#stationStock li > div').first();
    await row.hover();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Iron');
    // The row names the popup it is showing.
    await expect(row).toHaveAttribute('aria-describedby', 'item-tooltip');

    // The popup is pointer-transparent by design, so hit-testing would look straight
    // through it; lift that for the probe, then ask what is on top at its centre. A
    // popup under the dialog's top layer would lose to the dialog here.
    const onTop = await tooltip.evaluate(element => {
      const tip = element as HTMLElement;
      tip.style.pointerEvents = 'auto';
      const box = tip.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      tip.style.pointerEvents = '';
      return hit !== null && tip.contains(hit);
    });
    expect(onTop).toBe(true);

    // And it is painted beside the row it describes, not offset by its host.
    const rowBox = (await row.boundingBox())!;
    const tipBox = (await tooltip.boundingBox())!;
    expect(Math.abs(tipBox.x - rowBox.x)).toBeLessThan(40);
    expect(Math.min(Math.abs(tipBox.y - (rowBox.y + rowBox.height)), Math.abs(tipBox.y + tipBox.height - rowBox.y))).toBeLessThan(20);
  });

  test('Space on a focused Stow all presses it, and does not also shut the station', async ({page}) => {
    const failures = collectPageFailures(page);
    await openStationWithIron(page);

    // Bring the iron aboard first, so Stow all has something to put back.
    await page.locator('[data-station="take"][data-station-kind="ore:Iron"]').click();
    await expect(page.locator('#stationBay [data-station="stow"][data-station-kind="ore:Iron"]')).toBeVisible();

    await page.locator('#stowAllBtn').focus();
    await page.keyboard.press(' ');

    // The button ran — the iron is back in the stock — and the screen is still up.
    await expect(page.locator('#stationStock [data-station="take"][data-station-kind="ore:Iron"]')).toBeVisible();
    await expect(page.locator('#stationBay [data-station="stow"]')).toHaveCount(0);
    await expect(page.locator('#station-screen')).toBeVisible();
    await expect(page.locator('#stowAllBtn')).toBeFocused();
    expect(failures).toEqual([]);
  });

  test('Escape inside the portal name field leaves the field, not the dialog', async ({page}) => {
    // Beside the Home portal and out of the manufacturer's reach, so Space opens
    // the travel list.
    await seedSave(page, {
      x: STATIONS.portal.x - 1, y: HOME_ROW,
      // A portal only stands in cleared space, so the deep one's tile is dug out.
      tiles: [{x: STATIONS.portal.x, y: HOME_ROW + 4, tile: {type: 'air'}}],
      stations: [
        {kind: 'manufacturer', ...STATIONS.manufacturer, items: []},
        {kind: 'portal', ...STATIONS.portal, name: 'Home'},
        {kind: 'portal', x: STATIONS.portal.x, y: HOME_ROW + 4, name: 'Deep'}
      ]
    });
    await startSoloRun(page);
    await page.keyboard.press(' ');
    await expect(page.locator('#portal-screen')).toBeVisible();

    await page.locator('#portalNameInput').click();
    await expect(page.locator('#portalNameInput')).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(page.locator('#portalNameInput')).not.toBeFocused();
    await expect(page.locator('#portal-screen')).toBeVisible();

    // The next Escape is the dialog's own.
    await page.keyboard.press('Escape');
    await expect(page.locator('#portal-screen')).toBeHidden();
  });
});
