import { describe, expect, it } from 'vitest';
import { formatTerrainScanner } from './scanner';

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

  it('does not leak terrain, rewards, or enemies through unexplored fog', () => {
    expect(formatTerrainScanner({
      tile: {type:'ore', ore:{name:'Gold', color:'#ffd65c', value:70, min:152, max:602, chance:.04}, hp:7, maxHp:7},
      direction: [1, 0], activeEnemy: true, explored: false
    })).toBe('Scanner →: unexplored — advance to map terrain.');
  });
});
