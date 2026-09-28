// Remembered camera zoom.
//
// The framing a player picked is a preference, not run progress, so it lives
// beside the audio switches rather than inside the save file:
// resetting player data, dying, or starting a fresh mine all keep the view the
// player set up, and a save that fails to load cannot drag the zoom back to 1x.
//
// Only the level is stored — never the easing `zoom` mid-glide — and it is
// clamped on the way in *and* the way out, so a hand-edited or stale key can
// never boot the game into a view the wheel could not have reached.

import { clampZoom, DEFAULT_ZOOM } from './zoom';

export const ZOOM_SETTINGS_KEY = 'stalinload:zoom-settings:v1';

/** The remembered level, clamped to the supported range; anything else reads as 1x. */
export function loadZoomLevel(): number {
  try {
    const stored = JSON.parse(localStorage.getItem(ZOOM_SETTINGS_KEY) || 'null');
    return typeof stored?.zoom === 'number' ? clampZoom(stored.zoom) : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function saveZoomLevel(zoom: number): void {
  try {
    localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({zoom: clampZoom(zoom)}));
  } catch {
    // Storage may be disabled or full; the wheel still zooms for this session.
  }
}
