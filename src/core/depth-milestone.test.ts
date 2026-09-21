import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import { formatDepthMilestone, formatDepthMilestoneReached, getDepthMilestone } from './depth-milestone';

describe('expedition depth milestone helper', () => {
  it('guides fresh miners through the Coal/Iron starter seam', () => {
    expect(getDepthMilestone(START_Y)).toEqual({
      kind: 'starter',
      target: 'starter Coal/Iron seam',
      depthMeters: 30,
      remainingMeters: 30
    });
    expect(formatDepthMilestone(START_Y)).toBe('Depth target: starter Coal/Iron seam — 30 m deeper.');
  });

  it('moves to the next locked ore band at the starter-seam boundary', () => {
    expect(getDepthMilestone(START_Y + 3)).toEqual({
      kind: 'ore',
      target: 'Copper',
      depthMeters: 60,
      remainingMeters: 30
    });
  });

  it('rolls on in fixed depth records past the last ore band', () => {
    // The world generates indefinitely below the richest ore, so the readout keeps
    // handing out fresh depth records rather than reporting "0 m deeper" forever.
    expect(getDepthMilestone(START_Y + 850)).toEqual({
      kind: 'deep',
      target: '9000 m depth record',
      depthMeters: 9000,
      remainingMeters: 500
    });
    expect(formatDepthMilestone(START_Y + 860)).toBe('Depth target: 9000 m depth record — 400 m deeper.');
    expect(formatDepthMilestone(START_Y + 960)).toBe('Depth target: 10000 m depth record — 400 m deeper.');
  });

  it('announces a cleared landmark by depth, naming what the seam holds', () => {
    const starter = formatDepthMilestoneReached(getDepthMilestone(START_Y));
    expect(starter).toContain('Depth 30 m');
    expect(starter).toContain('starter Coal/Iron seam');

    const ore = formatDepthMilestoneReached(getDepthMilestone(START_Y + 3));
    expect(ore).toContain('Depth 60 m');
    expect(ore).toContain('Copper band');

    expect(formatDepthMilestoneReached(getDepthMilestone(START_Y + 850)))
      .toBe('Depth 9000 m — new depth record. The mine keeps going; keep fuel for the climb home.');
  });
});
