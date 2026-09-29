import { describe, expect, it } from 'vitest';
import { FUEL } from './balance';
import { formatTerrainScanner, hitsLeft } from './scanner';

describe('terrain scanner helper', () => {
  it('distinguishes clear air and ordinary drillable dirt', () => {
    expect(formatTerrainScanner({ tile: { type: 'air' }, direction: [0, 1] }))
      .toBe('Scanner ↓: clear route.');
    expect(formatTerrainScanner({ tile: { type: 'dirt', hp: 3, maxHp: 3 }, direction: [1, 0] }))
      .toBe('Scanner →: dirt — drillable, 3 hits.');
  });

  it('reports ore value and remaining drill hits from real tile data', () => {
    expect(formatTerrainScanner({
      tile: { type: 'ore', ore: { name: 'Copper', color: '#c47b45', value: 16, min: 7, max: 322, chance: .08 }, hp: 4, maxHp: 4 },
      direction: [-1, 0]
    })).toBe('Scanner ←: Copper — $16, 4 hits.');
  });

  it('conceals dormant fiends while warning about rock, magma, and active fiends', () => {
    expect(formatTerrainScanner({ tile: { type: 'rock', hp: 999 }, direction: [0, -1] }))
      .toBe('Scanner ↑: solid rock — detour; drill blocked.');
    expect(formatTerrainScanner({ tile: { type: 'hazard', hp: 5, maxHp: 5 }, direction: [0, 1] }))
      .toBe('Scanner ↓: magma — hull risk, 5 hits to vent.');
    expect(formatTerrainScanner({ tile: { type: 'enemy', kind:'tunnelFiend', hp: 4, maxHp: 4 }, direction: [1, 0] }))
      .toBe('Scanner →: dirt — drillable, 4 hits.');
    expect(formatTerrainScanner({ tile: { type: 'air' }, direction: [-1, 0], activeEnemy: true }))
      .toBe('Scanner ←: active fiend — drill it before it chews hull.');
  });

  it('counts hits at the ship\'s drill power, not raw tile hp', () => {
    expect(formatTerrainScanner({ tile: { type: 'dirt', hp: 9, maxHp: 9 }, direction: [0, 1], drill: 3 }))
      .toBe('Scanner ↓: dirt — drillable, 3 hits.');
    expect(formatTerrainScanner({ tile: { type: 'dirt', hp: 9, maxHp: 9 }, direction: [0, 1], drill: 4 }))
      .toBe('Scanner ↓: dirt — drillable, 3 hits.');
    expect(formatTerrainScanner({ tile: { type: 'hazard', hp: 5, maxHp: 5 }, direction: [0, 1], drill: 5 }))
      .toBe('Scanner ↓: magma — hull risk, 1 hit to vent.');
  });

  it('hitsLeft rounds up and never reports fewer than one hit', () => {
    expect(hitsLeft(9, 2)).toBe(5);
    expect(hitsLeft(8, 2)).toBe(4);
    expect(hitsLeft(1, 5)).toBe(1);
    expect(hitsLeft(0.25, 1)).toBe(1);
    expect(hitsLeft(0, 3)).toBe(1);
    expect(hitsLeft(2.5, 0.75)).toBe(4);
  });

  it('flags the hover surcharge on a drillable side target, derived from the balance constant', () => {
    const suffix = ` Hover: +${Math.round((FUEL.hoverDrillMult - 1) * 100)} % fuel.`;
    expect(suffix).toBe(' Hover: +50 % fuel.');
    expect(formatTerrainScanner({ tile: { type: 'dirt', hp: 3, maxHp: 3 }, direction: [1, 0], hovering: true }))
      .toBe('Scanner →: dirt — drillable, 3 hits. Hover: +50 % fuel.');
    expect(formatTerrainScanner({ tile: { type: 'hazard', hp: 2, maxHp: 2 }, direction: [-1, 0], hovering: true }))
      .toBe(`Scanner ←: magma — hull risk, 2 hits to vent.${suffix}`);
    // Nothing to drill, or nothing the drill can bite: no surcharge to warn about.
    expect(formatTerrainScanner({ tile: { type: 'air' }, direction: [1, 0], hovering: true }))
      .toBe('Scanner →: clear route.');
    expect(formatTerrainScanner({ tile: { type: 'rock', hp: 999 }, direction: [1, 0], hovering: true }))
      .toBe('Scanner →: solid rock — detour; drill blocked.');
    expect(formatTerrainScanner({ tile: { type: 'air' }, direction: [1, 0], activeEnemy: true, hovering: true }))
      .toBe('Scanner →: active fiend — drill it before it chews hull.');
    expect(formatTerrainScanner({ tile: { type: 'dirt', hp: 3, maxHp: 3 }, direction: [1, 0], explored: false, hovering: true }))
      .toBe('Scanner →: unexplored — advance to map terrain.');
  });

  it('reads a decoration as drillable', () => {
    expect(formatTerrainScanner({ tile: { type: 'decor', decor: 'steelPlate', hp: 48, maxHp: 48 }, direction: [0, 1] }))
      .toBe('Scanner ↓: decoration — drill to recover it.');
  });

  it('does not leak terrain, rewards, or enemies through unexplored fog', () => {
    expect(formatTerrainScanner({
      tile: {type:'ore', ore:{name:'Gold', color:'#ffd65c', value:70, min:152, max:602, chance:.04}, hp:7, maxHp:7},
      direction: [1, 0], activeEnemy: true, explored: false
    })).toBe('Scanner →: unexplored — advance to map terrain.');
  });
});
