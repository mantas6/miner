import { describe, expect, it, vi } from 'vitest';
import { HOME_ROW, HOME_X, ORES, START_Y, STATIONS, WORLD_W } from '../../shared/constants';
import { RESPAWN, STARTING } from '../core/balance';
import { addItem, addOre, countItem, countOres, createInventory } from '../core/inventory';
import { applyEquipment, swapHull } from '../core/ship-upgrades';
import { createInitialState } from '../core/state';
import { createExtractor, createPortal, homeExtractor, type ExtractorStation } from '../core/stations';
import { TELEPORTER_ITEM } from '../core/teleporter';
import { WRECK, createWreck } from '../core/wreck';
import type { GameState } from '../core/types';
import { createTileDiff } from '../world/tile-diff';
import { makeTile } from '../world/world';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { createEnemySim } from './enemies';
import { confirmPlayerDataReset, createRun, PLAYER_DATA_RESET_CONFIRMATION, type GameRun } from './run';
import {
  createAudioStub,
  createEnemySimStub,
  createFakeGrid,
  createInputStub,
  createPortalsSimStub,
  createToastLog,
  dugPortal,
  type AudioStub,
  type EnemySimStub,
  type PortalsSimStub
} from './test-support';
import { nth } from '../test-narrowing';

interface Harness {
  state: GameState;
  enemies: EnemySimStub;
  audio: AudioStub;
  input: ReturnType<typeof createInputStub>;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  invalidateFog: ReturnType<typeof vi.fn>;
  invalidateTerrain: ReturnType<typeof vi.fn>;
  revealAtPlayer: ReturnType<typeof vi.fn>;
  portals: PortalsSimStub;
  run: GameRun;
}

/** A miner mid-run: upgraded, loaded with cargo, and away from the home base. */
function harness(): Harness {
  const state = createInitialState();
  // Clear the seeded stations (which include the base's `Home` portal) so a plain
  // restart falls back to the home cavern; the portal-spawn tests seed their own.
  state.stations = [];
  Object.assign(state.player, {
    x: 12, y: 60, drawX: 12, drawY: 60,
    fuel: 30, hull: 25,
    // Fitted upgrades set the maxima mid-run; a death strips them back to base.
    equipment: ['upgrade:tank:1', 'upgrade:cargo:1', null],
    // Ore to lose with the ship, and equipment that survives it.
    inventory: addItem(
      addOre(addOre(createInventory(), nth(ORES, 0), 99)!, nth(ORES, 1), 99)!,
      TELEPORTER_ITEM
    )
  });
  applyEquipment(state.player);
  state.cash = 900;
  state.stats.maxDepth = 570;
  state.stats.oreMined = 7;
  state.exploredTiles.add(1234);
  const context = {
    state,
    enemies: createEnemySimStub(),
    audio: createAudioStub(),
    input: createInputStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    invalidateFog: vi.fn(),
    invalidateTerrain: vi.fn(),
    revealAtPlayer: vi.fn(),
    portals: createPortalsSimStub()
  };
  const run = createRun({
    state,
    audio: context.audio,
    enemies: () => context.enemies,
    input: () => context.input,
    portals: () => context.portals,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    revealAtPlayer: context.revealAtPlayer,
    spawnExplosion: vi.fn(),
    invalidateTerrain: context.invalidateTerrain,
    invalidateFog: context.invalidateFog
  });
  return {...context, run};
}

describe('hull damage', () => {
  it('subtracts hull, clamps at zero, and ends the run when the hull is gone', () => {
    const h = harness();

    h.run.damage(5);
    expect(h.state.player.hull).toBe(20);
    expect(h.state.gameOver).toBe(false);

    h.run.damage(999);
    expect(h.state.player.hull).toBe(0);
    expect(h.state.gameOver).toBe(true);
    expect(h.toasts.saw('Ship destroyed')).toBe(true);
  });
});

describe('death consequences', () => {
  it('banks the death and clears the teleport effect', () => {
    const h = harness();
    h.state.teleportEffect = {
      originScreenX: 1, originScreenY: 2, destinationX: 3, destinationY: 4,
      frame: 1, duration: 30, reducedMotion: false
    };

    h.run.gameOver();

    expect(h.state).toMatchObject({
      gameOver: true,
      teleportEffect: null
    });
    expect(h.state.stats.deaths).toBe(1);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toContain('alarm');
  });

  it('counts a death only once, no matter how many killers pile on', () => {
    const h = harness();

    h.run.gameOver('First');
    h.run.gameOver('Second');

    expect(h.state.stats.deaths).toBe(1);
    expect(h.toasts.messages).toEqual(['First']);
  });
});

/** The base's fuel extractor at its home-cavern tile, holding `fuel` in its store. */
function homeExtractorHolding(fuel: number): ExtractorStation {
  return {...createExtractor(STATIONS.extractor.x, STATIONS.extractor.y), fuel};
}

describe('restarting after a death', () => {
  it('keeps cash and stats but loses cargo, fitted upgrades, position and fuel burn', () => {
    const h = harness();
    const store = homeExtractorHolding(180);
    h.state.stations = [store];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.cash).toBe(900);
    expect(h.state.stats).toMatchObject({maxDepth: 570, oreMined: 7, deaths: 1});
    expect(h.state.exploredTiles.has(1234)).toBe(true);
    expect(h.state.player).toMatchObject({
      x: Math.floor(WORLD_W / 2),
      y: START_Y,
      // The fitted upgrades go down with the ship, so the maxima fall back to base;
      // the tank is filled out of the extractor's store, and the hull comes back half whole.
      fuel: STARTING.fuelMax,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax * RESPAWN.hullFraction,
      hullMax: STARTING.hullMax,
      cargoMax: STARTING.cargoMax
    });
    expect(store.fuel).toBe(80);
    expect(h.state.player.equipment).toEqual([null, null, null]);
    // Bay equipment is not cargo: the replacement ship keeps the teleporter.
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(h.state.gameOver).toBe(false);
    expect(h.input.reset).toHaveBeenCalled();
    // The lost ore and upgrades are left in a wreck, not simply lost, and the toast
    // names what the replacement deployed with and where its fuel came from.
    expect(h.toasts.last).toBe('Replacement ship deployed with 100/100 fuel drawn from the extractor, hull 50 %. '
      + 'Cargo and fitted upgrades left in the wreck at (12, 60).');
  });

  it('tops a store too dry for half a tank up to that share, and says how much it drew', () => {
    const h = harness();
    const store = homeExtractorHolding(20);
    h.state.stations = [store];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.player.fuel).toBe(STARTING.fuelMax * RESPAWN.homeFuelFraction);
    expect(store.fuel).toBe(0);
    expect(h.toasts.saw('Replacement ship deployed with 50/100 fuel (20 drawn from the extractor), hull 50 %.')).toBe(true);
  });

  it('deploys on half a tank with no fuel stored at the base', () => {
    const h = harness();
    // The harness clears the stations: no extractor stands at the base at all.
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.player.fuel).toBe(STARTING.fuelMax * RESPAWN.homeFuelFraction);
    expect(h.toasts.saw('Replacement ship deployed with 50/100 fuel (no fuel stored at the base), hull 50 %.')).toBe(true);
  });

  it('keeps the hull through a death, with every one of its slots empty and half its base hull', () => {
    const h = harness();
    swapHull(h.state.player, 'prospector');
    h.state.stations = [homeExtractorHolding(500)];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.player.ship).toBe('prospector');
    expect(h.state.player.equipment).toEqual([null, null, null, null, null]);
    expect(h.state.player).toMatchObject({fuel: 200, fuelMax: 200, hull: 75, hullMax: 150, cargoMax: 40, drill: 2});
    expect(homeExtractor(h.state.stations)?.fuel).toBe(300);
  });

  it('keeps the drawn-down trading stock through a death', () => {
    const h = harness();
    h.state.tradeLedger = {'40,120': [0, 1]};
    h.state.chestLedger = {'41,44': []};
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.tradeLedger).toEqual({'40,120': [0, 1]});
    // A looted chest stays looted through a death, too.
    expect(h.state.chestLedger).toEqual({'41,44': []});
  });

  it('regenerates the whole world and re-seeds enemy exposure', () => {
    const h = harness();
    h.state.world = [[{type: 'air'}]];

    h.run.restartGame();
    expect(h.state.world).toEqual([]);
    expect(h.enemies.resetExposure).toHaveBeenCalled();
  });

  it('digs the saved tunnels back out of the regenerated terrain', () => {
    const h = harness();
    const dug = {x: 40, y: 60, tile: {type: 'air'} as const};
    const cracked = {x: 41, y: 60, tile: {type: 'dirt', hp: 1, maxHp: 4} as const};
    h.state.tileDiff = createTileDiff([dug, cracked]);
    // A tile the miner never touched, to prove the seed still drives the rest.
    expect(makeTile(dug.x, dug.y)).not.toEqual(dug.tile);

    h.run.gameOver();
    h.run.restartGame();

    expect(h.state.world[dug.y]?.[dug.x]).toEqual(dug.tile);
    expect(h.state.world[cracked.y]?.[cracked.x]).toEqual(cracked.tile);
    expect(h.state.world[dug.y]?.[dug.x + 2]).toEqual(makeTile(dug.x + 2, dug.y));
    // The diff outlives the death, so the next one restores the same tunnels.
    expect(h.state.tileDiff).toEqual(createTileDiff([dug, cracked]));
  });

});

describe('scuttling a live ship by hand (R-R)', () => {
  it('counts as a death, and redeploys on the same rationed fuel and hull', () => {
    const h = harness();
    const store = homeExtractorHolding(60);
    h.state.stations = [store];

    h.run.restartGame();

    expect(h.state.stats.deaths).toBe(1);
    expect(h.toasts.saw('Ship scuttled.')).toBe(true);
    expect(h.audio.played).toContain('explosion');
    expect(h.state.gameOver).toBe(false);
    // No free refill and no free repair: the tank came out of the store, the hull is half.
    expect(h.state.player).toMatchObject({fuel: 60, hull: STARTING.hullMax * RESPAWN.hullFraction});
    expect(store.fuel).toBe(0);
    expect(h.toasts.last).toBe('Replacement ship deployed with 60/100 fuel drawn from the extractor, hull 50 %. '
      + 'Cargo and fitted upgrades left in the wreck at (12, 60).');
  });

  it('saves the scuttled ship broken, so a reload before the redeploy settles it as the death', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
    const atSave: number[] = [];
    h.saveProgress.mockImplementation(() => { atSave.push(h.state.player.hull); });

    h.run.restartGame();

    // The respawn prompt is up, and the game-over write holds a broken hull.
    expect(h.portals.openRespawn).toHaveBeenCalledOnce();
    expect(h.state.gameOver).toBe(true);
    expect(h.state.stats.deaths).toBe(1);
    expect(atSave).toEqual([0]);
  });

  it('counts each scuttle once, and a restart after a death adds none', () => {
    const h = harness();

    h.run.restartGame();
    h.run.restartGame();
    expect(h.state.stats.deaths).toBe(2);

    h.run.gameOver();
    h.run.restartGame();
    expect(h.state.stats.deaths).toBe(3);
  });
});

describe('redeploying at a portal after a restart', () => {
  it('redeploys at the home cavern with no portals standing', () => {
    const h = harness();
    // The harness clears the seeded stations, so no portal stands.
    h.run.gameOver();

    h.run.restartGame();

    expect(h.portals.openRespawn).not.toHaveBeenCalled();
    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y});
  });

  it('redeploys at the sole portal without prompting, with half a tank out in the field', () => {
    const h = harness();
    // The portal sits on a dug-out tile, carried back out by the diff.
    h.state.stations = [dugPortal(h.state, 30, 80, 'Deep')];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.portals.openRespawn).not.toHaveBeenCalled();
    expect(h.state.player).toMatchObject({
      x: 30,
      y: 80,
      fuel: STARTING.fuelMax * RESPAWN.portalFuelFraction,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax * RESPAWN.hullFraction
    });
    expect(h.state.gameOver).toBe(false);
    expect(h.toasts.saw('Replacement ship deployed at Portal "Deep" with 50/100 fuel, hull 50 %. Cargo and fitted upgrades left in the wreck at (12, 60).')).toBe(true);
  });

  it('never draws on the home extractor at a field portal', () => {
    const h = harness();
    const store = homeExtractorHolding(300);
    h.state.stations = [store, dugPortal(h.state, 30, 80, 'Deep')];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.player).toMatchObject({x: 30, y: 80, fuel: STARTING.fuelMax * RESPAWN.portalFuelFraction});
    expect(store.fuel).toBe(300);
  });

  it('draws from the extractor at a portal in the home cavern', () => {
    const h = harness();
    const store = homeExtractorHolding(300);
    h.state.stations = [store, createPortal(STATIONS.portal.x, STATIONS.portal.y, 'Home')];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.player).toMatchObject({
      x: STATIONS.portal.x, y: STATIONS.portal.y,
      fuel: STARTING.fuelMax, hull: STARTING.hullMax * RESPAWN.hullFraction
    });
    expect(store.fuel).toBe(200);
    expect(h.toasts.saw('Replacement ship deployed with 100/100 fuel drawn from the extractor, hull 50 %. Cargo and fitted upgrades left in the wreck at (12, 60).')).toBe(true);
  });

  it('words a scuttle at a field portal with its half tank, wreck or none', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Deep')];
    h.state.player.inventory = createInventory();
    h.state.player.equipment = [null, null, null];

    h.run.restartGame();

    expect(h.state.wrecks).toEqual([]);
    expect(h.state.player.fuel).toBe(50);
    expect(h.toasts.saw('Replacement ship deployed at Portal "Deep" with 50/100 fuel, hull 50 %. Cargo and fitted upgrades lost.')).toBe(true);
  });

  it('raises the no-close prompt with two or more portals, and the pick rebuilds', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
    h.run.gameOver();

    h.run.restartGame();

    // The prompt is up: no rebuild, no wreck, until the player chooses.
    expect(h.portals.openRespawn).toHaveBeenCalledOnce();
    expect(h.state.gameOver).toBe(true);
    expect(h.state.wrecks).toEqual([]);

    // Invoke the stored pick callback, as the overlay would on a choice.
    const onPick = nth(vi.mocked(h.portals.openRespawn).mock.calls, 0)[0] as (at: {x: number; y: number}) => void;
    onPick({x: 50, y: 100});

    // A field portal: the replacement deploys with half the base tank and hull.
    expect(h.state.player).toMatchObject({
      x: 50,
      y: 100,
      fuel: STARTING.fuelMax * RESPAWN.portalFuelFraction,
      hull: STARTING.hullMax * RESPAWN.hullFraction
    });
    expect(h.state.gameOver).toBe(false);
    // The wreck is dropped at the death tile before the world is rebuilt.
    expect(h.state.wrecks).toHaveLength(1);
    expect(h.state.wrecks[0]).toMatchObject({x: 12, y: 60});
  });
});

describe('wrecks dropped on restart', () => {
  it('a death leaves the ore and fitted upgrades in a wreck on the death tile', () => {
    const h = harness();
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.wrecks).toHaveLength(1);
    const wreck = nth(h.state.wrecks, 0);
    expect(wreck).toMatchObject({x: 12, y: 60});
    expect(countOres(wreck.inventory)).toBe(2);
    expect(countItem(wreck.inventory, 'upgrade:tank:1')).toBe(1);
    expect(countItem(wreck.inventory, 'upgrade:cargo:1')).toBe(1);
    // Non-ore bay equipment rides out with the miner, so it is never in the wreck.
    expect(countItem(wreck.inventory, TELEPORTER_ITEM.kind)).toBe(0);
    expect(h.saveProgress).toHaveBeenCalled();
  });

  it('a scuttle leaves a wreck too, like any other death', () => {
    const h = harness();

    h.run.restartGame();

    expect(h.state.wrecks).toHaveLength(1);
    expect(h.toasts.saw('Cargo and fitted upgrades left in the wreck at (12, 60)')).toBe(true);
  });

  it('drops no wreck when there is nothing to leave behind', () => {
    const h = harness();
    // Strip the ore and unfit every upgrade, leaving only surviving bay equipment.
    h.state.player.inventory = createInventory();
    h.state.player.equipment = [null, null, null];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.wrecks).toEqual([]);
    expect(h.toasts.saw('lost')).toBe(true);
  });

  it('keeps the mine bounded at the cap, dropping the oldest wreck', () => {
    const h = harness();
    h.state.wrecks = Array.from({length: WRECK.maxPlaced}, (_, i) => createWreck(i, 500, createInventory()));
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.wrecks).toHaveLength(WRECK.maxPlaced);
    // The oldest (x:0) is gone; the freshly dropped wreck sits at the death tile.
    expect(h.state.wrecks.some(w => w.x === 0 && w.y === 500)).toBe(false);
    expect(h.state.wrecks.at(-1)).toMatchObject({x: 12, y: 60});
  });

  it('writes the save once the replacement is final, never the corpse beside its own wreck', () => {
    const h = harness();
    const atSave: {equipment: unknown[]; wrecks: number}[] = [];
    h.saveProgress.mockImplementation(() => {
      atSave.push({equipment: [...h.state.player.equipment], wrecks: h.state.wrecks.length});
    });
    h.run.gameOver();
    atSave.length = 0;

    h.run.restartGame();

    // One write, after the replacement shed the upgrades the wreck now holds.
    expect(atSave).toEqual([{equipment: [null, null, null], wrecks: 1}]);
  });
});

describe('wrecks ageing with each death', () => {
  it('wears every standing wreck down, crumbles the spent ones, and drops the new one fresh', () => {
    const h = harness();
    h.state.wrecks = [
      createWreck(3, 90, addOre(createInventory(), nth(ORES, 0), 1)!, 1),
      createWreck(4, 90, addOre(createInventory(), nth(ORES, 0), 1)!, 2)
    ];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.state.wrecks.map(w => ({x: w.x, deathsLeft: w.deathsLeft}))).toEqual([
      {x: 4, deathsLeft: 1},
      {x: 12, deathsLeft: WRECK.lifetimeDeaths}
    ]);
    expect(h.toasts.saw('The wreck at (3, 90) crumbled to scrap.')).toBe(true);
    expect(h.toasts.saw('(4, 90) crumbled')).toBe(false);
  });

  it('ages them on a scuttle (R-R) too, which is counted as the death it is', () => {
    const h = harness();
    h.state.wrecks = [
      createWreck(3, 90, addOre(createInventory(), nth(ORES, 0), 1)!, 1),
      createWreck(4, 90, addOre(createInventory(), nth(ORES, 0), 1)!, 2)
    ];

    h.run.restartGame();

    expect(h.state.stats.deaths).toBe(1);
    expect(h.state.wrecks.map(w => ({x: w.x, deathsLeft: w.deathsLeft}))).toEqual([
      {x: 4, deathsLeft: 1},
      {x: 12, deathsLeft: WRECK.lifetimeDeaths}
    ]);
    expect(h.toasts.saw('The wreck at (3, 90) crumbled to scrap.')).toBe(true);
  });

  it('crumbles a fresh wreck on the third death after the one that dropped it', () => {
    const h = harness();
    h.run.gameOver();
    h.run.restartGame();
    const first = nth(h.state.wrecks, 0);
    expect(first.deathsLeft).toBe(WRECK.lifetimeDeaths);

    for (let death = 1; death <= WRECK.lifetimeDeaths; death++) {
      // Each replacement dies bare, so no new wreck muddies the count.
      h.state.player.inventory = createInventory();
      h.run.gameOver();
      h.run.restartGame();
      const standing = h.state.wrecks.find(w => w.x === first.x && w.y === first.y);
      if (death < WRECK.lifetimeDeaths) expect(standing?.deathsLeft).toBe(WRECK.lifetimeDeaths - death);
      else expect(standing).toBeUndefined();
    }
  });
});

describe('resuming a saved run', () => {
  it('resume keeps the saved fuel and hull, parked on the saved tile with no cargo', () => {
    const h = harness();
    h.state.tileDiff = createTileDiff([{x: 12, y: 60, tile: {type: 'air'}}]);

    h.run.resume();

    // The harness ship is at 30 fuel and 25 hull: a reload is no refill.
    expect(h.state.player).toMatchObject({
      x: 12, y: 60,
      fuel: 30,
      hull: 25,
      fuelMax: STARTING.fuelMax + 50
    });
    expect(h.state.player.equipment).toEqual(['upgrade:tank:1', 'upgrade:cargo:1', null]);
    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(h.state.cash).toBe(900);
    expect(h.toasts.saw(`${(60 - START_Y) * 10} m`)).toBe(true);
    // The camera opens on the ship instead of panning down from the home base.
    expect(h.state.camY).toBeGreaterThan(0);
  });

  it.each([
    ['an empty tank', {fuel: 0}],
    ['a broken hull', {hull: 0}]
  ])('a save taken while dead (%s) resumes at home, drawing on the extractor, as the death it recorded', (_name, vitals) => {
    const h = harness();
    const store = homeExtractorHolding(150);
    h.state.stations = [store];
    h.state.tileDiff = createTileDiff([{x: 12, y: 60, tile: {type: 'air'}}]);
    h.state.wrecks = [createWreck(3, 90, addOre(createInventory(), nth(ORES, 0), 1)!, 1)];
    Object.assign(h.state.player, vitals);

    h.run.resume();

    expect(h.state.player).toMatchObject({
      x: Math.floor(WORLD_W / 2), y: START_Y,
      fuel: STARTING.fuelMax, fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax * RESPAWN.hullFraction
    });
    expect(store.fuel).toBe(50);
    expect(h.state.gameOver).toBe(false);
    // The fitted upgrades went down with the ship: into a wreck on the death tile,
    // never back aboard, and the older wreck wore down as on any death.
    expect(h.state.player.equipment).toEqual([null, null, null]);
    expect(h.state.wrecks).toHaveLength(1);
    const wreck = nth(h.state.wrecks, 0);
    expect(wreck).toMatchObject({x: 12, y: 60, deathsLeft: WRECK.lifetimeDeaths});
    expect(countItem(wreck.inventory, 'upgrade:tank:1')).toBe(1);
    expect(h.toasts.saw('The wreck at (3, 90) crumbled to scrap.')).toBe(true);
    expect(h.toasts.saw('Replacement ship deployed with 100/100 fuel drawn from the extractor, hull 50 %. Cargo and fitted upgrades left in the wreck at (12, 60).')).toBe(true);
    // Written at once, so a second reload cannot drop the same upgrades again.
    expect(h.saveProgress).toHaveBeenCalledOnce();
  });

  it('digs the saved tunnels back out before placing the ship in them', () => {
    const h = harness();
    const dug = {x: 40, y: 60, tile: {type: 'air'} as const};
    h.state.tileDiff = createTileDiff([dug]);

    h.run.resume();

    expect(h.state.world[dug.y]?.[dug.x]).toEqual(dug.tile);
  });

  it('sends a ship parked inside a placed panel home', () => {
    const h = harness();
    h.state.tileDiff = createTileDiff([{x: 12, y: 60, tile: {type: 'decor', decor: 'steelPlate', hp: 48, maxHp: 48}}]);

    h.run.resume();

    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y});
  });

  it('returns a ship the mine has swallowed to the home base', () => {
    const h = harness();
    // No diff: a capped or quota-dropped save leaves the parked tile solid, and
    // a buried ship cannot drill upward out of it.
    expect(makeTile(12, 60).type).not.toBe('air');

    h.run.resume();

    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y, drawY: START_Y});
    expect(h.toasts.saw('Fresh drill deployed')).toBe(true);
  });

  it('boots a save with no position at the home base, as a new game always did', () => {
    const h = harness();
    Object.assign(h.state.player, {x: Math.floor(WORLD_W / 2), y: START_Y});

    h.run.resume();

    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y});
    expect(h.toasts.messages).toEqual(['Fresh drill deployed.']);
  });
});

describe('a full player reset', () => {
  it('returns every upgrade, the wallet, the fog and the stats to their starting values', () => {
    const h = harness();

    h.run.resetPlayer(true);

    expect(h.state.cash).toBe(STARTING.cash);
    expect(h.state.player).toMatchObject({
      fuelMax: STARTING.fuelMax,
      hullMax: STARTING.hullMax,
      cargoMax: STARTING.cargoMax,
      drill: STARTING.drill
    });
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(0);
    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(h.state.exploredTiles.size).toBe(0);
    expect(h.state.stats).toMatchObject({maxDepth: 0, oreMined: 0, deaths: 0});
    expect(h.invalidateFog).toHaveBeenCalled();
  });

  it('returns a bigger hull to the Scout', () => {
    const h = harness();
    swapHull(h.state.player, 'leviathan');

    h.run.resetPlayer(true);

    expect(h.state.player.ship).toBe('scout');
    expect(h.state.player.equipment).toEqual([null, null, null]);
    expect(h.state.player).toMatchObject({fuelMax: STARTING.fuelMax, cargoMax: STARTING.cargoMax});
  });

  it('clears every player/profile field back to a new game, and leaves saving to the caller', () => {
    const h = harness();
    Object.assign(h.state.player, {
      x: 8, y: 80, drawX: 7, drawY: 79, facing: -1, bob: 1, drillAnim: 2,
      drillDx: 1, drillDy: 0, fuel: 2, hull: 3,
      inventory: addItem(
        addItem(addOre(createInventory(), nth(ORES, 3), 80)!, DYNAMITE_ITEM, 2),
        TELEPORTER_ITEM,
        8
      )
    });
    h.state.gameOver = true;
    h.state.particles.push({x: 1, y: 1, vx: 1, vy: 1, life: 1, color: '#fff', size: 1});
    h.state.stats = {maxDepth: 900, totalCashEarned: 800, oreMined: 7, enemiesDestroyed: 5, deaths: 4, scannersObtained: 2, bestMarkCrafted: 2, oresMined: {Gold: 3}};
    h.state.scannerDevices = [{x: 3, y: 40, timer: 9}];
    h.state.cargoContainers = [{x: 4, y: 40, inventory: createInventory()}];
    h.state.wrecks = [createWreck(5, 40, addOre(createInventory(), nth(ORES, 0), 1)!)];
    h.state.stations = [createPortal(50, 100, 'Deep')];
    h.state.input.resetConfirmUntil = 999;

    h.run.resetPlayer(true);

    const fresh = createInitialState();
    expect(h.state.player).toEqual(fresh.player);
    expect(h.state).toMatchObject({
      cash: fresh.cash, gameOver: false, particles: [], stats: fresh.stats,
      teleportEffect: null, input: fresh.input,
      scannerDevices: [], placedDynamite: [], cargoContainers: [], wrecks: [],
      stations: fresh.stations
    });
    // `toMatchObject` reads `{}` as "any object", so the per-ore tally is checked exactly.
    expect(h.state.stats.oresMined).toEqual({});
    expect(h.state.exploredTiles.size).toBe(0);
    expect(h.revealAtPlayer).toHaveBeenCalled();
    expect(h.saveProgress).not.toHaveBeenCalled();
  });

  it('clears the trading stock ledger, which a plain death would have kept', () => {
    const h = harness();
    h.state.tradeLedger = {'40,120': [0, 1]};
    h.state.chestLedger = {'41,44': []};

    h.run.resetPlayer(true);

    expect(h.state.tradeLedger).toEqual({});
    expect(h.state.chestLedger).toEqual({});
  });

  it('preserves the current world, its tile diff and the live enemies', () => {
    const h = harness();
    const world = [[{type: 'air'}]] as typeof h.state.world;
    const diff = createTileDiff([{x: 40, y: 60, tile: {type: 'air'}}]);
    const enemies = [{id: 9, kind: 'tunnelFiend' as const, x: 1, y: 2, drawX: 1, drawY: 2, hp: 3, maxHp: 4, alive: true, moveTick: 2, biteTick: 1, flash: 0, origin: {x: 1, y: 2}}];
    h.state.world = world;
    h.state.tileDiff = diff;
    h.state.enemies = enemies;

    h.run.resetPlayer(true);

    expect(h.state.world).toBe(world);
    expect(h.state.tileDiff).toBe(diff);
    expect(h.state.enemies).toBe(enemies);
  });

  it('keeps the sim clock running, so a live enemy still moves afterwards', () => {
    const h = harness();
    // An open cavern around the home base, with an enemy that last stepped on
    // tick 500 — the tick the reset happens on.
    h.state.world = Array.from({length: HOME_ROW + 10}, () => Array.from({length: WORLD_W}, () => ({type: 'air'} as const)));
    h.state.tick = 500;
    const enemy = {
      id: 1, kind: 'tunnelFiend' as const, x: HOME_X + 6, y: HOME_ROW, drawX: HOME_X + 6, drawY: HOME_ROW,
      hp: 4, maxHp: 4, alive: true, moveTick: 500, biteTick: 500, flash: 0, origin: {x: HOME_X + 6, y: HOME_ROW}
    };
    h.state.enemies = [enemy];
    const sim = createEnemySim({
      state: h.state,
      grid: createFakeGrid(),
      audio: h.audio,
      toast: h.toasts.toast,
      addCash: vi.fn(),
      saveProgress: vi.fn(),
      damagePlayer: vi.fn(),
      spawnDust: vi.fn(),
      spawnExplosion: vi.fn()
    });

    h.run.resetPlayer(true);
    expect(h.state.tick).toBe(500);
    // The fresh ship is parked at home, six tiles from the enemy.
    expect(h.state.player).toMatchObject({x: HOME_X, y: HOME_ROW});

    for (let i = 0; i < 60; i++) {
      h.state.tick++;
      sim.update();
    }

    expect(enemy.x).toBeLessThan(HOME_X + 6);
  });
});

describe('the player-data reset confirmation', () => {
  it('does nothing when explicit confirmation is cancelled', () => {
    const confirm = vi.fn(() => false);
    expect(confirmPlayerDataReset(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(PLAYER_DATA_RESET_CONFIRMATION);
  });
});

describe('a shared-world reset', () => {
  it('rebuilds terrain and drops render caches without touching player progress', () => {
    const h = harness();
    h.state.world = [[{type: 'air'}]];
    h.state.enemyIdCounter = 42;

    h.run.clearWorldRuntime();

    expect(h.state.cash).toBe(900);
    expect(countOres(h.state.player.inventory)).toBe(2);
    expect(h.state.enemyIdCounter).toBe(1);
    expect(h.state.tileDiff.size).toBe(0);
    // Reachable air is re-seeded from the ship's new home-base tile, and the fog
    // around it uncovered, as on a fresh run's first frame.
    expect(h.enemies.resetExposure).toHaveBeenCalled();
    expect(h.revealAtPlayer).toHaveBeenCalled();
    expect(h.input.clearKeys).toHaveBeenCalled();
    expect(h.invalidateTerrain).toHaveBeenCalled();
    expect(h.invalidateFog).toHaveBeenCalled();
  });

  it('drops the wrecks and keeps a tunnel portal reachable by carving its tile', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
    h.state.wrecks = [createWreck(12, 60, addOre(createInventory(), nth(ORES, 0), 3)!)];

    h.run.clearWorldRuntime();

    expect(h.state.wrecks).toEqual([]);
    expect(h.state.stations).toHaveLength(2);
    for (const {x, y} of h.state.stations) expect(h.state.world[y]?.[x]).toEqual({type: 'air'});
  });
});

describe('a portal whose tile has gone solid', () => {
  it('is never a respawn candidate, so a lone buried portal redeploys at home', () => {
    const h = harness();
    // Placed on a tunnel whose dug-out tile the save lost: rock again.
    h.state.stations = [createPortal(50, 100, 'Buried')];
    expect(makeTile(50, 100).type).not.toBe('air');
    h.run.gameOver();

    h.run.restartGame();

    expect(h.portals.openRespawn).not.toHaveBeenCalled();
    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y});
  });

  it('is left out of the respawn prompt, leaving one portal to redeploy at unprompted', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Open'), createPortal(50, 100, 'Buried')];
    h.run.gameOver();

    h.run.restartGame();

    expect(h.portals.openRespawn).not.toHaveBeenCalled();
    expect(h.state.player).toMatchObject({x: 30, y: 80});
  });

  it('sends a pick that went solid before the rebuild home instead', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 30, 80, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
    h.run.gameOver();
    h.run.restartGame();
    const onPick = nth(vi.mocked(h.portals.openRespawn).mock.calls, 0)[0] as (at: {x: number; y: number}) => void;
    // The diff forgets the hole between the prompt and the pick.
    h.state.tileDiff = createTileDiff();

    onPick({x: 50, y: 100});

    expect(h.state.player).toMatchObject({x: Math.floor(WORLD_W / 2), y: START_Y});
  });
});
