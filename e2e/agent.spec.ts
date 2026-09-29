// The programmatic-play harness, end to end and headless.
//
// This exercises the real thing the MCP server will drive — `openGameSession`
// itself — rather than the Playwright `page` fixture, so the session's own Vite
// startup, Chromium launch, pause model and bridge round trip are all under test.
// It reuses the suite's webServer by naming the same port the Playwright config
// serves on, so the session finds a server already listening and does not fight it.
//
// One session, seeded with a plain 2-hp dirt tile under the spawn (the same seed
// `e2e/support/game.ts` uses) so a single held key digs a real tile and the ASCII
// view moves; the tests run in order against it.

import { expect, test } from '@playwright/test';
import { HOME_ROW, STATIONS } from '../shared/constants';
import { openGameSession, type GameSession } from '../agent/session';
import { nth } from '../src/test-narrowing';
import { DIRT_UNDER_HOME, SAVE_VERSION, firstTradingPost, seedSaveScript } from './support/game';

/** The port the Playwright config's webServer serves the game on. */
const PORT = 5199;

/** The two workbench stations at their seeded home-cavern positions, both empty. */
const WORKBENCHES = [
  {kind: 'manufacturer', x: STATIONS.manufacturer.x, y: STATIONS.manufacturer.y, items: []},
  {kind: 'extractor', x: STATIONS.extractor.x, y: STATIONS.extractor.y}
];

/** The base's `Home` portal at its seeded tile. */
const HOME_PORTAL = {kind: 'portal', x: STATIONS.portal.x, y: STATIONS.portal.y, name: 'Home'};

/**
 * A second portal four rows below `Home` — depth 40 m, close enough that after a
 * jump to it the Home portal is still in view (so `P` paints again). A portal only
 * ever stands in cleared space, so the save digs its tile out too.
 */
const DEEP_PORTAL = {kind: 'portal', x: STATIONS.portal.x, y: HOME_ROW + 4, name: 'Deep'};
const DEEP_PORTAL_TILE = {x: DEEP_PORTAL.x, y: DEEP_PORTAL.y, tile: {type: 'air'}};

/**
 * A soft dirt tile directly under the spawn, and a few coal in the manufacturer's
 * stock so the transfer controls have something to move.
 */
const seedDirtUnderHome = seedSaveScript({
  tiles: [DIRT_UNDER_HOME],
  stations: [
    {...WORKBENCHES[0], items: [{kind: 'ore:Coal', count: 3}]},
    WORKBENCHES[1]
  ]
});

/**
 * A Construction Toolkit aboard and the two default stations in place, so a test
 * can lift the extractor and set it back down without first crafting anything.
 */
const seedToolkitScenario = seedSaveScript({bay: [{kind: 'toolkit', count: 1}], stations: WORKBENCHES});

/**
 * The ship parked on the first trading post the generator places (found in Node
 * by `firstTradingPost`), which stands in a cleared 3×3 air pocket (see
 * `src/world/world.ts`); a manufacturer holding iron one tile over gives the test
 * ore to sell without a dig, and cash to start the buy side.
 */
const POST = firstTradingPost();
const seedTradingPost = seedSaveScript({
  x: POST.x, y: POST.y,
  cash: 100,
  stations: [{kind: 'manufacturer', x: POST.x + 1, y: POST.y, items: [{kind: 'ore:Iron', count: 10}]}]
});

/**
 * The ship at the home base with a Drill Mk I fitted to its hull. Ore is never
 * persisted, so the fitted upgrade is the deterministic thing a reset will strip
 * into a wreck — exactly the loot the salvage path has to hand back. Only the two
 * workbench stations are seeded (no portal), so the reset falls back to the home
 * cavern: the replacement ship redeploys on the very tile the wreck was left on.
 */
const seedFittedUpgrade = seedSaveScript({equipment: ['upgrade:drill:1', null], stations: WORKBENCHES});

/**
 * The ship parked one tile east of the base `Home` portal, with the `Deep` portal
 * below it. The portal is the ship's only station in reach, so Space opens the
 * travel list rather than a workbench.
 */
const seedPortalTravel = seedSaveScript({
  x: HOME_PORTAL.x + 1, y: HOME_ROW,
  tiles: [DEEP_PORTAL_TILE],
  stations: [...WORKBENCHES, HOME_PORTAL, DEEP_PORTAL]
});

/**
 * The ship at the home spawn with two teleporter charges aboard and two portals,
 * both out of arm's reach — so `t` opens the teleporter list and a pick spends one
 * charge.
 */
const seedPortalTeleporter = seedSaveScript({
  bay: [{kind: 'teleporter', count: 2}],
  tiles: [DEEP_PORTAL_TILE],
  stations: [...WORKBENCHES, HOME_PORTAL, DEEP_PORTAL]
});

/**
 * The ship one tile west of the `Home` portal with a Drill Mk I fitted, so a hand
 * reset drops a wreck on the death tile, and two portals so the reset raises the
 * no-close respawn prompt. The death tile is adjacent to the Home portal, so
 * redeploying there keeps the wreck inside the reveal footprint.
 */
const seedPortalRespawn = seedSaveScript({
  x: HOME_PORTAL.x - 1, y: HOME_ROW,
  equipment: ['upgrade:drill:1', null],
  tiles: [DEEP_PORTAL_TILE],
  stations: [...WORKBENCHES, HOME_PORTAL, DEEP_PORTAL]
});

/**
 * The ship one tile east of a buried chest. Worldgen is deterministic, so the
 * first chest below the home cavern always lies at (41, 44) in its own one-tile air
 * pocket (see `chestAt` in `src/world/world.ts`) holding 1 Dynamite, 3 Coal and
 * 2 Iron (`chestLoot` in `src/core/chest.ts`). The tile diff digs out the ship's
 * own tile, (42, 44), with dirt beneath it so the ship sits still.
 */
const seedChest = seedSaveScript({
  x: 42, y: 44,
  tiles: [{x: 42, y: 44, tile: {type: 'air'}}],
  stations: WORKBENCHES
});

/**
 * The ship inside a grave's nook. Worldgen is deterministic, so the first grave
 * below the home cavern always lies at (21, 33), on the floor of its 3×2 air nook
 * (see `graveAt` in `src/world/world.ts`), with Praskovya Ivanova's epitaph
 * (`epitaphFor` in `src/core/grave.ts`). The ship parks one tile east of it, on the
 * nook floor, with solid ground beneath, so it sits still.
 */
const seedGrave = seedSaveScript({x: 22, y: 33, stations: WORKBENCHES});

/**
 * A plain save with $250 in the wallet — once per tab. Init scripts rerun on
 * every navigation, and the import under test reloads the page into the save it
 * just wrote, so an unguarded seed would overwrite the import on the way in.
 */
const seedSaveOnce = seedSaveScript({cash: 250, stations: WORKBENCHES}, {once: true});

/**
 * The home workbenches, the manufacturer stocked for a Fuel Tank Mk I (4 Iron,
 * 2 Copper) with coal to spare, and the extractor holding fuel — so one run can
 * craft, take, fit, load coal and refuel without a dig.
 */
const seedWorkshop = seedSaveScript({
  stations: [
    {...WORKBENCHES[0], items: [{kind: 'ore:Iron', count: 4}, {kind: 'ore:Copper', count: 2}, {kind: 'ore:Coal', count: 3}]},
    {...WORKBENCHES[1], fuel: 40}
  ]
});

/** A cargo container and three sticks of dynamite aboard, at the home base. */
const seedDeployables = seedSaveScript({
  bay: [{kind: 'container', count: 1}, {kind: 'dynamite', count: 3}],
  stations: WORKBENCHES
});

/** Units of `kind` in a slot list, or 0 when none. */
function countKind(slots: {kind: string; count: number}[], kind: string): number {
  return slots.find(slot => slot.kind === kind)?.count ?? 0;
}

test.describe.serial('agent harness', () => {
  let session: GameSession;

  test.beforeAll(async () => {
    session = await openGameSession({headless: true, port: PORT, initScript: seedDirtUnderHome});
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test('observes the ship at the home base', async () => {
    const observation = await session.observe();
    expect(observation.ship.x).toBe(45);
    expect(observation.ship.y).toBe(20);
    expect(observation.ship.atSurface).toBe(true);
    // The window is centred on the ship, which paints as `@`.
    expect(observation.view.rows.join('')).toContain('@');
  });

  test('pause freezes the tick between decisions', async () => {
    // The default real-time model keeps the sim frozen between actions.
    const before = await session.observe();
    await new Promise(resolve => setTimeout(resolve, 300));
    const after = await session.observe();
    expect(after.tick).toBe(before.tick);
  });

  test('starting the run brings the player into play', async () => {
    const observation = await session.startRun();
    expect(observation.phase).toBe('playing');
    expect(observation.gameOver).toBe(false);
  });

  test('Space at the home base opens the station overlay', async () => {
    const observation = await session.press(' ');
    expect(observation.activeOverlay).toBe('station');
    expect(observation.overlay?.kind).toBe('station');
    if (observation.overlay?.kind === 'station') {
      // The station mirror is only present while the screen is open.
      expect(Array.isArray(observation.overlay.recipes)).toBe(true);
    }
  });

  test('single-unit transfer controls move one item between station and bay', async () => {
    // The station Space opened is the manufacturer; its stock holds the seeded coal.
    const opened = await session.observe();
    expect(opened.overlay?.kind).toBe('station');
    if (opened.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(countKind(opened.overlay.stock, 'ore:Coal')).toBe(3);
    expect(countKind(opened.overlay.bay, 'ore:Coal')).toBe(0);

    // Take one coal aboard: the stock drops by one and the bay gains one.
    const took = await session.click({target: 'data-station', value: 'take-one', kind: 'ore:Coal'});
    if (took.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(countKind(took.overlay.stock, 'ore:Coal')).toBe(2);
    expect(countKind(took.overlay.bay, 'ore:Coal')).toBe(1);

    // Stow that one unit back: the deltas reverse exactly.
    const stowed = await session.click({target: 'data-station', value: 'stow-one', kind: 'ore:Coal'});
    if (stowed.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(countKind(stowed.overlay.stock, 'ore:Coal')).toBe(3);
    expect(countKind(stowed.overlay.bay, 'ore:Coal')).toBe(0);
  });

  test('a click or tile press that cannot land rejects fast and leaves the sim paused', async () => {
    // The station holds only coal, so the Repair Kit (3 Iron) craft button is disabled.
    const before = await session.observe();
    if (before.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(before.overlay.recipes.find(recipe => recipe.output === 'repairKit')?.craftable).toBe(false);

    const started = Date.now();
    await expect(session.click({target: 'data-craft', value: 'repairKit'})).rejects.toThrow(/disabled/);
    expect(Date.now() - started).toBeLessThan(1500);

    // The modal station screen sits over the HUD and the mine: a HUD button and a
    // tile press are both refused as covered, not left to time out.
    await expect(session.click('shipBtn')).rejects.toThrow(/covered by open overlay/);
    await expect(session.pressTile(before.ship.x, before.ship.y)).rejects.toThrow(/covered by the HUD\/overlay/);

    // Refused before the sim was ever unpaused, and still frozen afterwards.
    const after = await session.observe();
    expect(after.tick).toBe(before.tick);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect((await session.observe()).tick).toBe(before.tick);
  });

  test('type rejects without a focused text field', async () => {
    // Blur whatever the station screen focused, so nothing editable has focus.
    await session.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = await session.observe();
    await expect(session.type('hello')).rejects.toThrow(/focused text field/);
    expect((await session.observe()).tick).toBe(before.tick);
  });

  test('holding ArrowDown burns fuel and moves the view down', async () => {
    // Shut the station Space opened, so the key drives the mine again.
    const closed = await session.press(' ');
    expect(closed.activeOverlay).toBeNull();
    // No hand-refocusing of the mine: the harness routes every key press to the
    // game itself, whatever button or blurred body focus was left on.

    const before = await session.observe();
    const after = await session.hold('ArrowDown', 1200);
    // Every drill hit charges fuel, whether or not a tile cleared.
    expect(after.ship.fuel).toBeLessThan(before.ship.fuel);
    // The sim advanced while the key was held.
    expect(after.tick).toBeGreaterThan(before.tick);
    // Two hits clear the seeded dirt, so the ship stands a tile lower and the
    // window — origin fixed to the ship — has scrolled down with it.
    expect(after.ship.y).toBeGreaterThan(before.ship.y);
    expect(after.view.origin.y).toBeGreaterThan(before.view.origin.y);
    // The tile the `@` hides is spelled out: the ship stands in the hole it dug.
    expect(after.ship.on.tile).toBe('air');
  });

  test('every info tab switches with data-info-section and mirrors its contents', async () => {
    let obs = await session.click('infoBtn');
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.tab).toBe('info-objective');
    const sections = obs.overlay.sections;
    expect(sections.map(section => section.id)).toEqual([
      'info-objective', 'info-stats', 'info-prospecting', 'info-hazards', 'info-controls', 'info-settings'
    ]);

    // Walk the tablist backwards, so every click is a real switch.
    const field = {
      'info-objective': 'objective', 'info-stats': 'stats', 'info-prospecting': 'prospecting',
      'info-hazards': 'hazards', 'info-controls': 'controls', 'info-settings': 'settings'
    } as const;
    for (let index = sections.length - 1; index >= 0; index--) {
      const section = nth(sections, index);
      obs = await session.click({target: 'data-info-section', value: section.id});
      if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
      expect(obs.overlay.tab).toBe(section.id);
      // Exactly the visible tab's contents are mirrored.
      for (const [tab, key] of Object.entries(field)) {
        expect(obs.overlay[key] === undefined, `${key} on ${section.id}`).toBe(tab !== section.id);
      }
    }
    if (obs.overlay?.kind !== 'info' || !obs.overlay.objective) throw new Error('the objective tab expected last');
    expect(obs.overlay.objective.status.length).toBeGreaterThan(0);
  });

  test('Settings flags, the cheat grants and the reset confirm show in the observation', async () => {
    let obs = await session.click({target: 'data-info-section', value: 'info-settings'});
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.settings).toEqual({cheatsOpen: false, confirmingReset: false, confirmingImport: false});

    // The cheat disclosure, then a valueless attribute control inside it.
    obs = await session.click('cheatsToggleBtn');
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.settings?.cheatsOpen).toBe(true);
    const cargoBefore = obs.ship.cargo;
    obs = await session.click('data-developer-grant-ores');
    expect(obs.ship.cargo).toBeGreaterThan(cargoBefore);
    expect(obs.bay.some(slot => slot.kind === 'ore:Iron')).toBe(true);

    // Reset asks first, and Cancel stands it down — nothing reloads.
    obs = await session.click('resetGameBtn');
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.settings?.confirmingReset).toBe(true);
    obs = await session.click('resetGameCancelBtn');
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.settings?.confirmingReset).toBe(false);

    // The audio switches read back at the top level. Unlocking audio is async, so
    // the readback is polled rather than taken from the click's own observation.
    const sfxBefore = obs.audio.sfx;
    await session.click('settingsSfxBtn');
    await expect.poll(async () => (await session.observe()).audio.sfx).toBe(!sfxBefore);
    await session.click('settingsSfxBtn');
    await expect.poll(async () => (await session.observe()).audio.sfx).toBe(sfxBefore);
    obs = await session.observe();
    expect(obs.audio.sfxLabel.length).toBeGreaterThan(0);

    // Leaving the tab drops the disclosure.
    obs = await session.click({target: 'data-info-section', value: 'info-stats'});
    obs = await session.click({target: 'data-info-section', value: 'info-settings'});
    if (obs.overlay?.kind !== 'info') throw new Error('info overlay expected');
    expect(obs.overlay.settings?.cheatsOpen).toBe(false);

    obs = await session.press('Escape');
    expect(obs.activeOverlay).toBeNull();
    expect(obs.runtime).toEqual({status: 'ready', error: null});
  });

  test('+ and - step the camera zoom, and the inventory panel folds', async () => {
    let obs = await session.observe();
    const start = obs.view.zoom.level;
    expect(obs.view.zoom).toMatchObject({min: 0.5, max: 2});
    obs = await session.press('+');
    expect(obs.view.zoom.level).toBeGreaterThan(start);
    obs = await session.press('-');
    expect(obs.view.zoom.level).toBe(start);

    expect(obs.hud.inventoryCollapsed).toBe(false);
    obs = await session.click('inventoryToggleBtn');
    expect(obs.hud.inventoryCollapsed).toBe(true);
    obs = await session.click('inventoryToggleBtn');
    expect(obs.hud.inventoryCollapsed).toBe(false);
    // The click left focus on the toggle; a key press still reaches the mine.
    obs = await session.press('+');
    expect(obs.view.zoom.level).toBeGreaterThan(start);
    obs = await session.press('-');
    expect(obs.view.zoom.level).toBe(start);
  });
});

test('a crafted upgrade is taken from the station, fitted, unfitted, and the extractor loads coal and refuels', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedWorkshop});
  try {
    await s.startRun();

    // Craft a Fuel Tank Mk I at the manufacturer and take it aboard, with the coal.
    let obs = await s.pressTile(STATIONS.manufacturer.x, STATIONS.manufacturer.y);
    if (obs.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(obs.overlay.recipes.find(recipe => recipe.output === 'upgrade:tank:1')?.craftable).toBe(true);
    obs = await s.click({target: 'data-craft', value: 'upgrade:tank:1'});
    if (obs.overlay?.kind !== 'station') throw new Error('station overlay expected');
    expect(countKind(obs.overlay.stock, 'upgrade:tank:1')).toBe(1);
    obs = await s.click({target: 'data-station', value: 'take', kind: 'upgrade:tank:1'});
    obs = await s.click({target: 'data-station', value: 'take', kind: 'ore:Coal'});
    expect(countKind(obs.bay, 'upgrade:tank:1')).toBe(1);
    expect(countKind(obs.bay, 'ore:Coal')).toBe(3);
    obs = await s.press('Escape');
    expect(obs.activeOverlay).toBeNull();

    // Fit it from the Ship screen: the tank grows, and the fuel does not.
    const fuelMaxBefore = obs.ship.fuelMax;
    obs = await s.click('shipBtn');
    if (obs.overlay?.kind !== 'ship') throw new Error('ship overlay expected');
    expect(obs.overlay.fittable.map(slot => slot.kind)).toContain('upgrade:tank:1');
    obs = await s.click({target: 'data-ship-equip', value: 'upgrade:tank:1'});
    if (obs.overlay?.kind !== 'ship') throw new Error('ship overlay expected');
    const fitted = obs.overlay.slots.find(slot => slot.kind === 'upgrade:tank:1');
    if (!fitted) throw new Error('the tank should be fitted');
    expect(obs.ship.equipment[fitted.index]).toBe('upgrade:tank:1');
    expect(obs.ship.fuelMax).toBeGreaterThan(fuelMaxBefore);

    // Unfit it by slot index, then fit it again.
    obs = await s.click({target: 'data-ship-unequip', value: String(fitted.index)});
    expect(obs.ship.equipment).not.toContain('upgrade:tank:1');
    expect(countKind(obs.bay, 'upgrade:tank:1')).toBe(1);
    obs = await s.click({target: 'data-ship-equip', value: 'upgrade:tank:1'});
    expect(obs.ship.equipment).toContain('upgrade:tank:1');
    obs = await s.click('shipCloseBtn');
    expect(obs.activeOverlay).toBeNull();
    expect(obs.ship.fuel).toBeLessThan(obs.ship.fuelMax);

    // The extractor: load the coal aboard, then refuel from its stored fuel.
    obs = await s.pressTile(STATIONS.extractor.x, STATIONS.extractor.y);
    if (obs.overlay?.kind !== 'extractor') throw new Error('extractor overlay expected');
    const coalBefore = obs.overlay.coal;
    obs = await s.click('loadCoalBtn');
    if (obs.overlay?.kind !== 'extractor') throw new Error('extractor overlay expected');
    expect(obs.overlay.coal).toBe(coalBefore + 3);
    expect(countKind(obs.bay, 'ore:Coal')).toBe(0);
    expect(obs.overlay.refuelAmount).toBeGreaterThan(0);
    const fuelBefore = obs.ship.fuel;
    const refuel = obs.overlay.refuelAmount;
    obs = await s.click('refuelBtn');
    expect(Math.round(obs.ship.fuel)).toBe(Math.round(fuelBefore + refuel));
  } finally {
    await s.close();
  }
});

test('a container stores and returns a stack, and armed dynamite plants on a valid site by tile press', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedDeployables});
  try {
    let obs = await s.startRun();
    const {x, y} = obs.ship;
    expect(obs.placement).toBeNull();

    // Arm the container: the observation lists where it may go.
    obs = await s.click('containerSlotBtn');
    expect(obs.armedPlacement).toBe('container');
    if (!obs.placement) throw new Error('a placement preview expected');
    expect(obs.placement.kind).toBe('container');
    // Set it down beside the ship, clear of the two workbenches.
    const stations = new Set(WORKBENCHES.map(station => `${station.x},${station.y}`));
    const site = obs.placement.sites.find(spot => Math.abs(spot.x - x) <= 1 && Math.abs(spot.y - y) <= 1 && !stations.has(`${spot.x},${spot.y}`));
    if (!site) throw new Error('a container site beside the ship expected');
    obs = await s.pressTile(site.x, site.y);
    expect(obs.armedPlacement).toBeNull();
    expect(obs.placement).toBeNull();
    expect(obs.notable).toContainEqual({x: site.x, y: site.y, what: 'container', detail: 'empty'});

    // `c` opens it; store a whole stack, then take one back.
    obs = await s.press('c');
    if (obs.overlay?.kind !== 'container') throw new Error('container overlay expected');
    obs = await s.click({target: 'data-cargo', value: 'store', kind: 'dynamite'});
    if (obs.overlay?.kind !== 'container') throw new Error('container overlay expected');
    expect(countKind(obs.overlay.container, 'dynamite')).toBe(3);
    expect(countKind(obs.bay, 'dynamite')).toBe(0);
    obs = await s.click({target: 'data-cargo', value: 'take-one', kind: 'dynamite'});
    if (obs.overlay?.kind !== 'container') throw new Error('container overlay expected');
    expect(countKind(obs.overlay.container, 'dynamite')).toBe(2);
    expect(countKind(obs.bay, 'dynamite')).toBe(1);
    obs = await s.press('c');
    expect(obs.activeOverlay).toBeNull();

    // `e` arms the stick. A press on the solid floor under the ship is refused:
    // it stays armed, and the preview reports the targeted tile as invalid.
    obs = await s.press('e');
    expect(obs.armedPlacement).toBe('dynamite');
    if (!obs.placement) throw new Error('a placement preview expected');
    expect(obs.placement.sites).not.toContainEqual({x, y: y + 1});
    obs = await s.pressTile(x, y + 1);
    expect(obs.armedPlacement).toBe('dynamite');
    expect(obs.placement).toMatchObject({target: {x, y: y + 1}, valid: false});

    // A press on a listed site plants it: a burning fuse in notable, the bay a stick lighter.
    // Off the ship's own tile (which notable never lists) and off the crate's.
    const target = obs.placement!.sites.find(spot => !(spot.x === site.x && spot.y === site.y) && !(spot.x === x && spot.y === y));
    if (!target) throw new Error('a dynamite site expected');
    obs = await s.pressTile(target.x, target.y);
    expect(obs.armedPlacement).toBeNull();
    expect(countKind(obs.bay, 'dynamite')).toBe(0);
    expect(obs.notable.some(n => n.what === 'dynamite' && n.x === target.x && n.y === target.y)).toBe(true);
  } finally {
    await s.close();
  }
});

test('a trading post buys ore for cash and sells its stock into the bay', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedTradingPost});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(POST.x);
    expect(obs.ship.y).toBe(POST.y);

    // The post sits under the ship; take iron aboard from the neighbouring station.
    obs = await s.pressTile(POST.x + 1, POST.y);
    expect(obs.overlay?.kind).toBe('station');
    obs = await s.click({target: 'data-station', value: 'take', kind: 'ore:Iron'});
    expect(countKind(obs.bay, 'ore:Iron')).toBe(10);
    await s.press('Escape');

    // Open the trading post and sell the iron: the wallet in hud.cash rises.
    obs = await s.pressTile(POST.x, POST.y);
    expect(obs.overlay?.kind).toBe('trade');
    const cashBefore = obs.hud.cash;
    obs = await s.click({target: 'data-trade', value: 'sell', kind: 'ore:Iron'});
    expect(obs.hud.cash).toBeGreaterThan(cashBefore);
    expect(countKind(obs.bay, 'ore:Iron')).toBe(0);

    // Buy an offered item; it lands in the bay and its stock drops.
    if (obs.overlay?.kind !== 'trade') throw new Error('trade overlay expected');
    const offer = nth(obs.overlay.buy, 0);
    obs = await s.click({target: 'data-trade', value: 'buy', kind: offer.kind});
    expect(countKind(obs.bay, offer.kind)).toBeGreaterThanOrEqual(1);
    if (obs.overlay?.kind !== 'trade') throw new Error('trade overlay expected');
    expect(obs.overlay.buy[0]?.stock).toBe(offer.stock - 1);
  } finally {
    await s.close();
  }
});

test('a hand reset leaves a wreck whose fitted upgrade can be salvaged back aboard', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedFittedUpgrade});
  try {
    await s.startRun();
    let obs = await s.observe();
    // The seeded ship parks at the home base with the drill upgrade fitted.
    expect(obs.ship.equipment).toContain('upgrade:drill:1');
    const {x, y} = obs.ship;

    // A hand R-reset (two presses within the confirm window) scraps the ship,
    // leaving its fitted upgrade in a wreck on the tile it stood on.
    await s.press('r');
    obs = await s.press('r');
    expect(obs.ship.equipment).not.toContain('upgrade:drill:1');

    // Open the wreck under the replacement ship and salvage everything.
    obs = await s.pressTile(x, y);
    expect(obs.overlay?.kind).toBe('wreck');
    if (obs.overlay?.kind !== 'wreck') throw new Error('wreck overlay expected');
    expect(countKind(obs.overlay.wreck, 'upgrade:drill:1')).toBe(1);

    obs = await s.click('lootAllBtn');
    // The upgrade is back in the bay as an unequipped item, and the emptied wreck
    // is gone — its overlay closed with it.
    expect(countKind(obs.bay, 'upgrade:drill:1')).toBe(1);
    expect(obs.activeOverlay).toBeNull();
  } finally {
    await s.close();
  }
});

test('a buried chest opens with c or a tile press, and loot-all hauls it aboard until it is gone', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedChest});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(42);
    expect(obs.ship.y).toBe(44);
    // The chest beside the ship paints as H and is notable with its loot count.
    expect(obs.notable).toContainEqual({x: 41, y: 44, what: 'chest', detail: '6 items'});
    expect(obs.view.rows[obs.ship.y - obs.view.origin.y]?.[41 - obs.view.origin.x]).toBe('H');

    // `c` alongside opens it, and `c` again shuts it.
    obs = await s.press('c');
    expect(obs.overlay?.kind).toBe('chest');
    obs = await s.press('c');
    expect(obs.activeOverlay).toBeNull();

    // A press on its tile opens the take-only menu with the rolled loot.
    obs = await s.pressTile(41, 44);
    expect(obs.overlay?.kind).toBe('chest');
    if (obs.overlay?.kind !== 'chest') throw new Error('chest overlay expected');
    expect(countKind(obs.overlay.chest, 'ore:Coal')).toBe(3);
    expect(countKind(obs.overlay.chest, 'ore:Iron')).toBe(2);
    expect(countKind(obs.overlay.chest, 'dynamite')).toBe(1);

    // One unit first: the chest stays, one item lighter.
    obs = await s.click({target: 'data-cargo', value: 'take-one', kind: 'ore:Coal'});
    if (obs.overlay?.kind !== 'chest') throw new Error('chest overlay expected');
    expect(countKind(obs.overlay.chest, 'ore:Coal')).toBe(2);
    expect(countKind(obs.bay, 'ore:Coal')).toBe(1);

    // Then everything: the bay grows by the rest, the menu closes, the chest is gone.
    const cargoBefore = obs.ship.cargo;
    obs = await s.click('lootAllBtn');
    expect(obs.ship.cargo).toBe(cargoBefore + 5);
    expect(countKind(obs.bay, 'ore:Coal')).toBe(3);
    expect(countKind(obs.bay, 'dynamite')).toBe(1);
    expect(obs.activeOverlay).toBeNull();
    expect(obs.notable.some(n => n.what === 'chest')).toBe(false);
    expect(obs.view.rows[obs.ship.y - obs.view.origin.y]?.[41 - obs.view.origin.x]).toBe('.');
  } finally {
    await s.close();
  }
});

test('a grave reads with Space or a tile press, and OK, Enter or Escape put it away', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedGrave});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(22);
    expect(obs.ship.y).toBe(33);
    // The grave beside the ship paints as + and is notable.
    expect(obs.notable).toContainEqual({x: 21, y: 33, what: 'grave'});
    expect(obs.view.rows[obs.ship.y - obs.view.origin.y]?.[21 - obs.view.origin.x]).toBe('+');
    expect(obs.view.legend['+']).toBe('grave');

    // Space beside it raises the stone, with every field filled in.
    obs = await s.press(' ');
    expect(obs.overlay).toEqual({kind: 'grave', name: 'Praskovya Ivanova', born: 1939, died: 1983, cause: 'Ran dry at 130 m'});
    if (obs.overlay?.kind !== 'grave') throw new Error('grave overlay expected');
    expect(obs.overlay.name.length).toBeGreaterThan(0);
    expect(obs.overlay.cause.length).toBeGreaterThan(0);
    expect(obs.overlay.born).toBeLessThan(obs.overlay.died);

    // OK puts it away.
    obs = await s.click('graveOkBtn');
    expect(obs.overlay).toBeNull();
    expect(obs.activeOverlay).toBeNull();

    // A press on its tile raises it again, and Enter puts it away.
    obs = await s.pressTile(21, 33);
    expect(obs.overlay?.kind).toBe('grave');
    obs = await s.press('Enter');
    expect(obs.activeOverlay).toBeNull();

    // And Escape does too; the ship never moved through any of it.
    obs = await s.press(' ');
    expect(obs.overlay?.kind).toBe('grave');
    obs = await s.press('Escape');
    expect(obs.activeOverlay).toBeNull();
    expect(obs.ship.x).toBe(22);
    expect(obs.ship.y).toBe(33);
  } finally {
    await s.close();
  }
});

test('Space at a portal opens the travel list and a pick jumps the ship there', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedPortalTravel});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(HOME_PORTAL.x + 1);
    expect(obs.ship.y).toBe(20);

    // The Home portal is the ship's only station in reach: Space opens travel.
    obs = await s.press(' ');
    expect(obs.activeOverlay).toBe('portal');
    expect(obs.overlay?.kind).toBe('portal');
    if (obs.overlay?.kind !== 'portal') throw new Error('portal overlay expected');
    expect(obs.overlay.mode).toBe('travel');
    const deep = obs.overlay.destinations.find(destination => destination.name === 'Deep');
    if (!deep) throw new Error('the Deep portal should be listed as a destination');
    expect(deep.depth).toBe(40);

    // Jump to the Deep portal: the overlay closes and the ship lands on its tile.
    obs = await s.click({target: 'data-portal', value: `${deep.x},${deep.y}`});
    expect(obs.activeOverlay).toBeNull();
    expect(obs.ship.x).toBe(deep.x);
    expect(obs.ship.y).toBe(deep.y);
    // The Home portal, four rows up and still explored, paints as `P`.
    expect(obs.view.rows.join('')).toContain('P');
  } finally {
    await s.close();
  }
});

test('a portal can be renamed from the travel overlay', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedPortalTravel});
  try {
    await s.startRun();
    let obs = await s.press(' ');
    expect(obs.overlay?.kind).toBe('portal');

    // Focus the name field, clear it, type a new name, and save.
    await s.click('portalNameInput');
    await s.press('Control+A');
    await s.type('Depot');
    obs = await s.click('portalNameSaveBtn');

    expect(obs.overlay?.kind).toBe('portal');
    if (obs.overlay?.kind !== 'portal') throw new Error('portal overlay expected');
    expect(obs.overlay.name).toBe('Depot');
    // The renamed portal, one tile from the ship, carries the new name in notable.
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Portal "Depot"')).toBe(true);
  } finally {
    await s.close();
  }
});

test('a carried teleporter opens the portal list and a pick spends one charge', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedPortalTeleporter});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.hud.teleport.count).toBe(2);
    const before = obs.hud.teleport.count;

    // Away from every portal, `t` opens the teleporter list of portals out of reach.
    obs = await s.press('t');
    expect(obs.overlay?.kind).toBe('portal');
    if (obs.overlay?.kind !== 'portal') throw new Error('portal overlay expected');
    expect(obs.overlay.mode).toBe('teleporter');
    const target = nth(obs.overlay.destinations, 0);
    if (!target) throw new Error('a portal out of reach should be listed');

    // Picking one moves the ship there and consumes a single charge.
    obs = await s.click({target: 'data-portal', value: `${target.x},${target.y}`});
    expect(obs.ship.x).toBe(target.x);
    expect(obs.ship.y).toBe(target.y);
    expect(obs.hud.teleport.count).toBe(before - 1);
  } finally {
    await s.close();
  }
});

test('a hand reset with two portals raises the no-close respawn prompt', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedPortalRespawn});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(HOME_PORTAL.x - 1);
    expect(obs.ship.y).toBe(20);

    // Two presses within the confirm window scrap the ship; with two portals built,
    // the reset raises the respawn prompt rather than redeploying at once.
    await s.press('r');
    obs = await s.press('r');
    expect(obs.overlay?.kind).toBe('portal');
    if (obs.overlay?.kind !== 'portal') throw new Error('portal overlay expected');
    expect(obs.overlay.mode).toBe('respawn');

    // The respawn prompt has no way out: Escape leaves it up.
    obs = await s.press('Escape');
    expect(obs.overlay?.kind).toBe('portal');
    if (obs.overlay?.kind !== 'portal') throw new Error('portal overlay expected');
    expect(obs.overlay.mode).toBe('respawn');

    // Pick the nearest portal: the ship redeploys there, alive, and the scrapped
    // ship's wreck stands on the tile it died on.
    const target = nth(obs.overlay.destinations, 0);
    obs = await s.click({target: 'data-portal', value: `${target.x},${target.y}`});
    expect(obs.gameOver).toBe(false);
    expect(obs.ship.x).toBe(target.x);
    expect(obs.ship.y).toBe(target.y);
    expect(obs.view.rows.join('')).toContain('W');
  } finally {
    await s.close();
  }
});

test('the construction toolkit lifts a placed extractor, and it can be set back down', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedToolkitScenario});
  try {
    await s.startRun();
    // The seeded extractor stands at (46,20), one tile from the spawn at (45,20),
    // and its tile is inside the spawn's reveal footprint, so it paints as `X`.
    let obs = await s.observe();
    expect(obs.view.rows.join('')).toContain('X');
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Fuel Extractor')).toBe(true);
    // The HUD's base line reads the empty home extractor, and flags it as unable to fill a tank.
    expect(obs.hud.base).toEqual({fuel: 0, coal: 0, alert: true});

    // Arm the toolkit from its slot and lift the empty extractor into the bay.
    await s.click('toolkitSlotBtn');
    obs = await s.pressTile(46, 20);
    expect(obs.view.rows.join('')).not.toContain('X');
    expect(obs.bay.some(slot => slot.kind === 'device:extractor')).toBe(true);
    // No extractor stands at home any more, so there is no base line.
    expect(obs.hud.base).toBeNull();

    // The lifted extractor is aboard; arm it and set it back down where it was.
    await s.click('extractorSlotBtn');
    obs = await s.pressTile(46, 20);
    expect(obs.view.rows.join('')).toContain('X');
    expect(obs.hud.base).toEqual({fuel: 0, coal: 0, alert: true});
  } finally {
    await s.close();
  }
});

test('Settings exports the save into the observation and imports an edited one across a reload', async () => {
  const s = await openGameSession({headless: true, port: PORT, initScript: seedSaveOnce});
  try {
    let obs = await s.startRun();
    expect(obs.hud.cash).toBe(250);

    // Info → Settings, then Export: the save text lands in the info overlay.
    await s.click('infoBtn');
    obs = await s.click({target: 'data-info-section', value: 'info-settings'});
    expect(obs.overlay).toMatchObject({kind: 'info', tab: 'info-settings'});
    expect(obs.overlay && 'saveExport' in obs.overlay).toBe(false);
    obs = await s.click('exportSaveBtn');
    if (obs.overlay?.kind !== 'info' || !obs.overlay.saveExport) throw new Error('an exported save expected');
    expect(obs.overlay.saveExport).toContain(`"version":${SAVE_VERSION}`);
    const exported = JSON.parse(obs.overlay.saveExport) as {cash: number};
    expect(exported.cash).toBe(250);

    // An older version is refused with a toast, and nothing reloads.
    await s.click('importSaveText');
    await s.type('{"version":17,"cash":9000}');
    obs = await s.click('importSaveBtn');
    // The inline confirm is up, and the observation says so.
    expect(obs.overlay?.kind === 'info' && obs.overlay.settings?.confirmingImport).toBe(true);
    obs = await s.click('importSaveConfirmBtn');
    expect(obs.toasts.at(-1)?.message).toContain('version 17');
    expect(obs.phase).toBe('playing');
    expect(obs.hud.cash).toBe(250);

    // Paste the export back with the wallet changed, and confirm: the page reloads
    // into the imported run.
    await s.click('importSaveText');
    await s.press('Control+A');
    await s.type(JSON.stringify({...exported, cash: 4321}));
    obs = await s.click('importSaveBtn');
    expect(obs.phase).toBe('playing');
    // The click returns once the reloaded game is back, on its title splash.
    obs = await s.click('importSaveConfirmBtn');
    expect(obs.phase).toBe('intro');
    expect(obs.cash).toBe(4321);
    obs = await s.startRun();
    expect(obs.phase).toBe('playing');
    expect(obs.hud.cash).toBe(4321);
    expect(obs.cash).toBe(4321);
  } finally {
    await s.close();
  }
});
