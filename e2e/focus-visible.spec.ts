// The focus ring, which is the one accessibility affordance that cannot be
// asserted anywhere but a real browser: `:focus-visible` is a UA heuristic about
// *how* focus arrived, and the runtime moves focus programmatically all the time
// (at boot, on window focus, when a dialog closes, when a run starts).
//
// So the contract is not "the canvas is focused" — that is `boot.spec.ts` — it is
// "the ring is drawn when the player asked for it with the keyboard, and gone once
// they have used the mouse".
//
// Worth knowing before reading the assertions: Chromium propagates the flag
// through programmatic focus, seeding it from the *first* focus of the page. The
// runtime focuses the canvas at boot before anything has been clicked, so a run
// that was never touched with the mouse legitimately starts with the ring up. The
// interesting claim is therefore about what a click does, and that is what is
// pinned here.

import { expect, test, type Locator } from '@playwright/test';
import { isFocusVisible, startRun } from './support/game';

/** The computed ring, so the assertions cover the CSS and not just the selector. */
function outline(locator: Locator): Promise<{style: string; width: string; offset: string}> {
  return locator.evaluate(element => {
    const computed = getComputedStyle(element);
    return {style: computed.outlineStyle, width: computed.outlineWidth, offset: computed.outlineOffset};
  });
}

/** Splash → run, without a single keystroke. */
const startRunByPointer = (page: Parameters<typeof startRun>[0]) => startRun(page, 'click');

test.describe('focus ring', () => {
  test('appears when Tab moves focus, on the HUD and back on the canvas', async ({page}) => {
    await startRunByPointer(page);
    const music = page.locator('#musicBtn');
    const canvas = page.locator('#game');

    await page.keyboard.press('Tab');
    await expect(music).toBeFocused();
    expect(await isFocusVisible(music)).toBe(true);
    expect(await outline(music)).toEqual({style: 'solid', width: '3px', offset: '2px'});

    await page.keyboard.press('Shift+Tab');
    await expect(canvas).toBeFocused();
    expect(await isFocusVisible(canvas)).toBe(true);
    // Inside the frame, so the ring is not lost against the page behind it.
    expect(await outline(canvas)).toEqual({style: 'solid', width: '3px', offset: '-5px'});
  });

  test('is gone from a HUD button that a mouse click focused', async ({page}) => {
    await startRunByPointer(page);
    const music = page.locator('#musicBtn');

    // Ring up, by keyboard.
    await page.keyboard.press('Tab');
    expect(await isFocusVisible(music)).toBe(true);

    // Same button, now focused by a click instead.
    await page.keyboard.press('Shift+Tab');
    await music.click();
    await expect(music).toBeFocused();
    expect(await isFocusVisible(music)).toBe(false);
    expect((await outline(music)).style).toBe('none');
  });

  test('is gone from the canvas that a mouse click focused', async ({page}) => {
    await startRunByPointer(page);
    const canvas = page.locator('#game');

    // Park the ring somewhere else first, so the click below is a real focus
    // change: Chromium only re-decides the flag when focus actually moves, so a
    // click on the element that already has focus changes nothing.
    await page.keyboard.press('Tab');
    await expect(page.locator('#musicBtn')).toBeFocused();

    // The centre of the mine: the HUD is a top bar, meters and an action row, so
    // the middle of the canvas is where a click reaches the game surface.
    await canvas.click();
    await expect(canvas).toBeFocused();
    expect(await isFocusVisible(canvas)).toBe(false);
    expect((await outline(canvas)).style).toBe('none');
  });

  test('is not drawn on the trigger a clicked-shut dialog hands focus back to', async ({page}) => {
    await startRunByPointer(page);
    const info = page.locator('#infoBtn');

    // Opened and closed entirely with the mouse, so the focus the dialog restores
    // is programmatic on top of a pointer interaction — no ring, which is the
    // whole reason `base.css` uses `:focus-visible` and not `:focus`.
    await info.click();
    await expect(page.locator('#info-screen')).toBeVisible();
    await page.locator('#infoCloseBtn').click();
    await expect(page.locator('#info-screen')).toBeHidden();
    await expect(info).toBeFocused();
    expect(await isFocusVisible(info)).toBe(false);
    expect((await outline(info)).style).toBe('none');
  });
});
