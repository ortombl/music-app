import { useCallback, useEffect } from 'react';
import { DEFAULT_SETTINGS, FRET_OPTIONS, tuningStrings, usePersistentState, type LabelMode, type Settings } from './state/settings';
import { matchPreset, tuningNotes } from './theory/tunings';
import type { AccidentalPref } from './theory/notes';
import { ChordFinder } from './components/ChordFinder';
import { ProgressionBuilder } from './components/ProgressionBuilder';
import { TuningPicker } from './components/TuningPicker';

type Tab = 'finder' | 'progression';

// C major (x32010) in standard tuning as a friendly starting point.
const DEFAULT_SELECTION: (number | null)[] = [null, 3, 2, 0, 1, 0];

export function App() {
  const [settings, setSettings] = usePersistentState<Settings>('settings', DEFAULT_SETTINGS);
  const [tab, setTab] = usePersistentState<Tab>('tab', 'finder');
  const [items, setItems] = usePersistentState<string[]>('progression', ['Am7', 'D7', 'Gmaj7', 'Cmaj7']);
  const [selection, setSelection] = usePersistentState<(number | null)[]>('selection', DEFAULT_SELECTION);
  const tuning = tuningStrings(settings);

  // Keep the chord-finder selection in step with the number of strings.
  const sel = selection.length === tuning.length ? selection : new Array<number | null>(tuning.length).fill(null);
  useEffect(() => {
    if (selection.length !== tuning.length) setSelection(new Array<number | null>(tuning.length).fill(null));
  }, [selection.length, tuning.length, setSelection]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const update = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v })), [setSettings]);

  const addToProgression = (symbol: string) => setItems((prev) => [...prev, symbol]);
  const openInFinder = (frets: (number | null)[]) => {
    setSelection(frets);
    setTab('finder');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path d="M16 3c7 0 12 2.6 12 7.4 0 6.8-6.9 15.3-10 18.2a2.9 2.9 0 0 1-4 0C10.9 25.7 4 17.2 4 10.4 4 5.6 9 3 16 3z" fill="var(--accent)" />
            <path d="M10 11h12M10 15h12M10 19h12" stroke="var(--accent-contrast)" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
          </svg>
          <div>
            <div className="brand-name">Fretboard Lab</div>
            <div className="brand-sub">chords · arpeggios · progressions</div>
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          <button type="button" role="tab" aria-selected={tab === 'finder'} className={tab === 'finder' ? 'active' : ''} onClick={() => setTab('finder')}>
            Chord finder
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'progression'}
            className={tab === 'progression' ? 'active' : ''}
            onClick={() => setTab('progression')}
          >
            Progression {items.length > 0 && <span className="badge">{items.length}</span>}
          </button>
        </nav>
        <button
          type="button"
          className="btn icon theme-toggle"
          onClick={() => update('theme', settings.theme === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
          title="Toggle light / dark theme"
        >
          {settings.theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div className="settings-bar" role="region" aria-label="Instrument settings">
        <TuningPicker
          settings={settings}
          strings={tuning}
          onChange={(id, custom) => setSettings((s) => ({ ...s, tuningId: id, customStrings: custom ?? s.customStrings }))}
        />
        <span className="tuning-readout" title="Open strings, low to high">
          {tuning.length} strings · {tuningNotes(tuning)}
        </span>
        <label className="field">
          <span>Frets</span>
          <select value={settings.frets} onChange={(e) => update('frets', Number(e.target.value))}>
            {FRET_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Labels</span>
          <select value={settings.labelMode} onChange={(e) => update('labelMode', e.target.value as LabelMode)}>
            <option value="notes">Note names</option>
            <option value="octave">Notes + octave</option>
            <option value="intervals">Intervals</option>
            <option value="frets">Fret numbers</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="field">
          <span>♯/♭</span>
          <select value={settings.accidentals} onChange={(e) => update('accidentals', e.target.value as AccidentalPref)}>
            <option value="auto">Auto</option>
            <option value="sharp">Sharps</option>
            <option value="flat">Flats</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.showAllNotes} onChange={(e) => update('showAllNotes', e.target.checked)} />
          Show all notes
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.leftHanded} onChange={(e) => update('leftHanded', e.target.checked)} />
          Left-handed
        </label>
      </div>

      <main>
        {tab === 'finder' ? (
          <ChordFinder settings={settings} tuning={tuning} selection={sel} setSelection={setSelection} onAddToProgression={addToProgression} />
        ) : (
          <ProgressionBuilder
            settings={settings}
            tuning={tuning}
            items={items}
            setItems={setItems}
            onOpenInFinder={openInFinder}
            onSetTuning={(strings) => {
              const preset = matchPreset(strings);
              setSettings((s) => ({ ...s, tuningId: preset ? preset.id : 'custom', customStrings: preset ? s.customStrings : strings }));
            }}
          />
        )}
      </main>

      <footer className="app-footer">
        Fretboard Lab · all analysis runs in your browser · settings are remembered on this device
        {/^https?:$/.test(window.location.protocol) && (
          <>
            {' · '}
            <a href={window.location.href.split('#')[0]} download="fretboard-lab.html">
              Download for offline use
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
