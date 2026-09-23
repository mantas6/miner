import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { describeItem } from './item-info';
import { oreKind, type InventoryItemKind } from './inventory';
import { ITEM_CATALOG } from './items';

/** Every non-ore catalog kind, plus one stack of every ore. */
const catalogKinds = Object.keys(ITEM_CATALOG) as InventoryItemKind[];
const oreKinds = ORES.map(ore => oreKind(ore.name));
const allKinds: InventoryItemKind[] = [...catalogKinds, ...oreKinds];

describe('describeItem', () => {
  it.each(allKinds)('gives %s a non-empty title and lines', kind => {
    const info = describeItem(kind);
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.lines.length).toBeGreaterThan(0);
    expect(info.lines.every(line => line.length > 0)).toBe(true);
  });

  it('describes an ore with its unit value', () => {
    const info = describeItem(oreKind('Gold'));
    expect(info.title).toBe('Gold');
    expect(info.lines.join(' ')).toContain('$70');
  });

  it('describes an upgrade with its fitted bonus', () => {
    expect(describeItem('upgrade:drill:3').lines.join(' ')).toContain('+4 drill power');
    expect(describeItem('upgrade:booster:1').lines.join(' ')).toContain('sprint');
  });
});
