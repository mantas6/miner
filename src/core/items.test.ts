import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { ITEM_CATALOG, isCatalogKind, itemForKind } from './items';
import {
  isDecorKind,
  isOreKind,
  isUpgradeKind,
  oreItem,
  oreKind,
  parseUpgradeKind,
  type NonOreKind,
  type UpgradeId,
  type UpgradeTier
} from './inventory';

/** Every non-ore kind the game can hold, built the same way the catalog is keyed. */
const NON_ORE_KINDS: NonOreKind[] = [
  'dynamite', 'scanner', 'teleporter', 'container', 'repairKit',
  'decor:steelPlate', 'decor:stoneBlock', 'decor:copperTrim', 'decor:lampPanel',
  'upgrade:tank:1', 'upgrade:tank:2', 'upgrade:tank:3',
  'upgrade:cargo:1', 'upgrade:cargo:2', 'upgrade:cargo:3',
  'upgrade:drill:1', 'upgrade:drill:2', 'upgrade:drill:3',
  'upgrade:hull:1', 'upgrade:hull:2', 'upgrade:hull:3',
  'upgrade:booster:1'
];

describe('the item catalog', () => {
  it('resolves every non-ore kind to a self-consistent item', () => {
    for (const kind of NON_ORE_KINDS) {
      const item = ITEM_CATALOG[kind];
      expect(item, `missing catalog entry for ${kind}`).toBeDefined();
      expect(item.kind).toBe(kind);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.color).toMatch(/^#/);
      // Equipment is never cargo, so nothing here carries a sale value.
      expect(item.value).toBe(0);
    }
  });

  it('holds no keys beyond the twenty-two non-ore kinds', () => {
    expect(Object.keys(ITEM_CATALOG).sort()).toEqual([...NON_ORE_KINDS].sort());
  });

  it('names the upgrades by family and mark', () => {
    expect(ITEM_CATALOG['upgrade:tank:1'].label).toBe('Fuel Tank Mk I');
    expect(ITEM_CATALOG['upgrade:cargo:2'].label).toBe('Cargo Hold Mk II');
    expect(ITEM_CATALOG['upgrade:drill:3'].label).toBe('Drill Mk III');
    expect(ITEM_CATALOG['upgrade:hull:1'].label).toBe('Hull Plating Mk I');
    // Booster is Mk I only, so it drops the mark from its name.
    expect(ITEM_CATALOG['upgrade:booster:1'].label).toBe('Booster');
  });

  it('names the decorations and the repair kit', () => {
    expect(ITEM_CATALOG['decor:steelPlate'].label).toBe('Steel Plate');
    expect(ITEM_CATALOG['decor:stoneBlock'].label).toBe('Stone Block');
    expect(ITEM_CATALOG['decor:copperTrim'].label).toBe('Copper Trim');
    expect(ITEM_CATALOG['decor:lampPanel'].label).toBe('Lamp Panel');
    expect(ITEM_CATALOG.repairKit.label).toBe('Repair Kit');
  });
});

describe('itemForKind', () => {
  it('resolves an ore kind through the ore table', () => {
    for (const ore of ORES) {
      expect(itemForKind(oreKind(ore.name))).toEqual(oreItem(ore));
    }
  });

  it('falls back to a plain grey stack for an unknown ore', () => {
    const item = itemForKind(oreKind('Unobtanium'));
    expect(item).toEqual({kind: 'ore:Unobtanium', label: 'Unobtanium', color: '#8c9aa8', value: 0});
  });

  it('resolves every non-ore kind to its catalog entry', () => {
    for (const kind of NON_ORE_KINDS) {
      expect(itemForKind(kind)).toBe(ITEM_CATALOG[kind]);
    }
  });
});

describe('kind guards', () => {
  it('separates ore, upgrade, and decor kinds', () => {
    expect(isOreKind(oreKind('Coal'))).toBe(true);
    expect(isUpgradeKind('upgrade:drill:2')).toBe(true);
    expect(isDecorKind('decor:lampPanel')).toBe(true);

    expect(isUpgradeKind(oreKind('Coal'))).toBe(false);
    expect(isDecorKind('dynamite')).toBe(false);
    expect(isOreKind('upgrade:tank:1')).toBe(false);
  });

  it('recognises exactly the catalog kinds', () => {
    for (const kind of NON_ORE_KINDS) expect(isCatalogKind(kind)).toBe(true);
    expect(isCatalogKind('ore:Coal')).toBe(false);
    expect(isCatalogKind('upgrade:booster:2')).toBe(false);
    expect(isCatalogKind('bogus')).toBe(false);
  });

  it('splits an upgrade kind into its family and mark', () => {
    const cases: [string, UpgradeId, UpgradeTier][] = [
      ['upgrade:tank:1', 'tank', 1],
      ['upgrade:hull:3', 'hull', 3],
      ['upgrade:booster:1', 'booster', 1]
    ];
    for (const [kind, id, tier] of cases) {
      expect(parseUpgradeKind(kind as never)).toEqual({id, tier});
    }
  });
});
