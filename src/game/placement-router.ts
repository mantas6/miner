// The one press on the mine, and the armed tools that compete for it.
//
// Scanners, dynamite, crates, decor, the station devices and the toolkit each
// arm from their inventory slot and then wait for a press on a tile. Only one
// press can be outstanding, so arming any of them stands the others down, and a
// press goes to whichever one is armed. Each tool is registered once here, keyed
// by its slot id, instead of being listed by hand at every place that has to ask
// "is anything armed?", "stand the rest down" or "who takes this press?".

/** The armable tool groups, by the slot that arms them. */
export type ArmedSlotId = 'scanner' | 'dynamite' | 'container' | 'stationDevices' | 'toolkit' | 'decor';

/** What the router needs of a tool: whether it is waiting for a press, and how to stand it down. */
export interface Armable {
  /** Truthy while armed: a flag, or the kind armed (a station kind, a decor id). */
  readonly armed: unknown;
  /** Stand down without complaint; reports whether anything was armed. */
  disarm(): boolean;
}

/** One registered tool: its armed state, its stand-down, and what a press on the mine does with it. */
export interface ArmedSlot {
  isArmed(): boolean;
  disarm(): boolean;
  pressAt(x: number, y: number): void;
}

/** Wrap a tool and its press handler (a placement, or the toolkit's lift) as a slot. */
export function createArmedSlot(tool: Armable, press: (x: number, y: number) => unknown): ArmedSlot {
  return {
    isArmed: () => Boolean(tool.armed),
    disarm: () => tool.disarm(),
    pressAt: (x, y) => { press(x, y); }
  };
}

export interface PlacementRouter {
  /** Stand every tool down except `keep`, then run its toggle (arm, or stand it down). */
  toggle(keep: ArmedSlotId, toggleArmed: () => void): void;
  /** Stand every tool down except `keep`. */
  standDownExcept(keep: ArmedSlotId): void;
  /** Stand every tool down; reports whether anything was armed. */
  disarmAll(): boolean;
  /** Whether any tool is waiting for a press on the mine. */
  anyArmed(): boolean;
  /** Hand a press on the mine to the armed tool; reports whether one took it. */
  pressAt(x: number, y: number): boolean;
}

/**
 * Build the router over a registry of every armable tool. The registry's key
 * order is the press priority — only one tool is ever armed, so it only decides
 * anything if that rule is broken.
 */
export function createPlacementRouter(registry: Readonly<Record<ArmedSlotId, ArmedSlot>>): PlacementRouter {
  const entries = Object.entries(registry) as [ArmedSlotId, ArmedSlot][];

  function standDownExcept(keep: ArmedSlotId): void {
    for (const [id, slot] of entries) if (id !== keep) slot.disarm();
  }

  return {
    toggle(keep, toggleArmed) {
      standDownExcept(keep);
      toggleArmed();
    },
    standDownExcept,
    disarmAll() {
      // Every one of them, never short-circuited: only one can be armed, but a
      // disarm must never depend on which.
      let any = false;
      for (const [, slot] of entries) any = slot.disarm() || any;
      return any;
    },
    anyArmed: () => entries.some(([, slot]) => slot.isArmed()),
    pressAt(x, y) {
      const armed = entries.find(([, slot]) => slot.isArmed());
      if (!armed) return false;
      armed[1].pressAt(x, y);
      return true;
    }
  };
}
