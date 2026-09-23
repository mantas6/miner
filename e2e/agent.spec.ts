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
import { openGameSession, type GameSession } from '../agent/session';

/** The port the Playwright config's webServer serves the game on. */
const PORT = 5199;

/**
 * Seed a solo save with a soft dirt tile directly under the spawn (45, 21), and a
 * few coal in the manufacturer's stock so the transfer controls have something to
 * move. The two default stations are seeded at their home-cavern positions.
 */
function seedDirtUnderHome(): void {
  localStorage.setItem('moleload-progress-v1', JSON.stringify({
    version: 17,
    tiles: [{x: 45, y: 21, tile: {type: 'dirt', hp: 2, maxHp: 2}}],
    stations: [
      {kind: 'manufacturer', x: 44, y: 20, items: [{kind: 'ore:Coal', count: 3}]},
      {kind: 'extractor', x: 46, y: 20}
    ]
  }));
}

/**
 * Seed a solo save with a Construction Toolkit aboard and the two default stations
 * in place, so a test can lift the extractor and set it back down without first
 * crafting anything.
 */
function seedToolkitScenario(): void {
  localStorage.setItem('moleload-progress-v1', JSON.stringify({
    version: 17,
    bay: [{kind: 'toolkit', count: 1}],
    stations: [
      {kind: 'manufacturer', x: 44, y: 20, items: []},
      {kind: 'extractor', x: 46, y: 20}
    ]
  }));
}

/**
 * Seed the ship parked on a trading post. A post is generated deterministically at
 * (43, 67) with a cleared 3×3 air pocket (see `src/world/world.ts`), so parking the
 * ship there and putting a manufacturer holding iron one tile over gives the test
 * ore to sell without a dig, and cash to start the buy side.
 */
function seedTradingPost(): void {
  localStorage.setItem('moleload-progress-v1', JSON.stringify({
    version: 17,
    x: 43, y: 67,
    cash: 100,
    stations: [{kind: 'manufacturer', x: 44, y: 67, items: [{kind: 'ore:Iron', count: 10}]}]
  }));
}

/**
 * Seed the ship at the home base with a Drill Mk I fitted to its hull. Ore is never
 * persisted, so the fitted upgrade is the deterministic thing a reset will strip
 * into a wreck — exactly the loot the salvage path has to hand back.
 */
function seedFittedUpgrade(): void {
  localStorage.setItem('moleload-progress-v1', JSON.stringify({
    version: 17,
    equipment: ['upgrade:drill:1', null]
  }));
}

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

  test('holding ArrowDown burns fuel and moves the view down', async () => {
    // Shut the station Space opened, so the key drives the mine again.
    const closed = await session.press(' ');
    expect(closed.activeOverlay).toBeNull();
    // Closing the modal dropped focus to the body; put it back on the mine so the
    // held key reaches the ship rather than nothing.
    await session.page.locator('#game').focus();

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
  });
});

test('a trading post buys ore for cash and sells its stock into the bay', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedTradingPost});
  try {
    await s.startRun();
    let obs = await s.observe();
    expect(obs.ship.x).toBe(43);
    expect(obs.ship.y).toBe(67);

    // The post sits under the ship; take iron aboard from the neighbouring station.
    obs = await s.pressTile(44, 67);
    expect(obs.overlay?.kind).toBe('station');
    obs = await s.click({target: 'data-station', value: 'take', kind: 'ore:Iron'});
    expect(countKind(obs.bay, 'ore:Iron')).toBe(10);
    await s.press('Escape');

    // Open the trading post and sell the iron: the wallet in hud.cash rises.
    obs = await s.pressTile(43, 67);
    expect(obs.overlay?.kind).toBe('trade');
    const cashBefore = obs.hud.cash;
    obs = await s.click({target: 'data-trade', value: 'sell', kind: 'ore:Iron'});
    expect(obs.hud.cash).toBeGreaterThan(cashBefore);
    expect(countKind(obs.bay, 'ore:Iron')).toBe(0);

    // Buy an offered item; it lands in the bay and its stock drops.
    if (obs.overlay?.kind !== 'trade') throw new Error('trade overlay expected');
    const offer = obs.overlay.buy[0];
    obs = await s.click({target: 'data-trade', value: 'buy', kind: offer.kind});
    expect(countKind(obs.bay, offer.kind)).toBeGreaterThanOrEqual(1);
    if (obs.overlay?.kind !== 'trade') throw new Error('trade overlay expected');
    expect(obs.overlay.buy[0].stock).toBe(offer.stock - 1);
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

test('the construction toolkit lifts a placed extractor, and it can be set back down', async () => {
  const s = await openGameSession({headless: true, port: PORT, freshSave: true, initScript: seedToolkitScenario});
  try {
    await s.startRun();
    // The seeded extractor stands at (46,20), one tile from the spawn at (45,20),
    // and its tile is inside the spawn's reveal footprint, so it paints as `X`.
    let obs = await s.observe();
    expect(obs.view.rows.join('')).toContain('X');
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Oil Extractor')).toBe(true);

    // Arm the toolkit from its slot and lift the empty extractor into the bay.
    await s.click('toolkitSlotBtn');
    obs = await s.pressTile(46, 20);
    expect(obs.view.rows.join('')).not.toContain('X');
    expect(obs.bay.some(slot => slot.kind === 'device:extractor')).toBe(true);

    // The lifted extractor is aboard; arm it and set it back down where it was.
    await s.click('extractorSlotBtn');
    obs = await s.pressTile(46, 20);
    expect(obs.view.rows.join('')).toContain('X');
  } finally {
    await s.close();
  }
});
