// Cargo, stats, guides and controls as a native modal dialog: the browser keeps
// focus inside it, so there is no hand-rolled focus trap here. Tab selection is
// still a WAI-ARIA tablist with roving focus.
//
// The overlay is split three ways on purpose. The shell owns the `<dialog>` and
// nothing else, the card owns the tablist, and each panel is its own component
// that subscribes to the store itself. Only the selected panel is mounted, so a
// closed Info screen holds one boolean subscription, an open one holds only the
// slices the visible tab actually paints, and the 60 Hz cargo/stat sync cannot
// re-render a tab nobody is looking at.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ECONOMY } from '../core/balance';
import { CARGO_CONTAINER } from '../core/cargo-container';
import { buildDangerGuideRows } from '../core/danger';
import { DYNAMITE } from '../core/dynamite';
import { PROSPECTING_TIP, buildArtifactGuideRows, buildProspectingGuideRows } from '../core/prospecting';
import { SCANNER_DEVICE } from '../core/scanner-device';
import { GAME_RESET_CONFIRMATION } from '../persistence-reset';
import { DeveloperPanel } from './DeveloperPanel';
import { getInfoNavigationSections, getInfoTabFocusTarget, type InfoTab } from './info-navigation';
import { uiCommands } from './commands';
import { uiStore, useUiStore } from './store';
import styles from './InfoScreen.module.css';

const prospectingRows = buildProspectingGuideRows();
const artifactRows = buildArtifactGuideRows();
const dangerRows = buildDangerGuideRows();

/** The dialog shell: open/close mechanics and focus restoration, no content. */
export function InfoScreen() {
  const open = useUiStore(state => state.activeOverlay === 'info');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
      document.getElementById('infoBtn')?.focus({preventScroll: true});
    }
  }, [open]);

  return (
    <dialog
      id="info-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="info-title"
      // A native close request (Escape reaching the UA, a form submit) must not
      // leave the store thinking the info screen is still open.
      onClose={() => uiCommands.closeInfo()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeInfo(); }}
    >
      {open && <InfoCard closeRef={closeRef} />}
    </dialog>
  );
}

interface InfoCardProps {
  closeRef: RefObject<HTMLButtonElement | null>;
}

function InfoCard({closeRef}: InfoCardProps) {
  const activeTab = useUiStore(state => state.infoTab);
  const sections = getInfoNavigationSections();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Every tab starts at the top of the card, as the imperative version did. Only
  // the body scrolls — the header stays put — so it is the element to reset.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [activeTab]);

  function selectTab(id: InfoTab): void {
    uiStore.getState().setInfoTab(id);
    document.getElementById(sections.find(section => section.id === id)?.tabId ?? '')?.focus({preventScroll: true});
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, id: InfoTab): void {
    const key = event.key.toLowerCase();
    if (key === 'enter' || key === ' ') {
      selectTab(id);
      event.preventDefault();
      return;
    }
    const target = getInfoTabFocusTarget(id, key);
    if (!target) return;
    document.getElementById(target.tabId)?.focus({preventScroll: true});
    event.preventDefault();
  }

  return (
    <div id="info-card" className={styles.card}>
      {/* Outside the scrolling body on purpose: the close button stays reachable
          however far the panel below is scrolled. */}
      <div className={styles.header}>
        <h2 id="info-title">Cargo &amp; Controls</h2>
        <button
          id="infoCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close info screen"
          onClick={event => { event.stopPropagation(); uiCommands.closeInfo(); }}
        >×</button>
      </div>
      <div ref={bodyRef} className={styles.body}>
        <div className={styles.navigation} aria-label="Info sections" role="tablist" aria-orientation="horizontal">
          {sections.map(section => (
            <button
              key={section.id}
              id={section.tabId}
              type="button"
              role="tab"
              data-info-section={section.id}
              // Only the selected panel is in the document, so only the selected tab
              // can point at one.
              aria-controls={section.id === activeTab ? section.id : undefined}
              aria-selected={section.id === activeTab}
              tabIndex={section.id === activeTab ? 0 : -1}
              onClick={() => selectTab(section.id)}
              onKeyDown={event => onTabKeyDown(event, section.id)}
            >{section.label}</button>
          ))}
        </div>

        {activeTab === 'info-objective' && <ObjectivePanel />}
        {activeTab === 'info-stats' && <StatsPanel />}
        {activeTab === 'info-prospecting' && <ProspectingPanel />}
        {activeTab === 'info-hazards' && <HazardsPanel />}
        {activeTab === 'info-controls' && <ControlsPanel />}
        {activeTab === 'info-settings' && <SettingsPanel />}
      </div>
    </div>
  );
}

/** The one panel the game keeps writing to while it is up. */
function ObjectivePanel() {
  const objective = useUiStore(state => state.hud.objective);
  const extractionInfo = useUiStore(state => state.hud.extractionInfo);
  const cargoRows = useUiStore(state => state.cargoRows);

  return (
    <section id="info-objective" role="tabpanel" aria-labelledby="info-tab-objective" tabIndex={-1}>
      <h3 id="cargo-bay-title">Cargo Bay</h3>
      <p id="objectiveInfoStatus" className={styles.objectiveStatus}>{objective}</p>
      <p id="extractionInfoStatus" className={styles.extractionStatus}>{extractionInfo}</p>
      <ul id="cargoList" className={styles.cargoList}>
        {cargoRows.length === 0
          ? <li className={styles.emptyCargo}>Cargo bay empty</li>
          : cargoRows.map(row => (
            <li key={row.name}>
              <span className={styles.oreIcon} style={{background: row.color}}></span>
              <span className={styles.oreName}>{row.name}</span>
              <span className={styles.oreCount}>× {row.count}</span>
              <span className={styles.oreValue}>${row.value}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}

function StatsPanel() {
  const statRows = useUiStore(state => state.statRows);

  return (
    <section id="info-stats" role="tabpanel" aria-labelledby="info-tab-stats" tabIndex={-1}>
      <h3 id="expedition-stats-title">Expedition Stats</h3>
      <ul id="expeditionStats" className={styles.expeditionStats} aria-label="Saved career progress">
        {statRows.map(row => (
          <li key={row.label}>
            <span className={styles.statLabel}>{row.label}</span>
            <strong>{row.value}</strong>
            <span className={styles.statDetail}>{row.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProspectingPanel() {
  return (
    <section id="info-prospecting" role="tabpanel" aria-labelledby="info-tab-prospecting" tabIndex={-1}>
      <h3 id="prospecting-title">Prospecting Guide</h3>
      <p className={styles.prospectingTip}>{PROSPECTING_TIP}</p>
      <p className={styles.prospectingTip}><strong>Rare artifacts:</strong> drill them for immediate cash. They never use cargo, need no surface sale, and dynamite destroys them without payout.</p>
      <ul id="artifactGuide" className={styles.prospectingGuide} aria-label="Rare artifact values and approximate depth bands">
        {artifactRows.map(row => (
          <li key={row.name}>
            <span className={styles.oreIcon} style={{background: row.color}} aria-hidden="true"></span>
            <span className={styles.oreName}>{row.name}</span>
            <span className={styles.oreValue}>{row.valueLabel}</span>
            <span className={styles.oreDepth}>{row.depthLabel}</span>
          </li>
        ))}
      </ul>
      <ul id="prospectingGuide" className={styles.prospectingGuide} aria-label="Ore values and approximate depth bands">
        {prospectingRows.map(row => (
          <li key={row.name}>
            <span className={styles.oreIcon} style={{background: row.color}} aria-hidden="true"></span>
            <span className={styles.oreName}>{row.name}</span>
            <span className={styles.oreValue}>{row.valueLabel}</span>
            <span className={styles.oreDepth}>{row.depthLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HazardsPanel() {
  return (
    <section id="info-hazards" role="tabpanel" aria-labelledby="info-tab-hazards" tabIndex={-1}>
      <h3 id="danger-guide-title">Hazard / Fiend Survival</h3>
      <p className={styles.dangerTip}>Plan a return route before the mine gets hostile: deep rewards bring rock, magma, and tunnel fiends.</p>
      <ul id="dangerGuide" className={styles.dangerGuide} aria-label="Hazard and tunnel fiend survival guide">
        {dangerRows.map(row => (
          <li key={row.title}>
            <strong>{row.title}</strong>
            <span>{row.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ControlsPanel() {
  return (
    <section id="info-controls" role="tabpanel" aria-labelledby="info-tab-controls" tabIndex={-1}>
      <h3 id="controls-title">Controls</h3>
      {/* Every row is exactly two cells: the keys that do the thing, then the
          sentence about it. The keys are wrapped even when there is only one of
          them, because the row is a grid — left loose, a second `<kbd>` and the
          words between them become grid items of their own, and whichever badge
          landed in the flexible column was stretched across it. */}
      <ul className={styles.controlList}>
        <li><span className={styles.controlKeys}><kbd>WASD</kbd> / <kbd>Arrows</kbd></span><span>Move, fly, and dig</span></li>
        <li><span className={styles.controlKeys}><strong>Fog map</strong></span><span>Movement permanently reveals a 3x3 footprint around the ship. Co-op miners share explored tiles.</span></li>
        <li><span className={styles.controlKeys}><kbd>Shift</kbd> + movement</span><span>Sprint through open space at increased fuel cost; open-space descent is free and drilling stays normal. Slamming a boosted ship into rock, a ceiling, or a wall buckles the hull.</span></li>
        <li><span className={styles.controlKeys}><kbd>Enter</kbd></span><span>Sell cargo at the surface depot</span></li>
        <li><span className={styles.controlKeys}><kbd>Space</kbd></span><span>Repair or refuel at the surface</span></li>
        <li><span className={styles.controlKeys}><kbd>E</kbd> / <strong>Dynamite slot</strong> then a mine tile</span><span>Plant one carried stick on explored, cleared ground. It blows a {ECONOMY.dynamite.radius}-tile radius after a {DYNAMITE.fuseSeconds}-second fuse: blasts yield no cargo, destroyed artifacts grant no cash, and a ship still inside the radius takes hull damage. Escape cancels.</span></li>
        <li><span className={styles.controlKeys}><kbd>T</kbd> / <kbd>Teleport</kbd></span><span>At 100 m or deeper, spend one teleporter from the cargo bay to visit the depot, then press T again to return to the same underground location for free</span></li>
        <li><span className={styles.controlKeys}><kbd>G</kbd> / <kbd>Arm Gun</kbd> then a direction key</span><span>Spend one carried Linebreaker on a shot up to {ECONOMY.gun.range} tiles; press G or Escape to cancel aiming without using it. Shots destroy the first eligible block or enemy, but valuables give no cargo or artifact cash.</span></li>
        <li><span className={styles.controlKeys}><strong>Scanner slot</strong> then a mine tile</span><span>Deploy one carried scanner onto explored, cleared ground; it maps its {SCANNER_DEVICE.size}×{SCANNER_DEVICE.size} surroundings, one fogged tile every {SCANNER_DEVICE.intervalSeconds} seconds, then goes inert. Escape cancels.</span></li>
        <li><span className={styles.controlKeys}><strong>Container slot</strong> then a mine tile</span><span>Set one carried cargo container down on explored, cleared ground. Escape cancels.</span></li>
        <li><span className={styles.controlKeys}><kbd>C</kbd> / press the crate</span><span>Open a placed container the ship is standing on or beside. Press a stack in either column to move it across; the crate holds up to {CARGO_CONTAINER.capacity} items and keeps them through death and reload, and anything taken back aboard still obeys the cargo-bay limit.</span></li>
        <li><span className={styles.controlKeys}><kbd>R</kbd> then <kbd>R</kbd></span><span>Confirm reset while alive</span></li>
      </ul>
    </section>
  );
}

/**
 * The audio switches, the cheat menu, and the one destructive action.
 *
 * The switches are the HUD's, not a second set: they dispatch the same commands
 * and read the same store slices, so muting here moves the HUD button too.
 *
 * The cheats are one disclosure rather than a tab of their own: they are a rarely
 * used corner of Settings, not a seventh thing to read past on every visit. Their
 * panel is mounted only while expanded, so the ship snapshot it prices its buttons
 * from is subscribed to only while someone is looking at it.
 *
 * Reset asks first, and it asks inline rather than through `window.confirm()`.
 * The panel is inside a modal `<dialog>`, so a native prompt would be a second
 * modal stacked on the first. The confirm state is local and the panel unmounts
 * with the tab, so leaving Settings always cancels it.
 *
 * Cancel takes the trigger's place and the keyboard, and the button that goes
 * through with it is elsewhere in the row: the second half of a double-click, or
 * an Enter still held from the first press, must not be able to answer the
 * question the first press only just asked.
 */
function SettingsPanel() {
  const musicOn = useUiStore(state => state.musicOn);
  const musicLabel = useUiStore(state => state.musicLabel);
  const sfxOn = useUiStore(state => state.sfxOn);
  const sfxLabel = useUiStore(state => state.sfxLabel);
  const [cheatsOpen, setCheatsOpen] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmingReset) cancelRef.current?.focus({preventScroll: true});
  }, [confirmingReset]);

  return (
    <section id="info-settings" role="tabpanel" aria-labelledby="info-tab-settings" tabIndex={-1}>
      <h3 id="settings-audio-title">Audio</h3>
      <ul className={styles.settingsList} aria-labelledby="settings-audio-title">
        <li>
          <span>Music</span>
          <button
            id="settingsMusicBtn"
            type="button"
            aria-label={musicLabel}
            aria-pressed={musicOn}
            onClick={() => uiCommands.toggleMusic()}
          >{musicOn ? 'On' : 'Muted'}</button>
        </li>
        <li>
          <span>Sound effects</span>
          <button
            id="settingsSfxBtn"
            type="button"
            aria-label={sfxLabel}
            aria-pressed={sfxOn}
            onClick={() => uiCommands.toggleSfx()}
          >{sfxOn ? 'On' : 'Muted'}</button>
        </li>
      </ul>

      <h3 id="settings-cheats-title">Cheats</h3>
      <button
        id="cheatsToggleBtn"
        type="button"
        className={styles.cheatsToggle}
        aria-expanded={cheatsOpen}
        aria-controls={cheatsOpen ? 'cheat-menu' : undefined}
        onClick={() => setCheatsOpen(open => !open)}
      >{cheatsOpen ? 'Hide cheat menu' : 'Show cheat menu'}</button>
      {cheatsOpen && <DeveloperPanel />}

      <h3 id="settings-reset-title">Reset game</h3>
      <div className={styles.resetGame} aria-labelledby="settings-reset-title">
        {confirmingReset
          ? (
            <>
              <p role="alert">{GAME_RESET_CONFIRMATION}</p>
              <div className={styles.resetGameActions}>
                <button id="resetGameCancelBtn" ref={cancelRef} type="button" onClick={() => setConfirmingReset(false)}>Cancel</button>
                <button id="resetGameConfirmBtn" type="button" onClick={() => uiCommands.resetGame()}>Delete everything</button>
              </div>
            </>
          )
          : (
            <>
              <p>Delete the saved run and every stored setting, then start over from a fresh mine.</p>
              <button id="resetGameBtn" type="button" onClick={() => setConfirmingReset(true)}>Reset game…</button>
            </>
          )}
      </div>
    </section>
  );
}
