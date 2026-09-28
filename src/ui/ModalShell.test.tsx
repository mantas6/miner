// @vitest-environment happy-dom
//
// The shared dialog shell as a unit: it follows `open`, lands focus on the card's
// close, reports every close the browser or the backdrop asks for through one
// callback, and — non-dismissible — vetoes all of them. What the browser itself
// does with a modal `<dialog>` (Tab containment, the inert page, Escape) is only
// real in e2e/dialogs.spec.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardHeader, ModalShell, useModalFocus } from './ModalShell';

function Shell({open, onRequestClose, dismissible, returnFocusId}: {
  open: boolean;
  onRequestClose(): void;
  dismissible?: boolean;
  returnFocusId?: string;
}) {
  return (
    <>
      <button id="opener" type="button">Open</button>
      <ModalShell
        id="test-screen"
        titleId="test-title"
        open={open}
        onRequestClose={onRequestClose}
        dismissible={dismissible}
        returnFocusId={returnFocusId}
      >
        {open && (
          <div id="test-card">
            <CardHeader titleId="test-title" title="Test" closeId="testCloseBtn" closeLabel="Close test" onClose={onRequestClose} />
            <button id="inside" type="button">Inside</button>
          </div>
        )}
      </ModalShell>
    </>
  );
}

function dialog(): HTMLDialogElement {
  return document.getElementById('test-screen') as HTMLDialogElement;
}

afterEach(() => {
  cleanup();
});

describe('ModalShell', () => {
  it('opens as a modal labelled by its title, focused on the close button', () => {
    const {rerender} = render(<Shell open={false} onRequestClose={vi.fn()} />);
    expect(dialog().open).toBe(false);

    rerender(<Shell open onRequestClose={vi.fn()} />);

    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute('aria-labelledby')).toBe('test-title');
    expect(document.getElementById('test-title')!.textContent).toBe('Test');
    expect(document.activeElement?.id).toBe('testCloseBtn');
    expect(document.getElementById('testCloseBtn')!.getAttribute('type')).toBe('button');
  });

  it('closes again when `open` drops, and can hand focus to a named control', () => {
    const {rerender} = render(<Shell open onRequestClose={vi.fn()} returnFocusId="opener" />);
    rerender(<Shell open={false} onRequestClose={vi.fn()} returnFocusId="opener" />);

    expect(dialog().open).toBe(false);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('reports the close button, the backdrop and a native close, but not a press on the card', () => {
    const onRequestClose = vi.fn();
    render(<Shell open onRequestClose={onRequestClose} />);

    fireEvent.click(document.getElementById('testCloseBtn')!);
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    // The dialog box itself is the dimmed area; the card inside it is not.
    fireEvent.pointerDown(document.getElementById('inside')!);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(dialog());
    expect(onRequestClose).toHaveBeenCalledTimes(2);

    // Escape reaching the UA closes the dialog natively; the game must hear of it.
    act(() => { dialog().close(); });
    expect(onRequestClose).toHaveBeenCalledTimes(3);
  });

  it('vetoes every way out when not dismissible', () => {
    const onRequestClose = vi.fn();
    render(<Shell open onRequestClose={onRequestClose} dismissible={false} />);

    fireEvent.pointerDown(dialog());
    const cancel = new Event('cancel', {cancelable: true});
    dialog().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);

    // A close the UA forces through anyway is undone on the spot.
    act(() => { dialog().close(); });
    expect(dialog().open).toBe(true);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('lets a card without a header hand its own control the first focus', () => {
    function OkCard() {
      const okRef = useModalFocus();
      return <button id="okBtn" ref={okRef} type="button">OK</button>;
    }
    render(
      <ModalShell id="test-screen" titleId="none" open onRequestClose={vi.fn()}>
        <button id="first" type="button">First</button>
        <OkCard />
      </ModalShell>
    );

    expect(document.activeElement?.id).toBe('okBtn');
  });

  it('leaves the close button out of a header that cannot close', () => {
    render(
      <ModalShell id="test-screen" titleId="test-title" open onRequestClose={vi.fn()} dismissible={false}>
        <CardHeader titleId="test-title" title="Pick one" closeId="testCloseBtn" />
      </ModalShell>
    );

    expect(document.getElementById('testCloseBtn')).toBeNull();
  });
});
