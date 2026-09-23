// Trading posts: opening one, selling ore for cash, and buying its limited stock.
//
// `core/trading.ts` holds the rules (what a post offers, at what price, from what
// pool) and `world.ts` derives the post itself from its coordinate; this is the
// part that touches the running game — the cargo bay ore is sold from and gear is
// bought into, the wallet each trade moves, and the `state.tradeLedger` a purchase
// draws down.
//
// Opening a post is the *un*armed press the home stations and cargo containers
// already model: a click on a post tile the ship is standing on or beside, or Space
// when a post is the nearest station-like thing. The screen it raises is a modal
// overlay, so — like those — it holds no copy of anything: the sim pushes the buy
// offers (with their live remaining stock) into the store on open and after every
// purchase, and the sell side is just the bay's ore, synced every frame.

import {
  addItem,
  findStack,
  isOreKind,
  removeItem,
  roomLeft,
  type InventoryItemKind
} from '../core/inventory';
import { itemForKind } from '../core/items';
import { offersForPost, remainingStock, sellPrice, tradePostKey } from '../core/trading';
import type { AudioController, GameState } from '../core/types';
import { tradingPostAt, type TradingPost } from '../world/world';

/** How far a ship may stand from a post and still trade: Chebyshev ≤ 1, its own tile too. */
export const TRADING_POST_REACH = 1;

/** One buy offer as the trade screen paints it: an item, its price, and stock left. */
export interface TradeOfferView {
  index: number;
  kind: InventoryItemKind;
  label: string;
  color: string;
  price: number;
  stock: number;
}

export interface TradingSim {
  /** The post whose screen is up, or `null`. */
  readonly open: TradingPost | null;
  /** A press on the mine that landed on a post tile the ship can reach. */
  openAt(x: number, y: number): boolean;
  /** Space, or a click with no tile named: open the nearest post, or toggle it shut. */
  openNearest(): boolean;
  /** The nearest reachable post, or `null` — for the keyboard's station-vs-post choice. */
  nearestPost(): {post: TradingPost; distance: number} | null;
  /** Put the screen away. Idempotent; also what the dialog's own close reports. */
  close(): void;
  /** Sell a stack (or one unit) of ore for cash. */
  sell(kind: InventoryItemKind, single?: boolean): void;
  /** Buy one of an offered item, deducting cash and drawing down the post's stock. */
  buy(kind: InventoryItemKind): void;
  /** One fixed 60 Hz step: only a lost ship to tidy up after. */
  tick(): void;
}

export interface TradingDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Move the wallet (positive to earn, negative to spend); banks the change. */
  addCash(amount: number): void;
  /** Show the buy offers, or take the screen away with `null`. */
  setOpenUi(offers: TradeOfferView[] | null): void;
}

export function createTrading(deps: TradingDeps): TradingSim {
  const {state, audio, toast, saveProgress} = deps;
  let open: TradingPost | null = null;

  /** Whether a ship at the current position is close enough to work this post. */
  function inReach(post: TradingPost): boolean {
    return Math.max(Math.abs(post.x - state.player.x), Math.abs(post.y - state.player.y)) <= TRADING_POST_REACH;
  }

  function nearestPost(): {post: TradingPost; distance: number} | null {
    let best: {post: TradingPost; distance: number} | null = null;
    for (let dy = -TRADING_POST_REACH; dy <= TRADING_POST_REACH; dy++) {
      for (let dx = -TRADING_POST_REACH; dx <= TRADING_POST_REACH; dx++) {
        const post = tradingPostAt(state.player.x + dx, state.player.y + dy);
        if (!post) continue;
        const distance = Math.abs(dx) + Math.abs(dy);
        if (!best || distance < best.distance) best = {post, distance};
      }
    }
    return best;
  }

  /** The buy offers with their live remaining stock, for the screen to paint. */
  function offersView(post: TradingPost): TradeOfferView[] {
    const offers = offersForPost(post.x, post.y);
    const remaining = remainingStock(state.tradeLedger, post.x, post.y, offers);
    return offers.map((offer, index) => ({
      index,
      kind: offer.kind,
      label: offer.label,
      color: itemForKind(offer.kind).color,
      price: offer.price,
      stock: remaining[index]
    }));
  }

  function show(post: TradingPost): boolean {
    open = post;
    deps.setOpenUi(offersView(post));
    return true;
  }

  function close(): void {
    if (!open) return;
    open = null;
    deps.setOpenUi(null);
  }

  /** Re-publish the open post's offers after a purchase changed the stock. */
  function repaint(): void {
    if (open) deps.setOpenUi(offersView(open));
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver || open) return false;
    const post = tradingPostAt(x, y);
    if (!post) return false;
    if (!inReach(post)) {
      toast('Too far from the trading post. Fly alongside it first.');
      return false;
    }
    return show(post);
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    const near = nearestPost();
    if (!near) {
      toast('No trading post within reach.');
      return false;
    }
    return show(near.post);
  }

  function sell(kind: InventoryItemKind, single = false): void {
    const post = open;
    if (!post || state.gameOver) return;
    if (!isOreKind(kind)) return;
    const stack = findStack(state.player.inventory, kind);
    if (!stack) {
      audio.alarm();
      return toast('None of that ore is aboard to sell.');
    }
    const count = single ? 1 : stack.count;
    const takings = sellPrice(kind) * count;
    state.player.inventory = removeItem(state.player.inventory, kind, count);
    deps.addCash(takings);
    repaint();
    audio.cash(takings);
    toast(`Sold ${count} × ${stack.item.label} for $${takings}.`);
  }

  function buy(kind: InventoryItemKind): void {
    const post = open;
    if (!post || state.gameOver) return;
    const offers = offersForPost(post.x, post.y);
    const index = offers.findIndex(offer => offer.kind === kind);
    if (index < 0) return;
    const offer = offers[index];
    const remaining = remainingStock(state.tradeLedger, post.x, post.y, offers);
    if (remaining[index] <= 0) {
      audio.alarm();
      return toast(`${offer.label} is sold out.`);
    }
    if (state.cash < offer.price) {
      audio.alarm();
      return toast(`Not enough cash for ${offer.label} ($${offer.price}).`);
    }
    if (roomLeft(state.player.inventory, state.player.cargoMax) <= 0) {
      audio.alarm();
      return toast('Cargo bay is full. Make room before buying.');
    }
    deps.addCash(-offer.price);
    state.player.inventory = addItem(state.player.inventory, itemForKind(offer.kind), 1);
    const next = [...remaining];
    next[index] -= 1;
    state.tradeLedger[tradePostKey(post.x, post.y)] = next;
    repaint();
    saveProgress();
    audio.blip(620, .06, 'triangle', .04, 40);
    toast(`Bought ${offer.label} for $${offer.price}.`);
  }

  function tick(): void {
    if (state.gameOver) close();
  }

  return {
    get open() {
      return open;
    },
    openAt,
    openNearest,
    nearestPost,
    close,
    sell,
    buy,
    tick
  };
}
