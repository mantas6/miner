// The two ways this app can stop working, and the one notice both of them use.
//
// `RuntimeFailure` covers the simulation failing to start (no 2D context, a save
// that will not load): the chrome is fine, the mine behind it is not.
// `AppErrorBoundary` covers the opposite — a React crash, which used to leave the
// canvas happily simulating behind a HUD that had silently unmounted.
//
// Both are deliberately plain: one line of what happened, one line of detail, and
// a reload. Anything more would be chrome nobody should ever see.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useUiStore } from './store';
import styles from './Failure.module.css';

interface FailureNoticeProps {
  id: string;
  title: string;
  message: string;
  detail?: string | null;
}

function FailureNotice({id, title, message, detail}: FailureNoticeProps) {
  return (
    <div id={id} className={styles.notice} role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      {/* One id for both notices: they never stand at once (the boundary's
          fallback replaces the tree the runtime notice lives in). */}
      <button id="failureReloadBtn" type="button" onClick={() => location.reload()}>Reload</button>
    </div>
  );
}

/** Shown while the runtime status is `failed`, and only then. */
export function RuntimeFailure() {
  const failed = useUiStore(state => state.runtimeStatus === 'failed');
  const detail = useUiStore(state => state.runtimeError);
  if (!failed) return null;
  return (
    <FailureNotice
      id="runtime-failure"
      title="Mine offline"
      message="The drill runtime could not start, so nothing is being simulated."
      detail={detail}
    />
  );
}

interface BoundaryState {
  message: string | null;
}

/**
 * Catches a render/effect crash anywhere in the shell. Unmounting the tree also
 * runs the runtime's effect cleanup, so a crash stops the simulation instead of
 * leaving it running against a HUD that is no longer there.
 */
export class AppErrorBoundary extends Component<{children: ReactNode}, BoundaryState> {
  state: BoundaryState = {message: null};

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {message: error instanceof Error ? error.message : String(error)};
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Interface crashed', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <FailureNotice
        id="app-failure"
        title="Interface crashed"
        message="The game stopped to avoid running without its controls."
        detail={this.state.message}
      />
    );
  }
}
