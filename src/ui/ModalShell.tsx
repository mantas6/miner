// The one modal `<dialog>` shell every overlay screen wears.
//
// The shell owns the mechanics and nothing else: `showModal()`/`close()` follow
// `open`, the first focus lands on the card's close button (or whatever control
// the card hands it through `useModalFocus()`), and every way the browser has of
// asking the dialog to go away — the UA's own close request, a cancel, a press on
// the dimmed area around the card — is reported through the one `onRequestClose`.
// The screen inside stays a plain card that subscribes to the store itself.
//
// A native modal `<dialog>` already contains Tab, makes the page behind it inert,
// and restores focus to the control that opened it on close, so none of that is
// hand-rolled here.
//
// `dismissible={false}` is the no-close prompt (the respawn list): the backdrop
// press and the UA's cancel are vetoed, and a close the UA forces through anyway
// is undone, so only the screen's own pick can take it down. The keyboard layer
// (`input.ts`) swallows Escape and Space for it the same way.

import clsx from 'clsx';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject
} from 'react';
import styles from './dialog.module.css';

/** The control the shell focuses as the dialog opens, published to the card. */
const ModalFocusContext = createContext<RefObject<HTMLButtonElement | null> | null>(null);

/**
 * The ref a card attaches to the control that should take focus as the dialog
 * opens. `CardHeader`'s close button uses it; a card without one (the grave's OK)
 * attaches it itself. Unattached, the browser picks the first focusable control.
 */
export function useModalFocus(): RefObject<HTMLButtonElement | null> | null {
  return useContext(ModalFocusContext);
}

export interface ModalShellProps {
  /** The dialog's element id — the id the harness and the e2e suite address. */
  id: string;
  /** The id of the heading that names the dialog. */
  titleId: string;
  /** The id of the element that describes it, if any. */
  describedById?: string;
  open: boolean;
  /** Every close the browser or the backdrop asks for; the game decides. */
  onRequestClose(): void;
  /** False for a prompt with no way out but its own choices. Default true. */
  dismissible?: boolean;
  /** Focus this element once the dialog has closed, instead of the opener. */
  returnFocusId?: string;
  children?: ReactNode;
}

export function ModalShell({
  id,
  titleId,
  describedById,
  open,
  onRequestClose,
  dismissible = true,
  returnFocusId,
  children
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      focusRef.current?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
      if (returnFocusId) document.getElementById(returnFocusId)?.focus({preventScroll: true});
    }
  }, [open, returnFocusId]);

  return (
    <dialog
      id={id}
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby={titleId}
      aria-describedby={describedById}
      // A native close request (Escape reaching the UA, a form submit) must not
      // leave the game thinking the screen is still open — unless it may not close,
      // in which case the dialog goes straight back up.
      onClose={() => {
        const dialog = dialogRef.current;
        if (!dismissible && open && dialog && !dialog.open) { dialog.showModal(); return; }
        onRequestClose();
      }}
      onCancel={event => { if (!dismissible) event.preventDefault(); }}
      onPointerDown={event => {
        if (dismissible && event.target === dialogRef.current) onRequestClose();
      }}
    >
      <ModalFocusContext.Provider value={focusRef}>{children}</ModalFocusContext.Provider>
    </dialog>
  );
}

export interface CardHeaderProps {
  /** The heading's id — the shell's `titleId`. */
  titleId: string;
  title: ReactNode;
  /** Extra class for the heading, for a screen that tints its title. */
  titleClassName?: string;
  /** The close button's id; omit (with `onClose`) for a card that cannot close. */
  closeId?: string;
  /** The close button's accessible name, e.g. "Close trading post". */
  closeLabel?: string;
  onClose?(): void;
  /** Anything that sits between the title and the close, e.g. the wallet. */
  children?: ReactNode;
}

/**
 * The card's fixed title row: the heading, anything the screen slots beside it,
 * and the round × close button, which is the control the dialog opens focused on.
 * It stays outside the card's scrolling body, so the close is reachable however
 * far the body is scrolled.
 */
export function CardHeader({titleId, title, titleClassName, closeId, closeLabel, onClose, children}: CardHeaderProps) {
  const focusRef = useModalFocus();
  return (
    <div className={styles.header}>
      <h2 id={titleId} className={clsx(styles.title, titleClassName)}>{title}</h2>
      {children}
      {onClose && (
        <button
          id={closeId}
          ref={focusRef}
          type="button"
          className={styles.closeBtn}
          aria-label={closeLabel}
          onClick={event => { event.stopPropagation(); onClose(); }}
        >×</button>
      )}
    </div>
  );
}
