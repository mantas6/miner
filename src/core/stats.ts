import { isUpgradeKind, parseUpgradeKind, type InventoryItemKind } from './inventory';
import type { GameStats } from './types';

/** The highest mark `bestMarkCrafted` can record (Mk I–III, plus room for a tier-4 drill). */
export const BEST_MARK_MAX = 4;

/**
 * Count items that just came into the player's hands — crafted, or bought at the
 * home Supply or a trading post. Only scanners are tallied, for the objective's
 * "craft a Scanner" rung.
 */
export function recordItemsObtained(stats: GameStats, kind: InventoryItemKind, count: number): void {
  if (kind === 'scanner' && count > 0) stats.scannersObtained += count;
}

/** Count a finished craft: the items obtained, and an upgrade's mark toward `bestMarkCrafted`. */
export function recordCraft(stats: GameStats, kind: InventoryItemKind, count: number): void {
  recordItemsObtained(stats, kind, count);
  if (!isUpgradeKind(kind)) return;
  const mark = Math.min(BEST_MARK_MAX, parseUpgradeKind(kind).tier);
  stats.bestMarkCrafted = Math.max(stats.bestMarkCrafted, mark);
}

/** Count one piece of ore out of the rock: the career total and its own ore's tally. */
export function recordOreMined(stats: GameStats, oreName: string): void {
  stats.oreMined++;
  stats.oresMined[oreName] = (stats.oresMined[oreName] ?? 0) + 1;
}

export interface ExpeditionStatRow {
  label: string;
  value: string;
  detail: string;
}

function whole(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function money(value: number | undefined): string {
  return `$${whole(value).toLocaleString('en-US')}`;
}

function count(value: number | undefined, singular: string, plural = `${singular}s`): string {
  const n = whole(value);
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`;
}

export function formatExpeditionStats(stats: Partial<GameStats> = {}): ExpeditionStatRow[] {
  const maxDepth = whole(stats.maxDepth);
  const totalCashEarned = whole(stats.totalCashEarned);
  const oreMined = whole(stats.oreMined);
  const enemiesDestroyed = whole(stats.enemiesDestroyed);
  const deaths = whole(stats.deaths);

  return [
    {
      label: 'Max depth',
      value: `${maxDepth.toLocaleString('en-US')} m`,
      detail: maxDepth > 0 ? 'Deepest descent saved' : 'Start digging to set a record'
    },
    {
      label: 'Cash earned',
      value: money(totalCashEarned),
      detail: totalCashEarned > 0 ? 'From ore sales and fiend bounties' : 'Sell ore at a trading post to begin'
    },
    {
      label: 'Ore mined',
      value: count(oreMined, 'ore'),
      detail: oreMined > 0 ? 'Total pieces extracted' : 'Coal and Iron await below'
    },
    {
      label: 'Enemies destroyed',
      value: count(enemiesDestroyed, 'fiend'),
      detail: enemiesDestroyed > 0 ? 'Tunnel fiends defeated' : 'No fiends defeated yet'
    },
    {
      label: 'Deaths',
      value: count(deaths, 'loss', 'losses'),
      detail: deaths > 0 ? 'Replacement ships deployed' : 'No ships lost'
    }
  ];
}
