import { describe, expect, it } from 'vitest';
import { createDefaultStats } from './state';
import { formatExpeditionStats, recordCraft, recordItemsObtained } from './stats';
import { nth } from '../test-narrowing';

const PROGRESSED = {
  maxDepth: 1230,
  totalCashEarned: 98765,
  oreMined: 42,
  enemiesDestroyed: 1,
  deaths: 2
};

const labelledValues = (stats: Partial<typeof PROGRESSED> = {}) =>
  formatExpeditionStats(stats).map(({ label, value }) => [label, value]);

describe('expedition stats formatting', () => {
  it('formats a fresh save as zeroed, pluralized rows', () => {
    expect(labelledValues()).toEqual([
      ['Max depth', '0 m'],
      ['Cash earned', '$0'],
      ['Ore mined', '0 ores'],
      ['Enemies destroyed', '0 fiends'],
      ['Deaths', '0 losses']
    ]);
  });

  it('formats progressed career metrics with separators and singular units', () => {
    expect(labelledValues(PROGRESSED)).toEqual([
      ['Max depth', '1,230 m'],
      ['Cash earned', '$98,765'],
      ['Ore mined', '42 ores'],
      ['Enemies destroyed', '1 fiend'],
      ['Deaths', '2 losses']
    ]);
  });

  it('switches every detail line between zero-state and progressed copy', () => {
    const zero = formatExpeditionStats({});
    const progressed = formatExpeditionStats(PROGRESSED);

    for (const [index, row] of progressed.entries()) {
      expect(row.detail).not.toBe(nth(zero, index).detail);
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it('coerces invalid or negative saved values to zero', () => {
    const rows = formatExpeditionStats({ maxDepth: -5, totalCashEarned: Number.NaN, oreMined: 1.9 });

    expect(nth(rows, 0).value).toBe('0 m');
    expect(nth(rows, 1).value).toBe('$0');
    expect(nth(rows, 2).value).toBe('1 ore');
  });
});

describe('objective progress counters', () => {
  it('tallies scanners obtained and keeps the best upgrade mark crafted', () => {
    const stats = createDefaultStats();
    recordItemsObtained(stats, 'scanner', 1);
    recordItemsObtained(stats, 'dynamite', 3);
    recordCraft(stats, 'scanner', 2);
    expect(stats.scannersObtained).toBe(3);

    recordCraft(stats, 'upgrade:drill:2', 1);
    recordCraft(stats, 'upgrade:tank:1', 1);
    recordCraft(stats, 'repairKit', 1);
    expect(stats.bestMarkCrafted).toBe(2);
    recordCraft(stats, 'upgrade:hull:3', 1);
    expect(stats.bestMarkCrafted).toBe(3);
  });

  it('does not list the counters on the Stats tab', () => {
    expect(formatExpeditionStats({...createDefaultStats(), scannersObtained: 4, bestMarkCrafted: 2})).toHaveLength(5);
  });
});
