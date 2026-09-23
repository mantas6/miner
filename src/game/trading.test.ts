// Trading at a post: opening one, selling ore for cash, and buying its limited
// stock. The pure offer/price rules are core/trading.test.ts and the placement is
// world.test.ts; what is checked here is the wiring — the wallet each trade moves,
// the bay it fills or empties, the ledger a purchase draws down, and the menu the
// UI paints after every change.

import { describe, expect, it, vi } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';
import { addItem, countItem, createInventory, oreItem, oreKind, type Inventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import { offersForPost, remainingStock, tradePostKey } from '../core/trading';
import type { GameState, Ore } from '../core/types';
import { tradingPostAt, type TradingPost } from '../world/world';
import { createTrading, type TradingSim } from './trading';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';

const IRON: Ore = {name: 'Iron', color: '#8a7f75', value: 12, min: 0, max: 900, chance: 1};

/** The first trading post in the interior band, for the ship to be parked at. */
function findPost(): TradingPost {
  for (let y = START_Y + 40; y < START_Y + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

interface Harness {
  state: GameState;
  trading: TradingSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  openUi: (unknown[] | null)[];
  saveProgress: ReturnType<typeof vi.fn>;
  post: TradingPost;
}

/** A ship parked on a real post's tile, with `cash` in the wallet. */
function harness(cash = 100000): Harness {
  const state = createInitialState();
  const post = findPost();
  Object.assign(state.player, {x: post.x, y: post.y});
  state.cash = cash;
  const audio = createAudioStub();
  const toasts = createToastLog();
  const openUi: (unknown[] | null)[] = [];
  const saveProgress = vi.fn();
  const addCash = (amount: number) => { state.cash += amount; };
  const trading = createTrading({
    state,
    audio,
    toast: toasts.toast,
    saveProgress,
    addCash,
    setOpenUi: offers => openUi.push(offers)
  });
  return {state, trading, audio, toasts, openUi, saveProgress, post};
}

function bayOre(inventory: Inventory, name = 'Iron'): number {
  return countItem(inventory, oreKind(name));
}

describe('opening a trading post', () => {
  it('opens the post under a press and hands its offers to the UI', () => {
    const h = harness();
    expect(h.trading.openAt(h.post.x, h.post.y)).toBe(true);
    expect(h.trading.open).toEqual(h.post);
    expect(h.openUi.at(-1)?.length).toBe(offersForPost(h.post.x, h.post.y).length);
  });

  it('refuses a post the ship has flown away from', () => {
    const h = harness();
    h.state.player.y = h.post.y + 5;
    expect(h.trading.openAt(h.post.x, h.post.y)).toBe(false);
    expect(h.trading.open).toBeNull();
    expect(h.toasts.saw('Too far')).toBe(true);
  });

  it('opens the nearest post from the keyboard, and closes it again', () => {
    const h = harness();
    expect(h.trading.openNearest()).toBe(true);
    expect(h.trading.open).not.toBeNull();
    expect(h.trading.openNearest()).toBe(true);
    expect(h.trading.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });

  it('says nothing about a press on bare rock', () => {
    const h = harness();
    const toasts = h.toasts.messages.length;
    expect(h.trading.openAt(h.post.x + 6, h.post.y + 6)).toBe(false);
    expect(h.toasts.messages).toHaveLength(toasts);
  });
});

describe('selling ore', () => {
  it('sells a whole stack for cash and repaints the menu', () => {
    const h = harness(0);
    h.state.player.inventory = addItem(createInventory(), oreItem(IRON), 4);
    h.trading.openAt(h.post.x, h.post.y);

    h.trading.sell(oreKind('Iron'));

    expect(h.state.cash).toBe(4 * IRON.value);
    expect(bayOre(h.state.player.inventory)).toBe(0);
    expect(h.audio.played).toContain('cash');
    expect(h.toasts.saw(`Sold 4 × Iron for $${4 * IRON.value}`)).toBe(true);
  });

  it('sells a single unit, leaving the rest aboard', () => {
    const h = harness(0);
    h.state.player.inventory = addItem(createInventory(), oreItem(IRON), 4);
    h.trading.openAt(h.post.x, h.post.y);

    h.trading.sell(oreKind('Iron'), true);

    expect(h.state.cash).toBe(IRON.value);
    expect(bayOre(h.state.player.inventory)).toBe(3);
  });

  it('refuses to sell ore that is not aboard', () => {
    const h = harness(0);
    h.trading.openAt(h.post.x, h.post.y);

    h.trading.sell(oreKind('Iron'));

    expect(h.state.cash).toBe(0);
    expect(h.audio.played).toContain('alarm');
    expect(h.toasts.saw('None of that ore')).toBe(true);
  });
});

describe('buying gear', () => {
  it('buys an offered item, spending cash, filling the bay, and drawing down the stock', () => {
    const h = harness();
    h.trading.openAt(h.post.x, h.post.y);
    const offer = offersForPost(h.post.x, h.post.y)[0];
    const cashBefore = h.state.cash;

    h.trading.buy(offer.kind);

    expect(h.state.cash).toBe(cashBefore - offer.price);
    expect(countItem(h.state.player.inventory, offer.kind)).toBe(1);
    const remaining = remainingStock(h.state.tradeLedger, h.post.x, h.post.y, offersForPost(h.post.x, h.post.y));
    expect(remaining[0]).toBe(offer.stock - 1);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw(`Bought ${offer.label}`)).toBe(true);
  });

  it('keeps the drawn-down stock across a close and reopen', () => {
    const h = harness();
    h.trading.openAt(h.post.x, h.post.y);
    const offer = offersForPost(h.post.x, h.post.y)[0];
    h.trading.buy(offer.kind);
    h.trading.close();

    h.trading.openAt(h.post.x, h.post.y);
    const reopened = h.openUi.at(-1) as {kind: string; stock: number}[];
    expect(reopened.find(o => o.kind === offer.kind)?.stock).toBe(offer.stock - 1);
  });

  it('refuses a sold-out offer', () => {
    const h = harness();
    const offers = offersForPost(h.post.x, h.post.y);
    h.state.tradeLedger[tradePostKey(h.post.x, h.post.y)] = offers.map(() => 0);
    h.trading.openAt(h.post.x, h.post.y);

    h.trading.buy(offers[0].kind);

    expect(countItem(h.state.player.inventory, offers[0].kind)).toBe(0);
    expect(h.toasts.saw('sold out')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses when the wallet cannot cover the price', () => {
    const h = harness(0);
    h.trading.openAt(h.post.x, h.post.y);
    const offer = offersForPost(h.post.x, h.post.y)[0];

    h.trading.buy(offer.kind);

    expect(h.state.cash).toBe(0);
    expect(countItem(h.state.player.inventory, offer.kind)).toBe(0);
    expect(h.toasts.saw('Not enough cash')).toBe(true);
  });

  it('refuses when the cargo bay has no room', () => {
    const h = harness();
    h.state.player.cargoMax = 4;
    h.state.player.inventory = addItem(createInventory(), oreItem(IRON), 4);
    h.trading.openAt(h.post.x, h.post.y);
    const offer = offersForPost(h.post.x, h.post.y)[0];

    h.trading.buy(offer.kind);

    expect(countItem(h.state.player.inventory, offer.kind)).toBe(0);
    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
  });
});

describe('a lost ship', () => {
  it('shuts the post on the next tick', () => {
    const h = harness();
    h.trading.openAt(h.post.x, h.post.y);
    h.state.gameOver = true;

    h.trading.tick();

    expect(h.trading.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });
});
