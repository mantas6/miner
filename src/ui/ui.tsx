// The application shell.
//
// Everything inside is a component subscribed to `store.ts`; the game writes to
// that store once per frame and never touches the DOM outside the canvas. The
// element ids that remain (#game, #game-panel, and the button/dialog ids the
// tests and the keyboard layer reach for) are a deliberate, documented contract.
//
// The canvas and the panel are also the two elements the simulation is mounted
// *against*: `useGameRuntime` hands the refs to the injected runtime factory and
// disposes it on unmount, so the game's lifetime is this component's lifetime.
// Rendering the shell without a factory (the UI tests) mounts chrome and no game.
//
// The intro overlay is mounted by phase, not hidden by class: it exists in the
// tree only before the run starts.
//
// The canvas is the only tab stop of the game surface, and it carries the whole
// accessible account of it: a name, a description listing the keys, and a polite
// live region for the state a sighted player reads off the pixels. The panel
// around it is layout, so it is not focusable — two tab stops for one surface
// meant a Tab that appeared to do nothing.

import { CargoScreen } from './CargoScreen';
import { ExtractorScreen } from './ExtractorScreen';
import { RuntimeFailure } from './Failure';
import { FuelWarning } from './FuelWarning';
import { Hud } from './Hud';
import { InfoScreen } from './InfoScreen';
import { Intro } from './Intro';
import { ShipScreen } from './ShipScreen';
import { StationHint } from './StationHint';
import { StationScreen } from './StationScreen';
import { TradeScreen } from './TradeScreen';
import { useUiStore } from './store';
import { Toast } from './Toast';
import { useGameRuntime, type GameRuntimeFactory } from './useGameRuntime';
import common from './common.module.css';

export interface MinerAppProps {
  /** Builds the simulation around the mounted canvas. Omitted: chrome only. */
  createRuntime?: GameRuntimeFactory;
}

export function MinerApp({ createRuntime }: MinerAppProps) {
  const phase = useUiStore(state => state.phase);
  const { canvasRef, panelRef } = useGameRuntime(createRuntime);
  return (
    <main id="shell">
      {/* The panel only sizes and positions the surface; the canvas inside it is
          the keyboard target, focused by the runtime from the first frame. */}
      <section id="game-panel" ref={panelRef}>
        {/* `application` is the honest role for a canvas the arrow keys drive: it
            tells a screen reader to hand the keys straight through to the game
            instead of spending them on its own browse-mode navigation. The lint
            rule below reads a focusable canvas as an interactive element being
            demoted; here the focusability and the role say the same thing, which
            is that this is the control. */}
        <canvas
          ref={canvasRef}
          id="game"
          width={960}
          height={640}
          tabIndex={0}
          // oxlint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
          role="application"
          aria-label="Stalinload mine"
          aria-describedby="game-instructions"
        />
        {/* Both of these are for screen readers only: the mine itself is pixels,
            so without them the surface has a name and nothing else. */}
        <p id="game-instructions" className={common.srOnly}>
          Drill for ore and bring it back to the home base before the fuel runs out.
          WASD or the arrow keys move, fly and dig. Space uses the nearby home
          station — the Manufacturing Station to stow and craft, the Oil Extractor
          to refuel. E plants dynamite, T uses a teleporter, C opens a cargo
          container the ship is standing on or beside. Escape closes an open screen.
          The readouts after this report cash, depth, fuel and hull; the Info
          and Cargo button has the full rules.
        </p>
        <GameStatus />
        <Hud />
        <ShipScreen />
        <InfoScreen />
        <CargoScreen />
        <StationScreen />
        <ExtractorScreen />
        <TradeScreen />
        <FuelWarning />
        <StationHint />
        <Toast />
        {phase === 'intro' && <Intro />}
      </section>
      <RuntimeFailure />
    </main>
  );
}

/**
 * The mine's state changes, spoken.
 *
 * The meters carry the numbers, but where the ship is and whether it is in
 * trouble were only ever legible from the canvas. This is one line of text and no
 * pixels, so it adds nothing to the screen: `core/ship-status.ts` formats it out
 * of a handful of booleans, so the field only changes when the ship crosses one of
 * those thresholds — a 60 Hz sync re-renders nothing here.
 */
function GameStatus() {
  const announcement = useUiStore(state => state.hud.announcement);
  return <p id="game-status" className={common.srOnly} aria-live="polite">{announcement}</p>;
}
