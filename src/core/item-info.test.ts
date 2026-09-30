import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { describeItem } from './item-info';
import { oreKind, type InventoryItemKind } from './inventory';
import { FUEL_CELL_FUEL, ITEM_CATALOG } from './items';

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
    // Fractional drill bonuses read as plain decimals, whole ones without zeros.
    expect(describeItem('upgrade:drill:1').lines).toContain('+0.75 drill power when fitted.');
    expect(describeItem('upgrade:drill:2').lines).toContain('+1.75 drill power when fitted.');
    expect(describeItem('upgrade:drill:3').lines).toContain('+3.5 drill power when fitted.');
    expect(describeItem('upgrade:drill:4')).toMatchObject({title: 'Core Drill'});
    expect(describeItem('upgrade:drill:4').lines).toContain('+7 drill power when fitted.');
    expect(describeItem('upgrade:tank:1').lines).toContain('+50 max fuel when fitted.');
    expect(describeItem('upgrade:booster:1').lines.join(' ')).toContain('sprint');
  });

  it('says a fuel cell fills the tank', () => {
    expect(describeItem('fuelCell')).toMatchObject({title: 'Fuel Cell'});
    expect(describeItem('fuelCell').lines).toContain(`Adds +${FUEL_CELL_FUEL} fuel when used, up to a full tank.`);
  });

  it('warns that a scanner is single use', () => {
    expect(describeItem('scanner').lines).toContain('Single use: it crumbles away once its square is mapped.');
  });

  it('warns that a crafted fuel extractor starts empty', () => {
    expect(describeItem('device:extractor').lines.join(' ')).toContain('Starts empty.');
    expect(describeItem('device:manufacturer').lines.join(' ')).not.toContain('Starts empty.');
  });

  it('tells how many drill hits clear a decoration', () => {
    expect(describeItem('decor:steelPlate').lines.join(' ')).toContain('drill hits');
  });
});
