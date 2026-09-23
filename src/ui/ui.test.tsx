// @vitest-environment happy-dom
//
// Behaviour of the app shell: the DOM contract the game runtime and the keyboard
// layer still depend on, store-driven HUD updates, tab switching, toasts, and the
// developer-tools gate. Copy is not asserted here — it lives in one place now and
// is checked where it is produced (core/stats, core/objective).

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORES } from '../../shared/constants';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { addItem, addOre, createInventory } from '../core/inventory';
import { SCANNER_ITEM } from '../core/scanner-device';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore, type HudSnapshot } from './store';
import { MinerApp } from './ui';

/** Ids the game runtime, the keyboard layer, and the tests address directly. */
const DOM_CONTRACT = [
  'shell', 'game-panel', 'game', 'game-instructions', 'game-status',
  'hud', 'musicBtn', 'sfxBtn', 'cash', 'depth', 'depthTarget', 'scanner',
  'fuel', 'fuelLabel', 'hull', 'hullLabel',
  // The inventory panel ships expanded, so its slot list is part of the contract.
  'inventory', 'inventoryToggleBtn', 'inventorySlots',
  'shipBtn', 'teleporterBtn', 'infoBtn',
  // Every overlay keeps its dialog shell mounted; their contents do not.
  'ship-screen', 'info-screen', 'cargo-screen',
  'fuel-warning', 'toast'
];

/** Ids that exist only while the ship equipment screen is the overlay on screen. */
const SHIP_CONTRACT = ['ship-card', 'shipCloseBtn', 'shipBay'];

/** Ids that exist only while a cargo container's transfer menu is up. */
const CARGO_CONTRACT = ['cargo-card', 'cargoCloseBtn', 'containerSlots', 'shipSlots'];

/** Ids that exist only while the info screen is up, on the tab it opens with. */
const INFO_CONTRACT = ['info-card', 'infoCloseBtn', 'objectiveInfoStatus', 'cargoList'];

/** The remaining panel ids, and the tab that mounts each of them. */
const INFO_TAB_CONTRACT = [
  {tabId: 'info-tab-stats', ids: ['expeditionStats']},
  {tabId: 'info-tab-prospecting', ids: ['prospectingGuide']},
  {tabId: 'info-tab-hazards', ids: ['dangerGuide']},
  {tabId: 'info-tab-settings', ids: ['settingsMusicBtn', 'settingsSfxBtn', 'resetGameBtn']}
];

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

function patchHud(patch: Partial<HudSnapshot>): void {
  act(() => {
    uiStore.getState().syncHud({...uiStore.getState().hud, ...patch});
  });
}

beforeEach(() => {
  uiStore.setState(pristine);
  // `setState` restores an empty queue but cannot cancel a toast expiry an
  // earlier test armed, which would fire mid-test outside `act()`.
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
  vi.restoreAllMocks();
});

/** The overlay commands the running game installs, in store terms. */
function installOverlayCommands(): void {
  setUiCommands({
    openShip: () => uiStore.getState().setActiveOverlay('ship'),
    closeShip: () => uiStore.getState().closeOverlay('ship'),
    openInfo: () => uiStore.getState().setActiveOverlay('info'),
    closeInfo: () => uiStore.getState().closeOverlay('info')
  });
}

function dialog(id: string): HTMLDialogElement {
  return document.getElementById(id) as HTMLDialogElement;
}

describe('app shell', () => {
  it('renders every DOM hook the game runtime still addresses', () => {
    render(<MinerApp />);

    for (const id of DOM_CONTRACT) expect(document.getElementById(id), id).not.toBeNull();
  });

  /**
   * The panel used to be a tab stop as well, so Tab landed on a wrapper that does
   * nothing and looked, with no focus ring anywhere, like a key that had been eaten.
   */
  it('gives the game surface exactly one tab stop, on the canvas', () => {
    render(<MinerApp />);
    const panel = document.getElementById('game-panel')!;
    const canvas = document.getElementById('game')!;

    expect(panel.hasAttribute('tabindex')).toBe(false);
    expect(panel.hasAttribute('autofocus')).toBe(false);
    expect([...panel.querySelectorAll('[tabindex]')].map(element => element.id)).toEqual(['game']);
    expect(canvas.getAttribute('tabindex')).toBe('0');
  });

  it('gives the canvas a name, a role that passes keys through, and instructions', () => {
    render(<MinerApp />);
    const canvas = document.getElementById('game')!;

    expect(canvas.getAttribute('role')).toBe('application');
    expect(canvas.getAttribute('aria-label')).toBe('Stalinload mine');
    // A description that points nowhere is worse than none at all.
    const description = document.getElementById(canvas.getAttribute('aria-describedby')!);
    expect(description?.textContent).toContain('WASD');
    expect(description?.textContent).toContain('Space uses the nearby home');
  });

  /**
   * The gameplay a sighted player reads off the pixels, in text. It has to be a
   * live region, and it has to be quiet: the field behind it changes only when the
   * ship crosses a threshold, never with a continuous value.
   */
  it('reports the ship state outside the canvas, in a polite live region', () => {
    render(<MinerApp />);
    const status = document.getElementById('game-status')!;

    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('At home base.');

    patchHud({announcement: 'In the mine. Cargo hold full.'});
    expect(status.textContent).toBe('In the mine. Cargo hold full.');
  });

  it('uses native modal dialogs for the ship and info overlays', () => {
    render(<MinerApp />);

    const ship = dialog('ship-screen');
    const info = dialog('info-screen');
    expect(ship.tagName).toBe('DIALOG');
    expect(info.tagName).toBe('DIALOG');
    expect(ship.open).toBe(false);
    expect(info.open).toBe(false);

    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    expect(ship.open).toBe(true);
    expect(document.activeElement?.id).toBe('shipCloseBtn');

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    expect(info.open).toBe(true);
  });

  it('reports a close the browser performed itself back to the game', () => {
    const closeShip = vi.fn();
    const closeInfo = vi.fn();
    setUiCommands({closeShip, closeInfo});
    render(<MinerApp />);

    // What Escape reaching the UA does: the dialog closes without the store or
    // the close button being involved at all.
    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    act(() => { dialog('ship-screen').close(); });
    expect(closeShip).toHaveBeenCalled();

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    act(() => { dialog('info-screen').close(); });
    expect(closeInfo).toHaveBeenCalled();
  });
});

describe('one overlay at a time', () => {
  it('puts the ship screen away when info is opened, and restores focus for it', () => {
    installOverlayCommands();
    render(<MinerApp />);

    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    expect(dialog('ship-screen').open).toBe(true);

    act(() => { fireEvent.click(document.getElementById('infoBtn')!); });

    expect(uiStore.getState().activeOverlay).toBe('info');
    expect(dialog('ship-screen').open).toBe(false);
    expect(dialog('info-screen').open).toBe(true);
    expect(document.activeElement?.id).toBe('infoCloseBtn');
  });

  it('ignores the close request the replaced dialog fires on its way out', () => {
    installOverlayCommands();
    render(<MinerApp />);

    // Swapping overlays closes the ship screen's `<dialog>`, whose `close` event
    // asks the game to clear the overlay state that info has already claimed.
    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    act(() => { uiStore.getState().setActiveOverlay('info'); });

    expect(uiStore.getState().activeOverlay).toBe('info');
    expect(dialog('info-screen').open).toBe(true);
  });

  it('reopens info on its first tab and closes it from the close button', () => {
    installOverlayCommands();
    render(<MinerApp />);

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    fireEvent.click(document.getElementById('info-tab-controls')!);
    expect(uiStore.getState().infoTab).toBe('info-controls');

    act(() => { fireEvent.click(document.getElementById('infoCloseBtn')!); });
    expect(uiStore.getState().activeOverlay).toBeNull();
    expect(dialog('info-screen').open).toBe(false);
    expect(document.activeElement?.id).toBe('infoBtn');

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    expect(uiStore.getState().infoTab).toBe('info-objective');
  });
});

describe('closed overlays', () => {
  it('builds overlay contents only while that overlay is on screen', () => {
    const all = [...SHIP_CONTRACT, ...INFO_CONTRACT];
    render(<MinerApp />);

    for (const id of all) expect(document.getElementById(id), id).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    for (const id of SHIP_CONTRACT) expect(document.getElementById(id), id).not.toBeNull();
    for (const id of INFO_CONTRACT) expect(document.getElementById(id), id).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    for (const id of INFO_CONTRACT) expect(document.getElementById(id), id).not.toBeNull();
    for (const id of SHIP_CONTRACT) expect(document.getElementById(id), id).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('container'); });
    for (const id of CARGO_CONTRACT) expect(document.getElementById(id), id).not.toBeNull();
    for (const id of [...SHIP_CONTRACT, ...INFO_CONTRACT]) expect(document.getElementById(id), id).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay(null); });
    for (const id of [...all, ...CARGO_CONTRACT]) expect(document.getElementById(id), id).toBeNull();
  });

  it('mounts only the selected info panel', () => {
    render(<MinerApp />);
    act(() => { uiStore.getState().setActiveOverlay('info'); });

    for (const {tabId, ids} of INFO_TAB_CONTRACT) {
      for (const id of ids) expect(document.getElementById(id), id).toBeNull();
      act(() => { fireEvent.click(document.getElementById(tabId)!); });
      for (const id of ids) expect(document.getElementById(id), id).not.toBeNull();
      // The panel that was up is gone, not merely hidden.
      expect(document.getElementById('cargoList')).toBeNull();
    }
  });

  /**
   * The point of unmounting: a shut overlay must not be listening to the store at
   * all, so the 60 Hz sync behind it has nothing to notify.
   */
  it('leaves no store subscriptions behind a closed overlay', () => {
    const subscribe = uiStore.subscribe;
    let live = 0;
    vi.spyOn(uiStore, 'subscribe').mockImplementation(listener => {
      live++;
      const unsubscribe = subscribe(listener);
      return () => { live--; unsubscribe(); };
    });

    render(<MinerApp />);
    const closed = live;

    act(() => { uiStore.getState().setActiveOverlay('info'); });
    expect(live).toBeGreaterThan(closed);

    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    expect(live).toBeGreaterThan(closed);

    act(() => { uiStore.getState().setActiveOverlay(null); });
    expect(live).toBe(closed);
  });
});

describe('boot phase machine', () => {
  it('mounts the intro alone, then neither', () => {
    render(<MinerApp />);

    expect(document.getElementById('intro')).not.toBeNull();

    act(() => { uiStore.getState().setPhase('playing'); });
    expect(document.getElementById('intro')).toBeNull();
  });

  it('keeps the splash copy to the title, one tagline and the start prompt', () => {
    render(<MinerApp />);

    const intro = document.getElementById('intro')!;
    expect(intro.querySelector('h2')?.textContent).toBe('Stalinload');
    expect(intro.textContent).toContain('Press Enter to start');
    // The rules live in Info / Cargo now: a wall of text here buries the prompt.
    expect(intro.querySelectorAll('li')).toHaveLength(0);
    // One button and no other offer: start.
    expect([...intro.querySelectorAll('button')].map(button => button.id)).toEqual(['introStartBtn']);
  });

  it('starts a run on a press anywhere, forwarding the gesture for audio unlock', () => {
    const playSolo = vi.fn();
    setUiCommands({playSolo});
    render(<MinerApp />);

    fireEvent.pointerDown(document.getElementById('intro')!);

    expect(playSolo).toHaveBeenCalledTimes(1);
    expect(playSolo.mock.calls[0][0]).toBeInstanceOf(Event);
  });

  /**
   * The splash used to be a `role="button"` div listening for `pointerdown` alone,
   * so the click a screen reader synthesises fell on the floor. The prompt is a
   * real button now, and a click is all it takes.
   */
  it('starts a run from the start button a screen reader can click', () => {
    const playSolo = vi.fn();
    setUiCommands({playSolo});
    render(<MinerApp />);

    const start = document.getElementById('introStartBtn') as HTMLButtonElement;
    expect(start.tagName).toBe('BUTTON');
    expect(document.getElementById('intro')?.getAttribute('role')).toBeNull();

    fireEvent.click(start);
    expect(playSolo).toHaveBeenCalledTimes(1);
  });

  it('starts a run on Enter or Space wherever focus happens to be', () => {
    const playSolo = vi.fn();
    setUiCommands({playSolo});
    render(<MinerApp />);

    fireEvent.keyDown(document.body, {key: 'x'});
    expect(playSolo).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, {key: 'Enter'});
    fireEvent.keyDown(document.body, {key: ' '});
    expect(playSolo).toHaveBeenCalledTimes(2);
  });

  it('stops listening for the intro keys once the run starts', () => {
    const playSolo = vi.fn();
    setUiCommands({playSolo});
    render(<MinerApp />);

    act(() => { uiStore.getState().setPhase('playing'); });
    fireEvent.keyDown(document.body, {key: 'Enter'});

    expect(playSolo).not.toHaveBeenCalled();
  });
});

describe('store-driven HUD', () => {
  it('repaints readouts, meters and alert styling from the synced snapshot', () => {
    render(<MinerApp />);

    patchHud({cash: 1234.7, depthMeters: 420, fuel: 12.2, fuelMax: 200, fuelAlert: true});

    expect(document.getElementById('cash')?.textContent).toBe('$1234');
    expect(document.getElementById('depth')?.textContent).toBe('420 m');
    expect(document.getElementById('fuelLabel')?.textContent).toBe('13/200');
    expect(document.getElementById('fuel')?.getAttribute('aria-valuenow')).toBe('12.2');
    // The LED, not a bar tint, is the low-fuel alarm on the analog gauge.
    expect(document.getElementById('fuelLed')?.className).toMatch(/on/);
    expect(document.getElementById('hull')?.className).not.toMatch(/alert/);
    expect(document.getElementById('fuel-warning')?.className).toMatch(/show/);
  });

  // The fuel gauge is an analog dial, not a `<meter>` whose bar every engine
  // paints to its own metrics: the needle is an SVG line the page rotates itself,
  // so it reads the same everywhere. The forecast it used to draw stays in the
  // accessible name alone.
  it('turns the needle with the tank', () => {
    render(<MinerApp />);
    const gauge = document.getElementById('fuel') as HTMLElement;
    const needle = document.getElementById('fuelNeedle') as unknown as SVGLineElement;

    expect(gauge.getAttribute('role')).toBe('meter');
    expect(document.querySelectorAll('#hud meter')).toHaveLength(0);
    expect(document.getElementById('fuelLabel')).not.toBeNull();

    // At the depot there is no climb to pay for, so the name is just the reading.
    patchHud({fuel: 100, fuelMax: 200, fuelReserveNeeded: 0, fuelReserveMargin: 100});
    // Half a tank points the needle halfway through the 90° sweep.
    expect(needle.style.transform).toBe('rotate(-45deg)');
    expect(gauge.getAttribute('aria-label')).toBe('Fuel 100/200');

    // Underground the climb home is named in the label, not drawn on the dial.
    patchHud({atSurface: false, fuelReserveStatus: 'caution', fuelReserveNeeded: 34, fuelReserveMargin: 66});
    expect(gauge.getAttribute('aria-label')).toBe('Fuel 100/200 — 66 left after climbing home');

    // A dry tank rests the needle at E; a climb it cannot pay for changes wording.
    patchHud({fuel: 0, fuelReserveStatus: 'urgent', fuelReserveNeeded: 34, fuelReserveMargin: 0});
    expect(needle.style.transform).toBe('rotate(-90deg)');
    expect(gauge.getAttribute('aria-label')).toBe('Fuel 0/200 — climb home needs 34');

    // A full tank swings the needle all the way to F.
    patchHud({fuel: 200});
    expect(needle.style.transform).toBe('rotate(0deg)');
  });

  it('shows the underground actions and dispatches the ones it shows', () => {
    const useTeleporter = vi.fn();
    setUiCommands({useTeleporter});
    render(<MinerApp />);

    patchHud({atSurface: false, teleporters: 2, teleportDepthReached: true, teleportUsable: true});

    const teleporter = document.getElementById('teleporterBtn') as HTMLButtonElement;
    // The ship screen needs no station, so its button stays visible underground.
    expect(document.getElementById('shipBtn')?.hasAttribute('hidden')).toBe(false);
    expect(teleporter.hidden).toBe(false);
    expect(teleporter.textContent).toBe('Teleport (T) · x2');

    fireEvent.click(teleporter);
    expect(useTeleporter).toHaveBeenCalledOnce();
  });

  it('hides the teleport button underground with an empty bay, and at the depot without a return point', () => {
    render(<MinerApp />);

    patchHud({atSurface: false, teleporters: 0, teleportDepthReached: true, teleportUsable: false});
    expect((document.getElementById('teleporterBtn') as HTMLButtonElement).hidden).toBe(true);

    patchHud({teleporters: 1});
    expect((document.getElementById('teleporterBtn') as HTMLButtonElement).hidden).toBe(false);

    // At the depot the trip back rides on the stored point, not on an item.
    patchHud({atSurface: true, teleporters: 0, teleportReturn: false});
    expect((document.getElementById('teleporterBtn') as HTMLButtonElement).hidden).toBe(true);

    patchHud({teleportReturn: true, teleportUsable: true});
    const teleporter = document.getElementById('teleporterBtn') as HTMLButtonElement;
    expect(teleporter.hidden).toBe(false);
    expect(teleporter.textContent).toBe('Return (T)');
  });

  it('paints the scanner line the game formatted, and drops it once the ship is lost', () => {
    render(<MinerApp />);

    patchHud({scanner: 'Scanner ↓: Copper — $16, 4 hits.'});
    const scanner = document.getElementById('scanner') as HTMLElement;
    expect(scanner.textContent).toBe('Scanner ↓: Copper — $16, 4 hits.');
    expect(scanner.hidden).toBe(false);

    patchHud({gameOver: true});
    expect(scanner.hidden).toBe(true);
  });

  it('raises the fuel banner for a dry tank or a climb it can no longer pay for', () => {
    render(<MinerApp />);
    const banner = document.getElementById('fuel-warning') as HTMLElement;

    patchHud({atSurface: false, fuelReserveStatus: 'urgent'});
    expect(banner.className).toMatch(/show/);
    expect(banner.textContent).toContain('RETURN FUEL SPENT');

    // A dry tank is the harder stop, so it takes over the wording.
    patchHud({fuelAlert: true});
    expect(banner.textContent).toContain('LOW FUEL');

    // A disabled ship is always 'urgent'; the banner is not the place to say so.
    patchHud({fuelAlert: false, gameOver: true});
    expect(banner.className).not.toMatch(/show/);
  });

  it('captions the depth readout with the next landmark', () => {
    render(<MinerApp />);

    patchHud({depthMeters: 50, depthTarget: 'Silver', depthTargetKind: 'ore', depthTargetRemaining: 550});
    const target = document.getElementById('depthTarget') as HTMLElement;
    expect(target.textContent).toBe('↓ 550 m to Silver');
    expect(target.dataset.kind).toBe('ore');

    // Past the last ore band the ladder keeps rolling in depth records.
    patchHud({depthTarget: '12000 m depth record', depthTargetKind: 'deep', depthTargetRemaining: 800});
    expect(target.textContent).toBe('↓ 800 m to 12000 m depth record');
    expect(target.dataset.kind).toBe('deep');
  });

  it('mutes music and sound effects from separate buttons', () => {
    const toggleMusic = vi.fn();
    const toggleSfx = vi.fn();
    setUiCommands({toggleMusic, toggleSfx});
    render(<MinerApp />);

    const music = document.getElementById('musicBtn') as HTMLButtonElement;
    const sfx = document.getElementById('sfxBtn') as HTMLButtonElement;

    // Nothing plays before the browser grants audio, so both read as muted.
    expect(music.getAttribute('aria-pressed')).toBe('false');
    expect(sfx.getAttribute('aria-pressed')).toBe('false');
    expect(sfx.textContent).toBe('🔇');

    fireEvent.click(music);
    expect(toggleMusic).toHaveBeenCalledOnce();
    expect(toggleSfx).not.toHaveBeenCalled();

    fireEvent.click(sfx);
    expect(toggleSfx).toHaveBeenCalledOnce();
    expect(toggleMusic).toHaveBeenCalledOnce();
  });

  it('paints each audio switch from its own slice of the store', () => {
    render(<MinerApp />);
    const music = document.getElementById('musicBtn') as HTMLButtonElement;
    const sfx = document.getElementById('sfxBtn') as HTMLButtonElement;

    act(() => { uiStore.getState().setMusic(true, 'Mute music'); });
    expect(music.getAttribute('aria-pressed')).toBe('true');
    expect(music.className).not.toMatch(/muted/);
    expect(music.getAttribute('aria-label')).toBe('Mute music');
    // Effects are untouched by the music switch.
    expect(sfx.getAttribute('aria-pressed')).toBe('false');
    expect(sfx.className).toMatch(/muted/);

    act(() => { uiStore.getState().setSfx(true, 'Mute sound effects'); });
    expect(sfx.getAttribute('aria-pressed')).toBe('true');
    expect(sfx.textContent).toBe('🔊');
    expect(sfx.className).not.toMatch(/muted/);
  });

  /**
   * The 60 Hz contract, now that a live region hangs off the HUD snapshot too: a
   * frame that changed nothing must not reach a single subscriber, or the ship's
   * spoken status would be re-announced sixty times a second.
   */
  it('notifies nobody when a frame changes nothing', () => {
    render(<MinerApp />);
    const notified = vi.fn();
    const unsubscribe = uiStore.subscribe(notified);
    const frame = {...uiStore.getState().hud};

    act(() => { for (let i = 0; i < 5; i++) uiStore.getState().syncHud(frame); });
    expect(notified).not.toHaveBeenCalled();

    act(() => { uiStore.getState().syncHud({...frame, announcement: 'In the mine.'}); });
    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  /**
   * The toast is a `role="status"` live region, so what is left in it after the
   * fade is not a cosmetic detail: an expired message that stays in the element is
   * a message a screen reader can still be handed.
   */
  it('shows the newest toast, fades the expired one out, then empties the live region', async () => {
    vi.useFakeTimers();
    try {
      render(<MinerApp />);
      const toast = document.getElementById('toast') as HTMLElement;
      expect(toast.getAttribute('role')).toBe('status');
      expect(toast.textContent).toBe('');

      act(() => { uiStore.getState().pushToast('Sold cargo for $40.'); });
      expect(toast.textContent).toBe('Sold cargo for $40.');
      expect(toast.className).toMatch(/show/);

      act(() => { uiStore.getState().pushToast('Cargo is empty.'); });
      expect(toast.textContent).toBe('Cargo is empty.');

      // The text outlives the fade-out, so the pill has something to fade with.
      act(() => { uiStore.getState().clearToasts(); });
      expect(toast.textContent).toBe('Cargo is empty.');
      expect(toast.className).not.toMatch(/show/);

      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(toast.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('inventory panel', () => {
  function slotText(): string[] {
    return [...document.querySelectorAll('#inventorySlots > li')].map(slot => slot.textContent ?? '');
  }

  it('shows an empty bay as one placeholder row over a 0/capacity header', () => {
    render(<MinerApp />);

    expect(slotText()).toEqual(['Empty']);
    expect(document.getElementById('inventoryToggleBtn')?.textContent).toContain('0/20');
  });

  it('paints the stacks the game synced, one row per kind, and counts the items', () => {
    render(<MinerApp />);

    act(() => {
      uiStore.getState().setInventorySlots(buildInventorySlots(
        addOre(addOre(addOre(createInventory(), ORES[0], 99)!, ORES[0], 99)!, ORES[1], 99)!
      ));
    });

    expect(slotText()).toEqual(['Coal×2', 'Iron×1']);
    // Three items across two stacks, against the starting capacity.
    expect(document.getElementById('inventoryToggleBtn')?.textContent).toContain('3/20');
  });

  /** Collapsing leaves the header and takes the list out of the document. */
  it('collapses to its header and back', () => {
    render(<MinerApp />);
    const toggle = document.getElementById('inventoryToggleBtn') as HTMLButtonElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('inventorySlots');

    act(() => { fireEvent.click(toggle); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Nothing to point at while it is shut.
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById('inventorySlots')).toBeNull();
    expect(document.getElementById('inventory')).not.toBeNull();

    act(() => { fireEvent.click(toggle); });
    expect(document.getElementById('inventorySlots')).not.toBeNull();
  });

  it('stands down once the ship is lost', () => {
    render(<MinerApp />);

    patchHud({gameOver: true});

    expect((document.getElementById('inventory') as HTMLElement).hidden).toBe(true);
  });

  /**
   * Deployables are placed from the slot that holds them, so those slots — and
   * only those — are controls. Ore has nowhere to be put down and stays text.
   */
  it('makes only the deployable slots placement controls', () => {
    const toggleScannerPlacement = vi.fn();
    const toggleDynamitePlacement = vi.fn();
    setUiCommands({toggleScannerPlacement, toggleDynamitePlacement});
    render(<MinerApp />);

    act(() => {
      uiStore.getState().setInventorySlots(buildInventorySlots(
        addItem(addItem(addOre(createInventory(), ORES[0], 99)!, SCANNER_ITEM, 2)!, DYNAMITE_ITEM, 3)!
      ));
    });

    expect(document.querySelectorAll('#inventorySlots button')).toHaveLength(2);
    const scanner = document.getElementById('scannerSlotBtn')!;
    const dynamite = document.getElementById('dynamiteSlotBtn')!;
    expect(scanner.textContent).toBe('Scanner×2');
    expect(dynamite.textContent).toBe('Dynamite×3');
    expect(dynamite.getAttribute('aria-pressed')).toBe('false');

    act(() => { fireEvent.click(scanner); });
    expect(toggleScannerPlacement).toHaveBeenCalledOnce();
    act(() => { fireEvent.click(dynamite); });
    expect(toggleDynamitePlacement).toHaveBeenCalledOnce();

    // The armed state is the game's to report; the slot only paints it, and only
    // ever one of them, because the mine has just the one press to give.
    act(() => { uiStore.getState().setArmedPlacement(DYNAMITE_ITEM.kind); });
    expect(document.getElementById('dynamiteSlotBtn')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('scannerSlotBtn')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('info dialog tabs', () => {
  it('shows one panel at a time and moves selection on click', () => {
    render(<MinerApp />);
    act(() => { uiStore.getState().setActiveOverlay('info'); });

    expect(document.getElementById('info-objective')).not.toBeNull();
    expect(document.getElementById('info-stats')).toBeNull();

    act(() => { fireEvent.click(document.getElementById('info-tab-stats')!); });

    expect(document.getElementById('info-stats')).not.toBeNull();
    expect(document.getElementById('info-objective')).toBeNull();
    expect(document.getElementById('info-tab-stats')?.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('info-tab-objective')?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement?.id).toBe('info-tab-stats');
  });

  it('roves focus with the arrow keys and selects with Enter', () => {
    render(<MinerApp />);
    act(() => { uiStore.getState().setActiveOverlay('info'); });

    const first = document.getElementById('info-tab-objective')!;
    fireEvent.keyDown(first, {key: 'ArrowRight'});
    expect(document.activeElement?.id).toBe('info-tab-stats');
    // Roving focus alone must not change the visible panel.
    expect(document.getElementById('info-objective')).not.toBeNull();

    act(() => { fireEvent.keyDown(document.activeElement!, {key: 'Enter'}); });
    expect(document.getElementById('info-stats')).not.toBeNull();

    fireEvent.keyDown(document.activeElement!, {key: 'End'});
    expect(document.activeElement?.id).toBe('info-tab-settings');
  });
});

describe('settings tab', () => {
  function openSettings(): void {
    render(<MinerApp />);
    act(() => { uiStore.getState().setActiveOverlay('info'); });
    act(() => { fireEvent.click(document.getElementById('info-tab-settings')!); });
  }

  /** The same two commands the HUD buttons dispatch, not a second audio path. */
  it('mutes music and sound effects through the shared audio commands', () => {
    const toggleMusic = vi.fn();
    const toggleSfx = vi.fn();
    setUiCommands({toggleMusic, toggleSfx});
    openSettings();

    const music = document.getElementById('settingsMusicBtn') as HTMLButtonElement;
    const sfx = document.getElementById('settingsSfxBtn') as HTMLButtonElement;
    expect(music.getAttribute('aria-pressed')).toBe('false');
    expect(music.textContent).toBe('Muted');

    fireEvent.click(music);
    expect(toggleMusic).toHaveBeenCalledOnce();
    expect(toggleSfx).not.toHaveBeenCalled();

    fireEvent.click(sfx);
    expect(toggleSfx).toHaveBeenCalledOnce();

    // The HUD switch and this one read the same slice, so muting is one state.
    act(() => { uiStore.getState().setMusic(true, 'Mute music'); });
    expect(music.getAttribute('aria-pressed')).toBe('true');
    expect(music.textContent).toBe('On');
    expect(music.getAttribute('aria-label')).toBe('Mute music');
    expect(document.getElementById('musicBtn')?.getAttribute('aria-pressed')).toBe('true');
    expect(sfx.getAttribute('aria-pressed')).toBe('false');
  });

  it('never resets on the first press, and only resets once confirmed', () => {
    const resetGame = vi.fn();
    setUiCommands({resetGame});
    openSettings();

    act(() => { fireEvent.click(document.getElementById('resetGameBtn')!); });
    expect(resetGame).not.toHaveBeenCalled();

    // The trigger is gone, and what replaces it in that spot — and on the
    // keyboard — is Cancel, not the button that goes through with it.
    expect(document.getElementById('resetGameBtn')).toBeNull();
    expect(document.activeElement?.id).toBe('resetGameCancelBtn');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('permanently deletes');

    act(() => { fireEvent.click(document.getElementById('resetGameConfirmBtn')!); });
    expect(resetGame).toHaveBeenCalledOnce();
  });

  it('cancels the pending confirm from the Cancel button and by leaving the tab', () => {
    const resetGame = vi.fn();
    setUiCommands({resetGame});
    openSettings();

    act(() => { fireEvent.click(document.getElementById('resetGameBtn')!); });
    act(() => { fireEvent.click(document.getElementById('resetGameCancelBtn')!); });
    expect(document.getElementById('resetGameConfirmBtn')).toBeNull();
    expect(document.getElementById('resetGameBtn')).not.toBeNull();

    // An armed confirm must not be waiting when the tab is opened again.
    act(() => { fireEvent.click(document.getElementById('resetGameBtn')!); });
    act(() => { fireEvent.click(document.getElementById('info-tab-controls')!); });
    act(() => { fireEvent.click(document.getElementById('info-tab-settings')!); });

    expect(document.getElementById('resetGameConfirmBtn')).toBeNull();
    expect(document.getElementById('resetGameBtn')).not.toBeNull();
    expect(resetGame).not.toHaveBeenCalled();
  });
});

describe('cheat menu', () => {
  function openSettings(): void {
    act(() => { uiStore.getState().setActiveOverlay('info'); });
    act(() => { fireEvent.click(document.getElementById('info-tab-settings')!); });
  }

  /**
   * Every player has the cheats, and no build flag or tab of their own: they are
   * one disclosure in Settings, collapsed until it is asked for.
   */
  it('is reachable from Settings with no opt-in, and adds no tab of its own', () => {
    render(<MinerApp />);
    act(() => { uiStore.getState().setActiveOverlay('info'); });

    const tabs = [...document.querySelectorAll('[role="tab"]')].map(tab => tab.id);
    expect(tabs).toEqual([
      'info-tab-objective',
      'info-tab-stats',
      'info-tab-prospecting',
      'info-tab-hazards',
      'info-tab-controls',
      'info-tab-settings'
    ]);
    expect(uiCommands.openInfo).toBeTypeOf('function');

    // Nothing of the menu is in the tree until Settings is open and it is expanded.
    expect(document.getElementById('cheatsToggleBtn')).toBeNull();
    act(() => { fireEvent.click(document.getElementById('info-tab-settings')!); });

    const toggle = document.getElementById('cheatsToggleBtn') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('cheat-menu')).toBeNull();
    expect(document.getElementById('developerUpgrades')).toBeNull();

    act(() => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('cheat-menu');
    expect(document.getElementById('cheat-menu')).not.toBeNull();

    act(() => { fireEvent.click(toggle); });
    expect(document.getElementById('cheat-menu')).toBeNull();
  });

  it('dispatches the cheats and keeps the resets inside the menu', () => {
    const grantDeveloperOres = vi.fn();
    const fillExtractor = vi.fn();
    setUiCommands({grantDeveloperOres, fillExtractor});
    render(<MinerApp />);
    openSettings();
    act(() => { fireEvent.click(document.getElementById('cheatsToggleBtn')!); });

    const menu = document.getElementById('cheat-menu')!;
    expect(menu.contains(document.getElementById('resetPlayerDataBtn'))).toBe(true);
    expect(menu.contains(document.getElementById('resetWorldStateBtn'))).toBe(true);

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-developer-grant-ores]')!);
    expect(grantDeveloperOres).toHaveBeenCalledOnce();

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-developer-fill-extractor]')!);
    expect(fillExtractor).toHaveBeenCalledOnce();
  });

  /** The panel unmounts with the tab, so the 60 Hz sync cannot re-render it. */
  it('collapses again when the Settings tab is left', () => {
    render(<MinerApp />);
    openSettings();
    act(() => { fireEvent.click(document.getElementById('cheatsToggleBtn')!); });
    expect(document.getElementById('cheat-menu')).not.toBeNull();

    act(() => { fireEvent.click(document.getElementById('info-tab-controls')!); });
    expect(document.getElementById('cheat-menu')).toBeNull();

    act(() => { fireEvent.click(document.getElementById('info-tab-settings')!); });
    expect(document.getElementById('cheat-menu')).toBeNull();
    expect(document.getElementById('cheatsToggleBtn')?.getAttribute('aria-expanded')).toBe('false');
  });
});
