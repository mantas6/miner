// Cosmetic particles: drill dust and explosion debris.
//
// They live on `GameState.particles` so the renderer can paint them, but nothing
// in the simulation reads them back. Spawning pushes onto the live array and each
// fixed step advances and compacts it in place, so a burst of dust never costs a
// fresh array per step for as long as it lingers.

import type { Particle } from '../core/types';

const EXPLOSION_COLORS = ['#ffec8b', '#ff9f1c', '#ff4d2d', '#7a1f16', '#d7e7ff'];

/** A puff of dust off a tile the drill is working. */
export function spawnDust(particles: Particle[], x: number, y: number, color = '#9d6a42', amount = 10): void {
  for (let i = 0; i < amount; i++) {
    particles.push({
      x: x + 0.5,
      y: y + 0.5,
      vx: (Math.random() - 0.5) * 0.08,
      vy: (Math.random() - 0.7) * 0.09,
      life: 22 + Math.random() * 18,
      color,
      size: 0.035 + Math.random() * 0.045
    });
  }
}

/** A ring of hot debris for a blast, a lost ship or a destroyed enemy. */
export function spawnExplosion(particles: Particle[], x: number, y: number): void {
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.035 + Math.random() * 0.16;
    particles.push({
      x: x + 0.5,
      y: y + 0.5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.04,
      life: 34 + Math.random() * 34,
      color: EXPLOSION_COLORS[i % EXPLOSION_COLORS.length] ?? '#ffec8b',
      size: 0.045 + Math.random() * 0.085
    });
  }
}

/** One fixed step: move every particle, apply gravity, and drop the spent ones in place. */
export function advanceParticles(particles: Particle[]): void {
  let kept = 0;
  for (const pt of particles) {
    pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.003; pt.life -= 1;
    if (pt.life > 0) particles[kept++] = pt;
  }
  particles.length = kept;
}
