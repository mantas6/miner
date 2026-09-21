import { describe, expect, it } from 'vitest';
import { formatExpeditionStats } from './stats';

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
      expect(row.detail).not.toBe(zero[index].detail);
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it('coerces invalid or negative saved values to zero', () => {
    const rows = formatExpeditionStats({ maxDepth: -5, totalCashEarned: Number.NaN, oreMined: 1.9 });

    expect(rows[0].value).toBe('0 m');
    expect(rows[1].value).toBe('$0');
    expect(rows[2].value).toBe('1 ore');
  });
});
