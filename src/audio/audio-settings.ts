// Remembered audio preferences: the soundtrack and the sound effects are two
// independent switches, so a player who mutes the music keeps their drill hits.
//
// Both default to on, which matches the pre-toggle behaviour: audio is wanted,
// the browser simply has not granted it until the first trusted gesture.

export const AUDIO_SETTINGS_KEY = 'stalinload:audio-settings:v1';

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {music: true, sfx: true};

export function loadAudioSettings(): AudioSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || 'null');
    return {
      music: typeof stored?.music === 'boolean' ? stored.music : DEFAULT_AUDIO_SETTINGS.music,
      sfx: typeof stored?.sfx === 'boolean' ? stored.sfx : DEFAULT_AUDIO_SETTINGS.sfx
    };
  } catch {
    return {...DEFAULT_AUDIO_SETTINGS};
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be disabled or full; the toggles still work for this session.
  }
}
