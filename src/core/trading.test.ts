// Trading-post offers: are the wares and prices derived deterministically from the
// coordinate, tiered by depth, and does the ledger clamp the remaining stock? What
// a purchase actually does to the wallet and the bay is game/trading.test.ts.

import { describe, expect, it } from 'vitest';
import { START_Y, rowDepthMeters } from '../../shared/constants';
import { tileKey } from '../../shared/tile-key';
import { RECIPES } from './crafting';
import { itemForKind } from './items';
import { oreKind } from './inventory';
import { EXTRACTOR } from './balance';
import {
  EXTRACTOR_FUEL_ORDER,
  FUEL_DEPTH_METERS,
  FUEL_TRADE_MARKUP,
  HOME_SUPPLY_MARKUP,
  SUPPLY_POOL,
  TRADING_MARKUP,
  buyPrice,
  extractorFuelOrder,
  extractorFuelOrderPrice,
  fuelPurchase,
  fuelUnitPrice,
  isSupplyKind,
  offersForPost,
  postFuelUnitPrice,
  remainingStock,
  sellPrice,
  supplyPrice
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
    // Repair Kit ← 2 Iron + 1 Copper (2 × 12 + 16 = 40), marked up ×1.5 → 60.
    const recipe = RECIPES.find(r => r.output === 'repairKit')!;
    const oreValue = recipe.inputs.reduce((sum, input) => sum + input.count * itemForKind(input.kind).value, 0);
    expect(buyPrice('repairKit')).toBe(Math.round(oreValue * TRADING_MARKUP));
    expect(buyPrice('repairKit')).toBe(60);
  });

  it('prices one unit of a multi-output recipe, not the whole batch', () => {
    // Stone Block ×2 ← 1 Coal: each block is half a Coal's value, marked up.
    const coal = itemForKind(oreKind('Coal')).value;
    expect(buyPrice('decor:stoneBlock')).toBe(Math.max(1, Math.round(coal / 2 * TRADING_MARKUP)));
  });

  it('takes another seller\'s markup when one is named', () => {
    expect(buyPrice('repairKit', 2)).toBe(80);
    expect(buyPrice('repairKit', TRADING_MARKUP)).toBe(buyPrice('repairKit'));
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
    const key = tileKey(40, DEEP);
    const saved = offers.map(() => 0);
    expect(remainingStock({[key]: saved}, 40, DEEP, offers)).toEqual(saved);
    // A hand-edited entry over the rolled stock is clamped down; a negative is floored to 0.
    const tampered = offers.map(() => 99);
    expect(remainingStock({[key]: tampered}, 40, DEEP, offers)).toEqual(offers.map(o => o.stock));
  });

  it('ignores a ledger entry whose length no longer matches the offers', () => {
    const key = tileKey(40, DEEP);
    expect(remainingStock({[key]: [5]}, 40, DEEP, offers)).toEqual(offers.map(o => o.stock));
  });
});

describe('fuel for cash', () => {
  it('prices a unit off the coal it would be made from, marked up', () => {
    const coal = itemForKind(oreKind('Coal')).value;
    expect(fuelUnitPrice()).toBeCloseTo(coal / EXTRACTOR.fuelPerCoal * FUEL_TRADE_MARKUP);
    // Mining the coal always beats buying the fuel it would have made.
    expect(fuelUnitPrice() * EXTRACTOR.fuelPerCoal).toBeGreaterThan(coal);
    expect(fuelUnitPrice()).toBeCloseTo(0.29, 2);
  });

  it('charges more the deeper the post, by the base price again every 4000 m', () => {
    const base = fuelUnitPrice();
    expect(FUEL_DEPTH_METERS).toBe(4000);
    expect(fuelUnitPrice(0)).toBe(base);
    expect(fuelUnitPrice(2000)).toBeCloseTo(base * 1.5);
    expect(fuelUnitPrice(4000)).toBeCloseTo(base * 2);
    // The deepest posts pay nearly three times the home price.
    expect(fuelUnitPrice(7390) / base).toBeCloseTo(2.85, 2);
    // A depth above the home row never discounts.
    expect(fuelUnitPrice(-500)).toBe(base);
  });

  it('prices a post\'s fuel at the depth of its own row', () => {
    expect(postFuelUnitPrice(START_Y)).toBe(fuelUnitPrice());
    expect(postFuelUnitPrice(DEEP)).toBeCloseTo(fuelUnitPrice(rowDepthMeters(DEEP)));
    expect(postFuelUnitPrice(DEEP)).toBeGreaterThan(postFuelUnitPrice(SHALLOW));
  });

  it('fills the whole gap when the wallet covers it, rounding the cost down', () => {
    expect(fuelPurchase(60, 100, 1000, 0.29)).toEqual({amount: 40, cost: 11}); // 11.6 → 11
    // A fractional gap is topped off exactly.
    expect(fuelPurchase(59.5, 100, 1000, 0.29)).toEqual({amount: 40.5, cost: 11});
  });

  it('buys only whole units a thin wallet covers', () => {
    // $2 buys six units at $0.29 (6 × 0.29 = 1.74 → $1).
    expect(fuelPurchase(0, 100, 2, 0.29)).toEqual({amount: 6, cost: 1});
  });

  it('never charges less than a dollar, and never more than the wallet', () => {
    expect(fuelPurchase(98, 100, 5, 0.29)).toEqual({amount: 2, cost: 1});
    for (let cash = 0; cash < 40; cash++) {
      const {cost} = fuelPurchase(0, 500, cash, fuelUnitPrice());
      expect(cost).toBeLessThanOrEqual(cash);
    }
  });

  it('buys nothing for a full tank or an empty wallet', () => {
    expect(fuelPurchase(100, 100, 1000, 0.29)).toEqual({amount: 0, cost: 0});
    // Within a unit of full counts as full.
    expect(fuelPurchase(99.5, 100, 1000, 0.29)).toEqual({amount: 0, cost: 0});
    expect(fuelPurchase(0, 100, 0, 0.29)).toEqual({amount: 0, cost: 0});
  });

  it('orders an extractor batch, capped by the store and the wallet', () => {
    expect(extractorFuelOrder(0, 10_000).amount).toBe(EXTRACTOR_FUEL_ORDER);
    expect(extractorFuelOrder(EXTRACTOR.fuelCap - 30, 10_000).amount).toBe(30);
    expect(extractorFuelOrder(EXTRACTOR.fuelCap, 10_000)).toEqual({amount: 0, cost: 0});
    expect(extractorFuelOrder(0, 0)).toEqual({amount: 0, cost: 0});
    expect(extractorFuelOrder(0, 10_000).cost).toBe(Math.floor(EXTRACTOR_FUEL_ORDER * fuelUnitPrice()));
  });

  it('quotes a whole extractor order at the home price, whatever the post depths', () => {
    expect(extractorFuelOrderPrice()).toBe(Math.round(EXTRACTOR_FUEL_ORDER * fuelUnitPrice()));
    expect(extractorFuelOrderPrice()).toBe(29);
    expect(extractorFuelOrder(0, 10_000).cost).toBe(extractorFuelOrderPrice());
  });
});

describe('the home Supply', () => {
  it('sells the four basics at the home markup, dearer than a post', () => {
    expect([...SUPPLY_POOL]).toEqual(['repairKit', 'dynamite', 'scanner', 'container']);
    for (const kind of SUPPLY_POOL) {
      expect(isSupplyKind(kind)).toBe(true);
      expect(supplyPrice(kind)).toBe(buyPrice(kind, HOME_SUPPLY_MARKUP));
      expect(supplyPrice(kind)).toBeGreaterThan(buyPrice(kind));
    }
    expect(isSupplyKind('teleporter')).toBe(false);
  });
});
