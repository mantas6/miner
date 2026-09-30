import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import { formatDepthMilestone, formatDepthMilestoneReached, getDepthMilestone } from './depth-milestone';

describe('expedition depth milestone helper', () => {
  it('guides fresh miners through the Coal/Iron starter seam', () => {
    expect(getDepthMilestone(START_Y)).toEqual({
      kind: 'starter',
      target: 'starter Coal/Iron seam',
      depthMeters: 30,
      remainingMeters: 30,
      recordMeters: null
    });
  });

  it('moves to the next locked ore band at the starter-seam boundary', () => {
    expect(getDepthMilestone(START_Y + 3)).toEqual({
      kind: 'ore',
      target: 'Copper',
      depthMeters: 60,
      remainingMeters: 30,
      recordMeters: null
    });
  });

  it('targets the next band below the career record, counting the distance from the ship', () => {
    // Back at home after reaching 1500 m: the Gold band is behind the career, so
    // the next target is Ruby — not the starter seam the ship happens to sit above.
    expect(getDepthMilestone(START_Y, 1500)).toEqual({
      kind: 'ore',
      target: 'Ruby',
      depthMeters: 2300,
      remainingMeters: 2300,
      recordMeters: null
    });
    expect(getDepthMilestone(START_Y + 100, 1500)).toMatchObject({target: 'Ruby', remainingMeters: 1300});
    // The starter seam is hidden as soon as the career has reached it once.
    expect(getDepthMilestone(START_Y, 30)).toMatchObject({kind: 'ore', target: 'Copper', remainingMeters: 60});
    expect(getDepthMilestone(START_Y, 20).kind).toBe('starter');
    // A ship deeper than the record (a portal jump) is measured from where it is.
    expect(getDepthMilestone(START_Y + 70, 0)).toMatchObject({target: 'Gold', remainingMeters: 400});
  });

  it('rolls on in fixed depth records past the last ore band', () => {
    // The world generates indefinitely below the richest ore, so the readout keeps
    // handing out fresh depth records rather than reporting "0 m deeper" forever.
    expect(getDepthMilestone(START_Y + 850)).toEqual({
      kind: 'deep',
      target: '9000 m depth record',
      depthMeters: 9000,
      remainingMeters: 500,
      recordMeters: null
    });
    expect(getDepthMilestone(START_Y + 860)).toMatchObject({target: '9000 m depth record', remainingMeters: 400});
    expect(getDepthMilestone(START_Y + 960)).toMatchObject({target: '10000 m depth record', remainingMeters: 400});
  });

  it('names a depth record already set, rather than counting down to it, once the ship climbs back above it', () => {
    // 9050 m reached, the ship back up at 8980 m: 9000 m is done, not "20 m to go".
    const above = getDepthMilestone(START_Y + 898, 9050);
    expect(above).toEqual({
      kind: 'deep',
      target: '10000 m depth record',
      depthMeters: 10000,
      remainingMeters: 1020,
      recordMeters: 9000
    });
    expect(formatDepthMilestone(above)).toBe('record: 9000 m reached');
    // Pushing on below that record, the countdown to the next one returns.
    const pushing = getDepthMilestone(START_Y + 902, 9050);
    expect(pushing.recordMeters).toBeNull();
    expect(formatDepthMilestone(pushing)).toBe('↓ 980 m to 10000 m depth record');
    // A step inside the last band is not a record set: the rolling records start below it.
    expect(getDepthMilestone(START_Y + 800, 8600).recordMeters).toBeNull();
    expect(formatDepthMilestone(getDepthMilestone(START_Y))).toBe('↓ 30 m to starter Coal/Iron seam');
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
