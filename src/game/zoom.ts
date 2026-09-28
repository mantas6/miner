// Camera zoom arithmetic, kept free of the DOM and of the viewport singleton so
// the clamping and the wheel response can be reasoned about (and tested) on their
// own. `viewport.ts` owns the current level; this module only says what a wheel
// notch is worth and where the range ends.

/** Widest view: half-size tiles, twice as much mine on screen. */
export const MIN_ZOOM = 0.5;
/** Closest view: double-size tiles. */
export const MAX_ZOOM = 2;
/** The unzoomed baseline, one screen pixel per world pixel. */
export const DEFAULT_ZOOM = 1;

// `deltaMode` is a unit, not a magnitude: Firefox reports lines and paging
// devices report pages, so both are converted to the pixels every other browser
// already sends before the response curve sees them.
const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

// A trackpad pinch arrives as a ctrl-held wheel with far smaller deltas than a
// mouse notch, so it needs its own — much steeper — pixels-to-zoom response.
const WHEEL_RESPONSE = 0.0016;
const PINCH_RESPONSE = 0.012;

export interface WheelZoomEvent {
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. Absent is treated as pixels. */
  deltaMode?: number;
  /** Trackpad pinch gestures arrive as a wheel event with ctrl held. */
  ctrlKey?: boolean;
}

/** Keep a zoom level inside the supported range; nonsense falls back to 1x. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The event's scroll distance in pixels, whatever unit it was reported in. */
export function wheelPixels(event: WheelZoomEvent): number {
  if (!Number.isFinite(event.deltaY)) return 0;
  if (event.deltaMode === 1) return event.deltaY * LINE_PIXELS;
  if (event.deltaMode === 2) return event.deltaY * PAGE_PIXELS;
  return event.deltaY;
}

/**
 * The zoom one wheel event leads to. Exponential, so a notch is worth the same
 * proportion of the view at every level and the range cannot be crossed in one
 * jump; scrolling up (negative delta) zooms in.
 */
export function zoomAfterWheel(zoom: number, event: WheelZoomEvent): number {
  const response = event.ctrlKey ? PINCH_RESPONSE : WHEEL_RESPONSE;
  return clampZoom(clampZoom(zoom) * Math.exp(-wheelPixels(event) * response));
}

/**
 * The levels the `+`/`-` keys step through: quarter steps across the whole range,
 * so a key press lands on a level worth naming rather than wherever the wheel's
 * curve would have put it.
 */
export const ZOOM_KEY_LEVELS: readonly number[] = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);

/**
 * The zoom one `+` (`direction` 1) or `-` (`direction` -1) press leads to: the next
 * key level past the current one in that direction, or the current level clamped
 * when it is already at that end. A level the wheel left between two steps goes to
 * the neighbouring step, so the first press never overshoots one.
 */
export function zoomAfterKey(zoom: number, direction: 1 | -1): number {
  const current = clampZoom(zoom);
  const epsilon = 1e-6;
  if (direction > 0) return ZOOM_KEY_LEVELS.find(level => level > current + epsilon) ?? current;
  const lower = ZOOM_KEY_LEVELS.filter(level => level < current - epsilon);
  return lower.length > 0 ? lower[lower.length - 1] : current;
}

/**
 * Camera position that holds the current view centre still while the visible
 * span changes, so zooming grows and shrinks around the ship instead of pulling
 * the world toward the top-left corner.
 */
export function recenteredCamera(camera: number, previousSpan: number, nextSpan: number): number {
  return camera + (previousSpan - nextSpan) / 2;
}
