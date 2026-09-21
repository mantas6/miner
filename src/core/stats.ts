import type { GameStats } from './types';

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
      detail: totalCashEarned > 0 ? 'From tunnel-fiend bounties' : 'Destroy a tunnel fiend to begin'
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
