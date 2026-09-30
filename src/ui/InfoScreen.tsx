// Cargo, stats, guides and controls as a native modal dialog: the browser keeps
// focus inside it, so there is no hand-rolled focus trap here. Tab selection is
// still a WAI-ARIA tablist with roving focus.
//
// The overlay is split three ways on purpose. The shell (`ModalShell`) owns the
// `<dialog>` and nothing else, the card owns the tablist, and each panel is its own component
// that subscribes to the store itself. Only the selected panel is mounted, so a
// closed Info screen holds one boolean subscription, an open one holds only the
// slices the visible tab actually paints, and the 60 Hz cargo/stat sync cannot
// re-render a tab nobody is looking at.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DANGER_TIP, buildDangerGuideRows } from '../core/danger';
import { NO_POSTS_FOUND } from '../core/post-beacon';
import { GALLERY_TIP, PROSPECTING_TIP, SHIP_LADDER_TIP, buildProspectingGuideRows } from '../core/prospecting';
import { GAME_RESET_CONFIRMATION } from '../persistence-reset';
import { DeveloperPanel } from './DeveloperPanel';
import { CONTROL_ROWS } from './info-controls';
import { getInfoNavigationSections, getInfoTabFocusTarget, type InfoTab } from './info-navigation';
import { uiCommands } from './commands';
import { CardHeader, ModalShell } from './ModalShell';
import { uiStore, useUiStore } from './store';
import styles from './InfoScreen.module.css';

const prospectingRows = buildProspectingGuideRows();
const dangerRows = buildDangerGuideRows();

/** The dialog shell: open/close mechanics and focus restoration, no content. */
export function InfoScreen() {
  const open = useUiStore(state => state.overlay?.kind === 'info');
  return (
    <ModalShell
      id="info-screen"
      titleId="info-title"
      open={open}
      onRequestClose={() => uiCommands.closeInfo()}
      returnFocusId="infoBtn"
    >
      {open && <InfoCard />}
    </ModalShell>
  );
}

function InfoCard() {
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
      <CardHeader
        titleId="info-title"
        title="Cargo & Controls"
        closeId="infoCloseBtn"
        closeLabel="Close info screen"
        onClose={() => uiCommands.closeInfo()}
      />
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
  const cargoRows = useUiStore(state => state.cargoRows);

  return (
    <section id="info-objective" role="tabpanel" aria-labelledby="info-tab-objective" tabIndex={-1}>
      <h3 id="cargo-bay-title">Cargo Bay</h3>
      <p id="objectiveInfoStatus" className={styles.objectiveStatus}>{objective}</p>
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
  const postRows = useUiStore(state => state.postRows);
  return (
    <section id="info-prospecting" role="tabpanel" aria-labelledby="info-tab-prospecting" tabIndex={-1}>
      <h3 id="prospecting-title">Prospecting Guide</h3>
      <p className={styles.prospectingTip}>{PROSPECTING_TIP}</p>
      <p className={styles.prospectingTip}>{GALLERY_TIP}</p>
      <p className={styles.prospectingTip}>{SHIP_LADDER_TIP}</p>
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
      <h3 id="prospecting-posts-title">Trading posts found</h3>
      <ul id="prospectingPosts" className={styles.prospectingPosts} aria-labelledby="prospecting-posts-title">
        {postRows.length === 0
          ? <li className={styles.emptyCargo}>{NO_POSTS_FOUND}</li>
          : postRows.map(row => (
            <li key={`${row.x},${row.y}`}>
              <span className={styles.oreName}>{row.depthMeters.toLocaleString('en-US')} m</span>
              <span className={styles.oreDepth}>x {row.x}, y {row.y}</span>
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
      <p className={styles.dangerTip}>{DANGER_TIP}</p>
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
        {CONTROL_ROWS.map(row => (
          <li key={row.action}>
            <span className={styles.controlKeys}>
              {/* A row's parts are a fixed sequence that never reorders, and the
                  same key can appear twice in it (R then R), so position is the key. */}
              {row.keys.map((part, index) => part.kind === 'text'
                ? part.text
                // oxlint-disable-next-line react/no-array-index-key
                : part.kind === 'key' ? <kbd key={index}>{part.text}</kbd> : <strong key={index}>{part.text}</strong>)}
            </span>
            <span>{row.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The audio switches, the cheat menu, save export/import, and the one destructive
 * action.
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
 * modal stacked on the first. The confirm (and the cheat disclosure) are store
 * flags, so the agent's observation can read them, and the store drops them
 * whenever the tab changes or Info reopens, so leaving Settings always cancels it.
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
  const cheatsOpen = useUiStore(state => state.cheatsOpen);
  const confirmingReset = useUiStore(state => state.confirmingReset);
  const {setCheatsOpen, setConfirmingReset} = uiStore.getState();
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
            aria-label="Music"
            aria-pressed={musicOn}
            title={musicLabel}
            onClick={() => uiCommands.toggleMusic()}
          >{musicOn ? 'On' : 'Muted'}</button>
        </li>
        <li>
          <span>Sound effects</span>
          <button
            id="settingsSfxBtn"
            type="button"
            aria-label="Sound effects"
            aria-pressed={sfxOn}
            title={sfxLabel}
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
        onClick={() => setCheatsOpen(!cheatsOpen)}
      >
        Cheat menu <span aria-hidden="true">{cheatsOpen ? '▾' : '▸'}</span>
      </button>
      {cheatsOpen && <DeveloperPanel />}

      <SaveDataSection />

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

/**
 * Export and import of the saved run, beside the reset it is the gentler cousin of.
 *
 * Export hands the save over twice — as a download, and as text in a read-only box
 * that only appears once there is something in it. Import takes a file or a paste
 * into one box, and asks inline before replacing the run, the same way Reset does
 * and for the same reasons: Cancel takes the trigger's place and the focus, and
 * the confirm flag is dropped with the tab. The save itself is only checked
 * by the command, so a bad paste is refused in one place with one message.
 */
function SaveDataSection() {
  const saveExport = useUiStore(state => state.saveExport);
  const [importText, setImportText] = useState('');
  const confirmingImport = useUiStore(state => state.confirmingImport);
  const {setConfirmingImport} = uiStore.getState();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmingImport) cancelRef.current?.focus({preventScroll: true});
  }, [confirmingImport]);

  function chooseFile(file: File | undefined): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(typeof reader.result === 'string' ? reader.result : '');
      setConfirmingImport(false);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <h3 id="settings-save-title">Save data</h3>
      <div className={styles.saveData} role="group" aria-labelledby="settings-save-title">
        <p>Download the saved run to keep or move it, or bring one back.</p>
        <button id="exportSaveBtn" type="button" onClick={() => uiCommands.exportSave()}>Export save</button>
        {saveExport !== null && (
          <textarea
            id="exportSaveText"
            aria-label="Exported save"
            readOnly
            rows={3}
            value={saveExport}
            onFocus={event => event.currentTarget.select()}
          />
        )}
        <label className={styles.saveFile}>
          <span>Import from file</span>
          <input
            id="importSaveFileInput"
            type="file"
            accept=".json,application/json"
            onChange={event => { chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
          />
        </label>
        <textarea
          id="importSaveText"
          aria-label="Save to import"
          placeholder="…or paste a save here"
          rows={3}
          value={importText}
          onChange={event => { setImportText(event.currentTarget.value); setConfirmingImport(false); }}
        />
        {confirmingImport
          ? (
            <>
              <p role="alert">Replace the current run with this save? Your cash, upgrades, stats and dug terrain are overwritten, then the page reloads.</p>
              <div className={styles.saveDataActions}>
                <button id="importSaveCancelBtn" ref={cancelRef} type="button" onClick={() => setConfirmingImport(false)}>Cancel</button>
                <button
                  id="importSaveConfirmBtn"
                  type="button"
                  onClick={() => { setConfirmingImport(false); uiCommands.importSave(importText); }}
                >Replace run</button>
              </div>
            </>
          )
          : <button id="importSaveBtn" type="button" onClick={() => setConfirmingImport(true)}>Import save…</button>}
      </div>
    </>
  );
}
