// Tiny inline icons for the icon-only HUD buttons. Decorative: the button carries
// the accessible name, so every icon is `aria-hidden` and draws in `currentColor`.

const common = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false
} as const;

/** A beamed pair of eighth notes. */
export function MusicIcon() {
  return (
    <svg {...common}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" fill="currentColor" />
      <circle cx="17" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

/** A speaker, with sound waves while on and a cross while muted. */
export function SpeakerIcon({on}: {on: boolean}) {
  return (
    <svg {...common}>
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on
        ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        : <path d="M17 9l5 6M22 9l-5 6" />}
    </svg>
  );
}
