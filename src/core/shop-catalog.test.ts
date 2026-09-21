import { describe, expect, it } from 'vitest';
import { ECONOMY, LIMITS } from './balance';
import {
  SHOP_ITEMS,
  SHOP_SERVICES,
  SHOP_UPGRADES,
  itemRowState,
  serviceRowState,
  shopSummary,
  upgradeRowState,
  type ShopPlayer
} from './shop-catalog';
import { createInitialState } from './state';

/** A shop-shaped ship: the run's player plus the bay-counted consumable tallies. */
function ship(overrides: Partial<ShopPlayer> = {}): ShopPlayer {
  return {...createInitialState().player, scanners: 0, dynamite: 0, guns: 0, teleporters: 0, containers: 0, ...overrides};
}

function everyRow(player: ShopPlayer, cash: number, atSurface: boolean) {
  return [
    ...SHOP_UPGRADES.map(upgrade => upgradeRowState(upgrade.id, player, cash, atSurface)),
    ...SHOP_SERVICES.map(service => serviceRowState(service.id, player, cash, atSurface)),
    ...SHOP_ITEMS.map(item => itemRowState(item.id, player, cash, atSurface))
  ];
}

describe('shop rows', () => {
  it('shows current level, next benefit, exact price, and affordability', () => {
    const state = createInitialState();

    const cargo = upgradeRowState('cargo', ship(), state.cash, true);

    expect(cargo.current).toBe('Level 0/98 · 20/1000 items');
    expect(cargo.benefit).toBe('Next: 20 → 30 items');
    expect(cargo.buttonLabel).toBe('Buy · $120');
    expect(cargo.buttonDisabled).toBe(true);
    expect(cargo.status).toBe('Need $60');
    expect(shopSummary(state.cash, true)).toEqual({cash: '$60 available', location: 'Surface depot'});
  });

  it('marks capped upgrades as maximum regardless of available cash', () => {
    const drill = upgradeRowState('drill', ship({drill: LIMITS.drill.max}), 1_000_000, true);

    expect(drill.benefit).toBe('Maximum 100 power');
    expect(drill.buttonLabel).toBe('Maximum');
    expect(drill.buttonDisabled).toBe(true);
    expect(drill.status).toBe('Maximum');
  });

  it('offers scaled fuel and hull purchases beyond their former caps', () => {
    const player = ship({fuelMax: 1000, hullMax: 1000});

    const tank = upgradeRowState('tank', player, Number.MAX_SAFE_INTEGER, true);
    const hull = upgradeRowState('hull', player, Number.MAX_SAFE_INTEGER, true);

    expect(tank.current).toBe('Level 45/95 · 1000/2000 fuel');
    expect(tank.benefit).toBe('Next: 1000 → 1020 fuel');
    expect(tank.buttonLabel).toBe('Buy · $78669645');
    expect(tank.buttonDisabled).toBe(false);
    expect(hull.current).toBe('Level 45/95 · 1000/2000 strength');
    expect(hull.buttonLabel).toBe('Buy · $354675667');
    expect(hull.buttonDisabled).toBe(false);
  });

  it('marks fuel and hull maximum only at their new caps', () => {
    const player = ship({fuelMax: LIMITS.fuelMax.max, hullMax: LIMITS.hullMax.max});

    for (const id of ['tank', 'hull'] as const) {
      const row = upgradeRowState(id, player, Number.MAX_SAFE_INTEGER, true);
      expect(row.benefit).toContain('Maximum 2000');
      expect(row.buttonLabel).toBe('Maximum');
      expect(row.buttonDisabled).toBe(true);
      expect(row.status).toBe('Maximum');
    }
  });

  it('preserves partial service semantics and reports carried consumables', () => {
    const player = ship({fuel: 50, hull: 80, dynamite: 3, teleporters: 1, scanners: 2});

    expect(serviceRowState('fuel', player, 5, true)).toMatchObject({status: 'Partial service', buttonDisabled: false});
    expect(serviceRowState('repair', player, 5, true).current).toBe('80/100 · full service $39');
    expect(serviceRowState('fuel', ship(), 5, true).status).toBe('Full');
    expect(serviceRowState('fuel', player, 0, true).status).toBe('No cash');
    expect(itemRowState('dynamite', player, 5, true).current).toBe('Carried: 3');
    // Every consumable tally, the teleporter included, is counted out of the bay.
    expect(itemRowState('teleporter', player, 5, true).current).toBe('Carried: 1');
    expect(itemRowState('scanner', player, 5, true).current).toBe('Carried: 2');
    expect(itemRowState('scanner', player, ECONOMY.scanner.price, true)).toMatchObject({
      buttonLabel: `Buy one · $${ECONOMY.scanner.price}`,
      status: 'Ready',
      buttonDisabled: false
    });
  });

  it('prices the gun as one more carried consumable, with no ammunition shelf', () => {
    expect(SHOP_ITEMS.map(item => item.id)).not.toContain('bullets');

    expect(itemRowState('gun', ship(), ECONOMY.gun.price - 1, true)).toMatchObject({
      current: 'Carried: 0',
      buttonLabel: `Buy one · $${ECONOMY.gun.price}`,
      status: 'Need $1',
      buttonDisabled: true
    });
    // Owning one never closes the shelf: every shot spends an item, so the next
    // one is always for sale.
    expect(itemRowState('gun', ship({guns: 2}), ECONOMY.gun.price, true)).toMatchObject({
      current: 'Carried: 2',
      status: 'Ready',
      buttonDisabled: false
    });
  });

  it('prices the teleporter as one more carried consumable', () => {
    expect(itemRowState('teleporter', ship(), ECONOMY.teleporter.price - 1, true)).toMatchObject({
      current: 'Carried: 0',
      buttonLabel: `Buy one · $${ECONOMY.teleporter.price}`,
      status: 'Need $1',
      buttonDisabled: true
    });
    // Carrying some never closes the shelf: every trip up spends one.
    expect(itemRowState('teleporter', ship({teleporters: 2}), ECONOMY.teleporter.price, true)).toMatchObject({
      current: 'Carried: 2',
      status: 'Ready',
      buttonDisabled: false
    });
  });

  it('disables every purchase away from the surface depot', () => {
    const rows = everyRow(ship(), 1_000_000, false);

    expect(rows.every(row => row.buttonDisabled)).toBe(true);
    expect(rows.every(row => row.status === 'Surface depot only')).toBe(true);
    expect(shopSummary(1_000_000, false).location).toBe('Return to surface');
  });
});
