import { useEffect, useMemo, useRef, useState } from 'react';
import { spellChord } from '../theory/chords';
import { describeInversion, identifyChord } from '../theory/identify';
import { labelInChord, prettyDegree } from '../theory/intervals';
import { formatNote, INTERVAL_NAMES, midiName, mod12, pcName } from '../theory/notes';
import { generateVoicings } from '../theory/voicings';
import type { Settings } from '../state/settings';
import { sequence, strum } from '../audio/synth';
import { degreeColor, NEUTRAL_COLOR } from './colors';
import { Fretboard, type Marker } from './Fretboard';
import { intervalText } from './NoteMap';
import { ArpeggioExplorer } from './ArpeggioExplorer';
import { ChordDiagram } from './ChordDiagram';
import { Legend } from './Legend';

interface Props {
  settings: Settings;
  tuning: number[];
  selection: (number | null)[];
  setSelection: (s: (number | null)[]) => void;
  onAddToProgression: (symbol: string) => void;
}

const SELECT_COLOR = '#6d5dfc';

export function ChordFinder({ settings, tuning, selection, setSelection, onAddToProgression }: Props) {
  const pref = settings.accidentals;
  const notes = useMemo(
    () =>
      selection
        .map((f, s) => (f === null || f > settings.frets ? null : { string: s, fret: f, midi: tuning[s] + f }))
        .filter((x): x is { string: number; fret: number; midi: number } => x !== null),
    [selection, tuning, settings.frets],
  );
  const midiKey = notes.map((n) => n.midi).join(',');
  const matches = useMemo(() => identifyChord(notes.map((n) => n.midi), pref, 8), [midiKey, pref]);
  const [choice, setChoice] = useState(0);
  const [showArps, setShowArps] = useState(false);
  const [showVoicings, setShowVoicings] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const arpRef = useRef<HTMLDivElement>(null);

  useEffect(() => setChoice(0), [midiKey]);
  const match = matches.length ? matches[Math.min(choice, matches.length - 1)] : null;
  const spelled = match ? spellChord(match.chord, pref) : null;

  const nameOf = (pc: number): string => {
    const t = spelled?.tones.find((x) => x.pc === pc);
    if (t) return formatNote(t.note);
    if (spelled?.bass && match?.chord.bassPc === pc) return formatNote(spelled.bass);
    return pcName(pc, pref);
  };
  const intervalOf = (midi: number): string | null => (match ? labelInChord(midi - match.chord.rootPc, match.chord.type.degrees) : null);

  const markerText = (midi: number, fret: number): string => {
    switch (settings.labelMode) {
      case 'octave':
        return midiName(midi, pref, spelled?.tones.find((x) => x.pc === mod12(midi))?.note);
      case 'intervals': {
        const iv = intervalOf(midi);
        return iv ? intervalText(iv) : nameOf(mod12(midi));
      }
      case 'frets':
        return String(fret);
      case 'none':
        return '';
      default:
        return nameOf(mod12(midi));
    }
  };

  const markers: Marker[] = notes.map((n) => {
    const iv = intervalOf(n.midi);
    const foreignBass = match && match.inversion === 'slash' && mod12(n.midi) === match.chord.bassPc;
    return {
      string: n.string,
      fret: n.fret,
      label: markerText(n.midi, n.fret),
      color: !match ? SELECT_COLOR : foreignBass ? NEUTRAL_COLOR : degreeColor(iv),
      ring: !!match && mod12(n.midi) === match.chord.rootPc,
      title: `${midiName(n.midi, pref)}${iv ? ` — ${intervalText(iv)}` : ''}`,
    };
  });

  const ghost = settings.showAllNotes
    ? (_s: number, fret: number, midi: number) => {
        switch (settings.labelMode) {
          case 'octave':
            return midiName(midi, pref);
          case 'intervals': {
            const iv = intervalOf(midi);
            return iv ? intervalText(iv) : pcName(mod12(midi), pref);
          }
          case 'frets':
            return String(fret);
          case 'none':
            return null;
          default:
            return nameOf(mod12(midi));
        }
      }
    : undefined;

  const toggle = (s: number, f: number) => setSelection(selection.map((x, i) => (i === s ? (x === f ? null : f) : x)));
  const toggleString = (s: number) => setSelection(selection.map((x, i) => (i === s ? (x === null ? 0 : null) : x)));
  const clear = () => {
    setSelection(selection.map(() => null));
    setShowArps(false);
  };

  const voicings = useMemo(
    () => (match && showVoicings ? generateVoicings(match.chord, tuning, settings.frets, { limit: 12 }) : []),
    [match, showVoicings, tuning, settings.frets],
  );

  const midis = notes.map((n) => n.midi);
  const pcs = [...new Set(midis.map(mod12))];

  useEffect(() => {
    if (showArps) arpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showArps]);

  const currentTab = selection.map((f) => (f === null ? 'x' : f)).join(selection.some((f) => f !== null && f > 9) ? ' ' : '');

  return (
    <>
      <section className="card finder" aria-label="Chord finder">
        <div className="card-head">
          <div>
            <h2>Build a chord</h2>
            <p className="hint">
              Click a fret to place a note (one per string, click again to remove). Click a string's name to play it open or mute it.
            </p>
          </div>
          <div className="row gap wrap">
            <button type="button" className="btn" disabled={!midis.length} onClick={() => strum(midis)}>
              ▶ Strum
            </button>
            <button
              type="button"
              className="btn"
              disabled={!midis.length}
              onClick={() => {
                const up = [...midis].sort((a, b) => a - b);
                sequence([...up, ...up.slice(0, -1).reverse()], 150);
              }}
            >
              ▶ Arpeggiate
            </button>
            <button type="button" className="btn" disabled={!midis.length} onClick={clear}>
              Clear
            </button>
          </div>
        </div>
        <Fretboard
          tuning={tuning}
          frets={settings.frets}
          markers={markers}
          ghost={ghost}
          interactive
          selection={selection}
          onToggle={toggle}
          onStringLabel={toggleString}
          leftHanded={settings.leftHanded}
          accidentals={pref}
          ariaLabel="Interactive fretboard"
        />
        <div className="finder-foot">
          <span className="tab-readout" title="Current shape (low → high string)">
            Shape: <code>{currentTab}</code>
          </span>
          {match && <Legend only={[...new Set(match.chord.type.degreeInfo.map((d) => d.step + 1))].sort()} />}
        </div>
      </section>

      <section className="card result" aria-live="polite" aria-label="Detected chord">
        {notes.length === 0 && (
          <div className="empty">
            <div className="empty-title">No notes selected</div>
            <p>Pick at least three notes on the fretboard above and the most likely chord name will appear here.</p>
          </div>
        )}
        {notes.length > 0 && !match && (
          <div className="empty">
            <div className="empty-title">Single note: {notes.map((n) => midiName(n.midi, pref)).join(', ')}</div>
            <p>Add at least one more note — any combination of two or more notes gets a chord name.</p>
          </div>
        )}
        {match && spelled && (
          <div className="result-grid">
            <div className="chord-hero">
              <div className="kicker">{match === matches[0] ? 'Most likely chord' : 'Your chosen interpretation'}</div>
              <div className={`chord-name${match.name.length > 9 ? ' long' : ''}`}>{match.name}</div>
              <div className="chord-long">
                {formatNote(spelled.root)} {match.chord.type.name}
                {spelled.bass && ` over ${formatNote(spelled.bass)}`}
              </div>
              <div className="confidence" title="Relative likelihood among all interpretations">
                <div className="bar">
                  <span style={{ width: `${Math.round(match.probability * 100)}%` }} />
                </div>
                <span>{Math.max(1, Math.round(match.probability * 100))}% likely</span>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>Chord tones</dt>
                <dd className="tones">
                  {spelled.tones.map((t) => {
                    const omitted = match.omitted.includes(t.degree.label);
                    return (
                      <span key={t.degree.label} className={`tone${omitted ? ' omitted' : ''}`} title={omitted ? 'Not played (optional)' : undefined}>
                        <i style={{ background: degreeColor(t.degree.label) }} />
                        {formatNote(t.note)}
                        <small>{intervalText(t.degree.label)}</small>
                      </span>
                    );
                  })}
                </dd>
              </div>
              <div>
                <dt>Formula</dt>
                <dd>{match.chord.type.degrees.map(prettyDegree).join(' – ')}</dd>
              </div>
              {pcs.length === 2 && (
                <div>
                  <dt>Interval</dt>
                  <dd>
                    {nameOf(match.chord.rootPc)} → {nameOf(pcs.find((p) => p !== match.chord.rootPc)!)}:{' '}
                    {INTERVAL_NAMES[mod12(pcs.find((p) => p !== match.chord.rootPc)! - match.chord.rootPc)]}
                  </dd>
                </div>
              )}
              <div>
                <dt>Bass</dt>
                <dd>
                  {spelled.bass ? formatNote(spelled.bass) : formatNote(spelled.root)} · {describeInversion(match)}
                </dd>
              </div>
              {match.omitted.length > 0 && (
                <div>
                  <dt>Omitted</dt>
                  <dd>{match.omitted.map(prettyDegree).join(', ')} (optional — the chord name still applies)</dd>
                </div>
              )}
              {match.chord.type.aka && (
                <div>
                  <dt>Also written</dt>
                  <dd>{match.chord.type.aka.map((a) => formatNote(spelled.root) + a).join(', ')}</dd>
                </div>
              )}
            </dl>
            {matches.length > 1 && (
              <div className="alternatives">
                <div className="kicker">Other interpretations — click to use</div>
                <div className="chips">
                  {matches.map((m, i) => (
                    <button
                      type="button"
                      key={m.name}
                      className={`chip${m === match ? ' active' : ''}`}
                      aria-pressed={m === match}
                      onClick={() => setChoice(i)}
                      title={describeInversion(m)}
                    >
                      {m.name}
                      <span className="chip-note">{Math.max(1, Math.round(m.probability * 100))}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="result-actions">
              <button type="button" className="btn primary big" onClick={() => setShowArps((v) => !v)} aria-expanded={showArps}>
                {showArps ? 'Hide arpeggios' : 'Show arpeggios ▾'}
              </button>
              <button type="button" className="btn" onClick={() => setShowVoicings((v) => !v)} aria-expanded={showVoicings}>
                {showVoicings ? 'Hide voicings' : 'Other voicings'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onAddToProgression(match.name);
                  setAdded(match.name);
                  window.setTimeout(() => setAdded(null), 1600);
                }}
              >
                + Add to progression
              </button>
              {added && <span className="toast">Added {added} ✓</span>}
            </div>
          </div>
        )}
        {match && showVoicings && (
          <div className="voicings">
            <div className="kicker">
              Playable voicings of {match.name} in this tuning — click one to load it
            </div>
            <div className="diagram-row">
              {voicings.map((v) => (
                <ChordDiagram
                  key={v.frets.join(',')}
                  frets={v.frets}
                  tuning={tuning}
                  chord={match.chord}
                  onClick={() => setSelection(v.frets)}
                  active={v.frets.every((f, i) => f === selection[i])}
                  title="Load this voicing onto the fretboard"
                />
              ))}
              {voicings.length === 0 && <p className="muted">No comfortable voicing found within {settings.frets} frets.</p>}
            </div>
          </div>
        )}
      </section>

      <div ref={arpRef}>{match && showArps && <ArpeggioExplorer chord={match.chord} settings={settings} tuning={tuning} backingMidis={midis} />}</div>
    </>
  );
}
