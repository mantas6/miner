// Everything the game remembers between visits, in one list.
//
// The save file is only part of it: the audio switches and the camera framing
// are deliberately kept *outside* `SAVE_KEY` so a wiped run keeps the setup the
// player chose (see `game/zoom-settings.ts`). "Reset game" is the
// one action meant to undo all of it, so it has to name every key rather than
// call `localStorage.clear()` — the origin is shared with anything else served
// from it, and clearing wholesale is not ours to do.
//
// Adding a preference key without adding it here leaves a reset that does not
// reset, so the list lives next to `persistence.ts` and imports the constants
// from the modules that own them instead of restating the strings.

import { AUDIO_SETTINGS_KEY } from './audio/audio-settings';
import { ZOOM_SETTINGS_KEY } from './game/zoom-settings';
import { SAVE_KEY } from './persistence';

/**
 * The keys earlier builds wrote, before the game took its own name. Nothing reads
 * or writes them any more — a save under the old key is simply never found, which
 * is the same fresh start the version gate gives — but a returning player's
 * storage may still hold them, and "Reset game" promises to leave nothing behind.
 */
export const LEGACY_STORAGE_KEYS = [
  'moleload-progress-v1',
  'moleload:audio-settings:v1',
  'moleload:zoom-settings:v1'
] as const;

/** Every `localStorage` key the game writes, or ever wrote. */
export const PERSISTED_STORAGE_KEYS = [
  SAVE_KEY,
  AUDIO_SETTINGS_KEY,
  ZOOM_SETTINGS_KEY,
  ...LEGACY_STORAGE_KEYS
] as const;

export const GAME_RESET_CONFIRMATION = 'Reset the game? This permanently deletes your saved run — cash, upgrades, equipment, stats, explored fog and dug terrain — along with your audio and zoom settings, then reloads the page.';

/**
 * Drop every stored key. Each removal is guarded on its own: a storage
 * implementation that refuses one key must not leave the rest behind.
 */
export function clearPersistedGameData(): void {
  for (const key of PERSISTED_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be disabled or partly unavailable; keep clearing the others.
    }
  }
}
