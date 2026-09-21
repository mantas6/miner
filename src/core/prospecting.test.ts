import { describe, expect, it } from 'vitest';
import { MAX_WORLD_ROW, ORES, START_Y } from '../../shared/constants';
import { buildProspectingGuideRows, formatDepthBandLabel, oreMinimumDepthMeters } from './prospecting';

describe('prospecting guide helpers', () => {
  it('converts ore minimum rows into player-facing depth labels from the start row', () => {
    expect(oreMinimumDepthMeters(START_Y)).toBe(0);
    expect(formatDepthBandLabel(START_Y, START_Y + 180)).toBe('starter–≈1800 m');
    expect(formatDepthBandLabel(START_Y + 5, START_Y + 320)).toBe('≈50–3200 m');
  });

  it('spells the bottomless world sentinel as an open band instead of its raw row', () => {
    const label = formatDepthBandLabel(START_Y + 700, MAX_WORLD_ROW);

    expect(label).toBe('≈7000 m and deeper');
    expect(label).not.toContain(String(MAX_WORLD_ROW));
  });

  it('formats guide rows from the ore constants without stale copied values', () => {
    const rows = buildProspectingGuideRows();

    expect(rows).toHaveLength(ORES.length);
    expect(rows[0]).toEqual({
      name: 'Coal',
      color: '#343434',
      valueLabel: '$8',
      depthLabel: 'starter–≈1800 m'
    });
    expect(rows[1]).toMatchObject({
      name: 'Iron',
      color: '#8a7f75',
      valueLabel: '$12',
      depthLabel: '≈30–2500 m'
    });
    expect(rows.at(-1)).toMatchObject({
      name: 'Core Shard',
      valueLabel: '$980',
      depthLabel: '≈8500 m and deeper'
    });
  });
});
