// Trading-post offers: are the wares and prices derived deterministically from the
// coordinate, tiered by depth, and does the ledger clamp the remaining stock? What
// a purchase actually does to the wallet and the bay is game/trading.test.ts.

import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import { RECIPES } from './crafting';
import { itemForKind } from './items';
import { oreKind } from './inventory';
import {
  TRADING_MARKUP,
  buyPrice,
  offersForPost,
  remainingStock,
  sellPrice,
  tradePostKey
} from './trading';

/** A row deep enough that every buy tier is eligible. */
const DEEP = START_Y + 400;
/** A row where only the base tier (repair kit, dynamite, scanner, container) is eligible. */
const SHALLOW = START_Y + 50;

const BASE_KINDS = new Set(['repairKit', 'dynamite', 'scanner', 'container']);

describe('sell prices', () => {
  it('pays the ore table value per unit', () => {
    expect(sellPrice(oreKind('Iron'))).toBe(itemForKind(oreKind('Iron')).value);
    expect(sellPrice(oreKind('Gold'))).toBe(70);
  });
});

describe('buy prices', () => {
  it('marks a recipe\'s ore-value up by the trading markup', () => {
    // Repair Kit ← 3 Iron (3 × 12 = 36), marked up ×1.5 → 54.
    const recipe = RECIPES.find(r => r.output === 'repairKit')!;
    const oreValue = recipe.inputs.reduce((sum, input) => sum + input.count * itemForKind(input.kind).value, 0);
    expect(buyPrice('repairKit')).toBe(Math.round(oreValue * TRADING_MARKUP));
    expect(buyPrice('repairKit')).toBe(54);
  });

  it('prices richer gear above cheaper gear', () => {
    expect(buyPrice('teleporter')).toBeGreaterThan(buyPrice('scanner'));
    expect(buyPrice('upgrade:tank:2')).toBeGreaterThan(buyPrice('upgrade:tank:1'));
  });
});

describe('offersForPost', () => {
  it('is deterministic for a coordinate', () => {
    expect(offersForPost(40, DEEP)).toEqual(offersForPost(40, DEEP));
    expect(offersForPost(12, 512)).toEqual(offersForPost(12, 512));
  });

  it('offers two or three wares, each with a 1–3 stock and a positive price', () => {
    for (const [x, y] of [[40, DEEP], [7, 320], [61, 640], [20, SHALLOW]] as const) {
      const offers = offersForPost(x, y);
      expect(offers.length).toBeGreaterThanOrEqual(2);
      expect(offers.length).toBeLessThanOrEqual(3);
      for (const offer of offers) {
        expect(offer.stock).toBeGreaterThanOrEqual(1);
        expect(offer.stock).toBeLessThanOrEqual(3);
        expect(offer.price).toBeGreaterThan(0);
        expect(offer.label).toBe(itemForKind(offer.kind).label);
      }
      // No kind is offered twice.
      expect(new Set(offers.map(o => o.kind)).size).toBe(offers.length);
    }
  });

  it('restricts a shallow post to the base tier, and lets a deep post reach upgrades', () => {
    const shallow = offersForPost(20, SHALLOW).map(o => o.kind);
    expect(shallow.every(kind => BASE_KINDS.has(kind))).toBe(true);

    // Some deep post along a band offers an upgrade the shallow tier never has.
    let sawUpgrade = false;
    for (let x = 4; x < 80 && !sawUpgrade; x++) {
      sawUpgrade = offersForPost(x, DEEP).some(o => o.kind.startsWith('upgrade:'));
    }
    expect(sawUpgrade).toBe(true);
  });
});

describe('remainingStock', () => {
  const offers = offersForPost(40, DEEP);

  it('falls back to the rolled stock when the ledger has no entry', () => {
    expect(remainingStock({}, 40, DEEP, offers)).toEqual(offers.map(o => o.stock));
  });

  it('uses the ledger entry when its length matches, clamped to the rolled stock', () => {
    const key = tradePostKey(40, DEEP);
    const saved = offers.map(() => 0);
    expect(remainingStock({[key]: saved}, 40, DEEP, offers)).toEqual(saved);
    // A hand-edited entry over the rolled stock is clamped down; a negative is floored to 0.
    const tampered = offers.map(() => 99);
    expect(remainingStock({[key]: tampered}, 40, DEEP, offers)).toEqual(offers.map(o => o.stock));
  });

  it('ignores a ledger entry whose length no longer matches the offers', () => {
    const key = tradePostKey(40, DEEP);
    expect(remainingStock({[key]: [5]}, 40, DEEP, offers)).toEqual(offers.map(o => o.stock));
  });
});
