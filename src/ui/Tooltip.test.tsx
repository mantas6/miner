// @vitest-environment happy-dom
//
// The one hover tooltip as a unit: the dwell before it shows, the hide on leave,
// blur and Escape, the focus path, and that it paints nothing while idle. What the
// text says lives in core/item-info.test.ts; this only proves the show/hide gate.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { oreKind, type InventoryItemKind } from '../core/inventory';
import { Tooltip, TOOLTIP_DELAY_MS, useItemTooltip } from './Tooltip';

function Harness({kind = oreKind('Gold'), extra}: {kind?: InventoryItemKind; extra?: string[]}) {
  const handlers = useItemTooltip(kind, extra);
  return (
    <>
      <button type="button" {...handlers}>Gold</button>
      <Tooltip />
    </>
  );
}

function tooltip(): HTMLElement | null {
  return document.querySelector('[role="tooltip"]');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('renders nothing while idle', () => {
    render(<Tooltip />);
    expect(tooltip()).toBeNull();
  });

  it('shows the item after the dwell on hover, and hides on leave', () => {
    vi.useFakeTimers();
    const {container} = render(<Harness extra={['Iron 1/3']} />);
    const button = container.querySelector('button')!;

    fireEvent.mouseEnter(button);
    // Nothing before the dwell elapses.
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1); });
    expect(tooltip()).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    const tip = tooltip();
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('Gold');
    // The extra lines a recipe row passes through show below the item's own text.
    expect(tip!.textContent).toContain('Iron 1/3');

    fireEvent.mouseLeave(button);
    expect(tooltip()).toBeNull();
  });

  it('shows on focus and hides on blur', () => {
    vi.useFakeTimers();
    const {container} = render(<Harness />);
    const button = container.querySelector('button')!;

    fireEvent.focus(button);
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(tooltip()).not.toBeNull();

    fireEvent.blur(button);
    expect(tooltip()).toBeNull();
  });

  it('hides on Escape without swallowing the key', () => {
    vi.useFakeTimers();
    const {container} = render(<Harness />);
    const button = container.querySelector('button')!;

    fireEvent.focus(button);
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(tooltip()).not.toBeNull();

    const event = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    act(() => { window.dispatchEvent(event); });

    expect(tooltip()).toBeNull();
    // The game's own Escape handling still runs: the tooltip never calls preventDefault.
    expect(event.defaultPrevented).toBe(false);
  });

  it('cancels a pending show when the pointer leaves before the dwell', () => {
    vi.useFakeTimers();
    const {container} = render(<Harness />);
    const button = container.querySelector('button')!;

    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(tooltip()).toBeNull();
  });
});
