// The one hover tooltip.
//
// A single popup, driven by one tiny store: whatever slot, recipe row or
// offer the pointer (or the keyboard focus) is resting on writes its anchor rect
// and item kind here, and this component paints `describeItem(kind)` beside it.
// Only one thing is ever hovered at once, so one store field and one popup cover
// every screen — no per-screen tooltip, no clutter left behind when a menu closes.
//
// An open modal `<dialog>` sits in the browser's top layer, above every z-index,
// so a popup merely portalled to `document.body` would paint *under* it. The popup
// is therefore a manual popover: `showPopover()` promotes it into the top layer
// too, and — shown after the dialog — above it. It is also portalled *into* the
// open dialog, because everything outside a modal dialog is inert; where popovers
// are missing, that alone lifts it along with its host.
//
// While shown, the anchor points at it with `aria-describedby`, so a screen reader
// reads the same text a sighted player hovers for.
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

/** The popup's id, which the anchor names in `aria-describedby` while it is shown. */
export const TOOLTIP_ID = 'item-tooltip';

/** Whether this browser can promote an element into the top layer as a popover. */
function supportsPopover(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
}

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
  // The anchor *this* hook is currently showing the popup for, so unmounting a row
  // hides only its own tooltip and never one an adjacent row just opened.
  const shownRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (shownRef.current) tooltipStore.getState().hide();
  }, []);

  const open = (element: HTMLElement) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const box = element.getBoundingClientRect();
      shownRef.current = element;
      element.setAttribute('aria-describedby', TOOLTIP_ID);
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
      shownRef.current.removeAttribute('aria-describedby');
      shownRef.current = null;
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
 * row is hovered it shows a small panel next to the anchor in the top layer,
 * measured after paint and clamped to the viewport so it never hangs off an edge.
 */
export function Tooltip() {
  const active = useStore(tooltipStore, state => state.active);
  const ref = useRef<HTMLDivElement>(null);
  // The resolved position, tagged with the content it was computed for: until it
  // matches the current `active`, the panel paints hidden so it never flashes at a
  // stale spot on the first frame of a new hover.
  const [pos, setPos] = useState<{content: TooltipContent; left: number; top: number} | null>(null);

  const host = active ? tooltipHost() : null;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    // A popover is display:none until shown, so it has to be up before it is measured.
    if (supportsPopover() && !element.matches(':popover-open')) element.showPopover();
    const {width, height} = element.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let left = active.rect.left;
    let top = active.rect.bottom + GAP;
    if (left + width > viewW - MARGIN) left = viewW - MARGIN - width;
    if (left < MARGIN) left = MARGIN;
    // No room below? Flip above the anchor.
    if (top + height > viewH - MARGIN) top = active.rect.top - height - GAP;
    if (top < MARGIN) top = MARGIN;
    // A popover in the top layer is positioned against the viewport. Inside a dialog
    // without one, `position: fixed` resolves against the dialog's box instead — its
    // backdrop filter makes it the containing block.
    const origin = !supportsPopover() && host && host !== document.body
      ? host.getBoundingClientRect()
      : {left: 0, top: 0};
    setPos({content: active, left: left - origin.left, top: top - origin.top});
  }, [active, host]);

  // Escape also dismisses the tooltip, but must not swallow the key: no
  // preventDefault/stopPropagation, so the game's Escape (closing the overlay) runs too.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      document.querySelector(`[aria-describedby="${TOOLTIP_ID}"]`)?.removeAttribute('aria-describedby');
      tooltipStore.getState().hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  if (!active || !host) return null;

  const info = describeItem(active.kind);
  const lines = active.extra ? [...info.lines, ...active.extra] : info.lines;
  const ready = pos !== null && pos.content === active;
  const style = ready
    ? {left: pos.left, top: pos.top}
    : {left: active.rect.left, top: active.rect.bottom + GAP, visibility: 'hidden' as const};

  return createPortal(
    <div
      ref={ref}
      id={TOOLTIP_ID}
      className={styles.tooltip}
      role="tooltip"
      style={style}
      {...(supportsPopover() ? {popover: 'manual' as const} : {})}
    >
      <span className={styles.title}>{info.title}</span>
      {lines.map(line => (
        <span key={line} className={styles.line}>{line}</span>
      ))}
    </div>,
    host
  );
}

/**
 * The popup's mount point: the open modal dialog, the one part of the page that is
 * not inert while it is up, else `document.body`.
 */
function tooltipHost(): HTMLElement {
  return document.querySelector<HTMLElement>('dialog[open]') ?? document.body;
}
