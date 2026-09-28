// The registry of armed tools sharing the one press on the mine: arming one stands
// the rest down, a disarm reaches every one of them, and a press goes to the armed
// tool alone.

import { describe, expect, it, vi } from 'vitest';
import { createArmedSlot, createPlacementRouter, type ArmedSlotId } from './placement-router';

/** A stand-in tool whose armed value is a flag, or a kind string like the station devices'. */
function tool(armedValue: boolean | string = true) {
  const t = {
    armed: false as boolean | string | null,
    arm() { t.armed = armedValue; },
    disarm: vi.fn(() => {
      const was = Boolean(t.armed);
      t.armed = typeof armedValue === 'string' ? null : false;
      return was;
    }),
    press: vi.fn()
  };
  return t;
}

const IDS: ArmedSlotId[] = ['scanner', 'dynamite', 'container', 'stationDevices', 'toolkit', 'decor'];

function harness() {
  const tools = {
    scanner: tool(),
    dynamite: tool(),
    container: tool(),
    stationDevices: tool('portal'),
    toolkit: tool(),
    decor: tool('lampPanel')
  } satisfies Record<ArmedSlotId, ReturnType<typeof tool>>;
  const router = createPlacementRouter({
    scanner: createArmedSlot(tools.scanner, tools.scanner.press),
    dynamite: createArmedSlot(tools.dynamite, tools.dynamite.press),
    container: createArmedSlot(tools.container, tools.container.press),
    stationDevices: createArmedSlot(tools.stationDevices, tools.stationDevices.press),
    toolkit: createArmedSlot(tools.toolkit, tools.toolkit.press),
    decor: createArmedSlot(tools.decor, tools.decor.press)
  });
  return {tools, router};
}

describe('the placement router', () => {
  it('stands every other tool down before toggling one', () => {
    const {tools, router} = harness();
    tools.scanner.arm();

    router.toggle('decor', () => tools.decor.arm());

    expect(tools.scanner.armed).toBe(false);
    expect(tools.decor.armed).toBe('lampPanel');
    // The tool being toggled is left to its own toggle, never disarmed first.
    expect(tools.decor.disarm).not.toHaveBeenCalled();
    for (const id of IDS.filter(id => id !== 'decor')) expect(tools[id].disarm).toHaveBeenCalledOnce();
  });

  it('reports whether anything was armed, disarming every tool either way', () => {
    const {tools, router} = harness();
    expect(router.disarmAll()).toBe(false);

    tools.stationDevices.arm();
    expect(router.anyArmed()).toBe(true);
    expect(router.disarmAll()).toBe(true);
    expect(router.anyArmed()).toBe(false);
    // Never short-circuited: the tools after the armed one were asked too.
    for (const id of IDS) expect(tools[id].disarm).toHaveBeenCalledTimes(2);
  });

  it('hands a press on the mine to the armed tool alone', () => {
    const {tools, router} = harness();
    expect(router.pressAt(3, 4)).toBe(false);

    tools.toolkit.arm();
    expect(router.pressAt(3, 4)).toBe(true);
    expect(tools.toolkit.press).toHaveBeenCalledWith(3, 4);
    for (const id of IDS.filter(id => id !== 'toolkit')) expect(tools[id].press).not.toHaveBeenCalled();
  });

  it('breaks the impossible two-armed case by registry order', () => {
    const {tools, router} = harness();
    tools.decor.arm();
    tools.dynamite.arm();

    router.pressAt(1, 1);

    expect(tools.dynamite.press).toHaveBeenCalledOnce();
    expect(tools.decor.press).not.toHaveBeenCalled();
  });
});
