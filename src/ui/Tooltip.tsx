// The one hover tooltip.
//
// A single popup, portalled to `document.body` so it escapes the modal `<dialog>`
// and the panel's clipping, driven by one tiny store: whatever slot, recipe row or
// offer the pointer (or the keyboard focus) is resting on writes its anchor rect
// and item kind here, and this component paints `describeItem(kind)` beside it.
// Only one thing is ever hovered at once, so one store field and one popup cover
// every screen — no per-screen tooltip, no clutter left behind when a menu closes.
//
// `useItemTooltip(kind, extraLines?)` returns the handlers a row spreads onto its
// element: a 120 ms dwell before it shows (so a passing cursor never flashes it),
// and a hide on leave, blur, Escape, or the owning row unmounting with the overlay.
// The Escape key only *also* hides the tooltip — it never calls preventDefault, so
// the game's own Escape (closing the overlay) still runs.

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { describeItem } from '../core/item-info';
import type { InventoryItemKind } from '../core/inventory';
import styles from './Tooltip.module.css';

/** The dwell before a hovered row shows its tooltip: long enough to skip a passing cursor. */
export const TOOLTIP_DELAY_MS = 120;

/** Gap between the anchor and the popup, and the margin it keeps from the viewport edge. */
const GAP = 8;
const MARGIN = 8;

/** The anchor's on-screen box, copied so the store holds no live DOM node. */
interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the popup is currently showing, or `null` when nothing is hovered. */
interface TooltipContent {
  rect: AnchorRect;
  kind: InventoryItemKind;
  /** Extra lines below the item's own description, e.g. a recipe's have/need counts. */
  extra?: string[];
}

interface TooltipStore {
  active: TooltipContent | null;
  show(content: TooltipContent): void;
  hide(): void;
}

/** The single hover slice: one popup's worth of state, shared by every row's hook. */
const tooltipStore = createStore<TooltipStore>(set => ({
  active: null,
  show: content => set({active: content}),
  hide: () => set({active: null})
}));

/**
 * Handlers a row spreads onto its element to give it a tooltip. Dwell on
 * `mouseenter`/`focus`, hide on `mouseleave`/`blur`; the owning element must be
 * focusable (buttons already are — add `tabIndex={0}` only to a non-interactive
 * row) so keyboard users get the same text.
 */
export function useItemTooltip(kind: InventoryItemKind, extraLines?: string[]) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Whether *this* hook is the one currently showing the popup, so unmounting a row
  // hides only its own tooltip and never one an adjacent row just opened.
  const shownRef = useRef(false);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (shownRef.current) tooltipStore.getState().hide();
  }, []);

  const open = (element: HTMLElement) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const box = element.getBoundingClientRect();
      shownRef.current = true;
      tooltipStore.getState().show({
        rect: {left: box.left, top: box.top, right: box.right, bottom: box.bottom},
        kind,
        extra: extraLines
      });
    }, TOOLTIP_DELAY_MS);
  };

  const close = () => {
    clearTimeout(timerRef.current);
    if (shownRef.current) {
      shownRef.current = false;
      tooltipStore.getState().hide();
    }
  };

  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => open(event.currentTarget),
    onMouseLeave: close,
    onFocus: (event: FocusEvent<HTMLElement>) => open(event.currentTarget),
    onBlur: close
  };
}

/**
 * The popup itself, mounted once by `ui.tsx`. Renders nothing while idle; while a
 * row is hovered it portals a small panel next to the anchor, measured after paint
 * and clamped to the viewport so it never hangs off an edge.
 */
export function Tooltip() {
  const active = useStore(tooltipStore, state => state.active);
  const ref = useRef<HTMLDivElement>(null);
  // The resolved position, tagged with the content it was computed for: until it
  // matches the current `active`, the panel paints hidden so it never flashes at a
  // stale spot on the first frame of a new hover.
  const [pos, setPos] = useState<{content: TooltipContent; left: number; top: number} | null>(null);

  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const {width, height} = ref.current.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let left = active.rect.left;
    let top = active.rect.bottom + GAP;
    if (left + width > viewW - MARGIN) left = viewW - MARGIN - width;
    if (left < MARGIN) left = MARGIN;
    // No room below? Flip above the anchor.
    if (top + height > viewH - MARGIN) top = active.rect.top - height - GAP;
    if (top < MARGIN) top = MARGIN;
    setPos({content: active, left, top});
  }, [active]);

  // Escape also dismisses the tooltip, but must not swallow the key: no
  // preventDefault/stopPropagation, so the game's Escape (closing the overlay) runs too.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') tooltipStore.getState().hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  if (!active) return null;

  const info = describeItem(active.kind);
  const lines = active.extra ? [...info.lines, ...active.extra] : info.lines;
  const ready = pos !== null && pos.content === active;
  const style = ready
    ? {left: pos.left, top: pos.top}
    : {left: active.rect.left, top: active.rect.bottom + GAP, visibility: 'hidden' as const};

  return createPortal(
    <div ref={ref} className={styles.tooltip} role="tooltip" style={style}>
      <span className={styles.title}>{info.title}</span>
      {lines.map(line => (
        <span key={line} className={styles.line}>{line}</span>
      ))}
    </div>,
    document.body
  );
}
