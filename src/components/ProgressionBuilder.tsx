import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { exactArpeggios, scaleLabel, suggestArpeggios, type Arpeggio } from '../theory/arpeggios';
import { CHORD_TYPES, chordName, chordPcs, chordTypeLabel, spellChord } from '../theory/chords';
import { arpeggioRun, positionForMidi, rootPositions, type FretWindow } from '../theory/fretboard';
import { analyzeChord, detectKey, tonicChord, type ChordAnalysis, type KeyCandidate } from '../theory/key';
import { rankScalesForProgression } from '../theory/scaleFit';
import { prettyDegree } from '../theory/intervals';
import { formatNote, mod12, pcName } from '../theory/notes';
import { parseChordSymbol, parseProgression, type ParsedChord } from '../theory/parse';
import { chooseScaleRoot, scaleType, spellScale } from '../theory/scales';
import { generateVoicings, type Voicing } from '../theory/voicings';
import type { Settings } from '../state/settings';
import { play, stopAll, type NoteEvent } from '../audio/synth';
import { ChordDiagram } from './ChordDiagram';
import { LabelToggle, NoteMap, type MapLabels, type PcInfo } from './NoteMap';
import { PositionPicker } from './PositionPicker';
import { Legend } from './Legend';
import { ArpeggioExplorer } from './ArpeggioExplorer';
import { ScaleRanking } from './ScaleRanking';

interface Props {
  settings: Settings;
  tuning: number[];
  items: string[];
  setItems: (fn: (prev: string[]) => string[]) => void;
  onOpenInFinder: (frets: (number | null)[]) => void;
}

export const PRESETS: { name: string; chords: string }[] = [
  { name: 'Pop I–V–vi–IV (C major)', chords: 'C G Am F' },
  { name: 'Jazz ii–V–I (C major)', chords: 'Dm7 G7 Cmaj7' },
  { name: 'Minor ii–V–i (A minor)', chords: 'Bm7b5 E7 Am7' },
  { name: 'Jazz turnaround I–VI–ii–V (F)', chords: 'Fmaj7 D7 Gm7 C7' },
  { name: 'Andalusian cadence (A minor)', chords: 'Am G F E' },
  { name: '12-bar blues (A)', chords: 'A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7' },
  { name: 'Dorian vamp (D)', chords: 'Dm7 G7' },
  { name: 'Mixolydian rock (D)', chords: 'D C G D' },
  { name: 'Pachelbel canon (D)', chords: 'D A Bm F#m G D G A' },
  { name: 'Epic minor (E minor)', chords: 'Em C G D' },
  { name: 'Metal riff chords (D minor)', chords: 'D5 F5 G5 Bb5 A5' },
  { name: 'Minor jazz cycle (G minor)', chords: 'Cm7 F7 Bbmaj7 Ebmaj7 Am7b5 D7 Gm6' },
];

const FUNC_CLASS: Record<string, string> = { T: 'func-t', S: 'func-s', D: 'func-d', '': 'func-x' };
const COMMON_TYPES = ['maj', 'm', '7', 'maj7', 'm7', 'm7b5', 'dim', 'dim7', 'aug', 'sus2', 'sus4', '7sus4', '5', '6', 'm6', 'add9', '9', 'maj9', 'm9', '7b9', '7#9', '11', 'm11', '13'];

function arpToInfo(a: Arpeggio): Map<number, PcInfo> {
  const m = new Map<number, PcInfo>();
  for (const n of a.notes) m.set(n.pc, { degree: n.label, name: n.name });
  return m;
}

export function ProgressionBuilder({ settings, tuning, items, setItems, onOpenInFinder }: Props) {
  const pref = settings.accidentals;
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [qRoot, setQRoot] = useState(0);
  const [qType, setQType] = useState('maj');
  const [qBass, setQBass] = useState(-1);
  const [qAdd, setQAdd] = useState('');
  const [qOmit, setQOmit] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const [win, setWin] = useState<FretWindow | null>(null);
  const [labels, setLabels] = useState<MapLabels>(settings.labelMode === 'intervals' ? 'intervals' : 'notes');
  const [arpChoice, setArpChoice] = useState<Record<number, number>>({});
  const [tempo, setTempo] = useState(90);
  const [playing, setPlaying] = useState<'chords' | 'arps' | null>(null);
  const [activeChord, setActiveChord] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<{ chord: number; string: number; fret: number } | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const chords = useMemo(() => items.map((s) => parseChordSymbol(s)).filter((c): c is ParsedChord => c !== null), [items]);
  const itemsKey = items.join(' ');
  useEffect(() => {
    setKeyIdx(0);
    setArpChoice({});
  }, [itemsKey]);
  useEffect(() => () => stopAll(), []);

  const keys = useMemo(() => detectKey(chords, pref), [chords, pref]);
  const key: KeyCandidate | undefined = keys[Math.min(keyIdx, keys.length - 1)];
  const analyses: ChordAnalysis[] = useMemo(
    () => (key ? chords.map((c, i) => analyzeChord(c, key, chords[i + 1], pref)) : []),
    [chords, key, pref],
  );
  const subs = useMemo(() => chords.map((c, i) => suggestArpeggios(c, { pref, context: analyses[i]?.scale, limit: 5 })), [chords, analyses, pref]);
  const exacts = useMemo(() => chords.map((c) => exactArpeggios(c, pref)[0]), [chords, pref]);
  const voicings: Voicing[][] = useMemo(() => chords.map((c) => generateVoicings(c, tuning, settings.frets, { limit: 3 })), [chords, tuning, settings.frets]);
  const scaleFits = useMemo(() => (key ? rankScalesForProgression(chords, key.tonicPc, { pref, bluesy: key.bluesy, tonic: key.tonic }) : []), [key, chords, pref]);
  const positions = useMemo(() => (key ? rootPositions(tuning, settings.frets, key.tonicPc) : []), [key, tuning, settings.frets]);

  useEffect(() => {
    if (win && win.end > settings.frets) setWin(null);
  }, [settings.frets, win]);

  const addText = (e?: FormEvent) => {
    e?.preventDefault();
    const r = parseProgression(text);
    setErrors(r.errors);
    if (r.chords.length) {
      setItems((prev) => [...prev, ...r.chords.map((c) => c.input)]);
      if (!r.errors.length) setText('');
    }
  };
  // The quick-add chord is composed as a symbol ("E♭(add#11,no3)/A") and run through the parser,
  // so it gets exactly the same canonical name as a typed chord.
  const quickChord = useMemo(() => {
    const t = CHORD_TYPES.find((x) => x.id === qType)!;
    const mods = [qAdd && `add${qAdd}`, ...qOmit.split(',').filter(Boolean).map((n) => `no${n}`)].filter(Boolean);
    const bass = qBass >= 0 && qBass !== qRoot ? `/${pcName(qBass, pref)}` : '';
    const symbol = `${pcName(qRoot, pref)}${t.symbol}${mods.length ? `(${mods.join(',')})` : ''}${bass}`;
    return parseChordSymbol(symbol);
  }, [qRoot, qType, qBass, qAdd, qOmit, pref]);
  const addQuick = () => {
    if (quickChord) setItems((prev) => [...prev, quickChord.display]);
  };
  const move = (i: number, d: number) =>
    setItems((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i));

  const arpFor = (i: number): Arpeggio => {
    const choice = arpChoice[i] ?? -1;
    return choice >= 0 && subs[i][choice] ? subs[i][choice] : exacts[i];
  };

  const stop = () => {
    stopAll();
    setPlaying(null);
    setActiveChord(null);
    setActiveNote(null);
  };

  const playChords = () => {
    const bar = (4 * 60) / tempo;
    const events: NoteEvent[] = [];
    chords.forEach((c, i) => {
      const v = voicings[i][0];
      const midis = v ? v.midis : chordPcs(c).map((pc) => 48 + pc);
      events.push({ time: i * bar, midis, strum: 0.03, duration: bar * 0.48, onStart: () => setActiveChord(i) });
      events.push({ time: i * bar + bar / 2, midis, strum: 0.025, duration: bar * 0.48, gain: 0.6 });
    });
    setPlaying('chords');
    play(events, () => {
      setPlaying(null);
      setActiveChord(null);
    });
  };

  const playArps = () => {
    const eighth = 60 / tempo / 2;
    const events: NoteEvent[] = [];
    chords.forEach((c, i) => {
      const a = arpFor(i);
      const run = arpeggioRun(tuning, settings.frets, a.notes.map((n) => n.pc), a.chord.rootPc, win);
      const up = run.slice(0, Math.ceil(run.length / 2) + 1).slice(0, 8);
      const notes = up.length ? up : chordPcs(c).map((pc) => 48 + pc);
      notes.forEach((m, k) => {
        const pos = positionForMidi(tuning, settings.frets, m, win);
        events.push({
          time: (i * 8 + k) * eighth,
          midis: [m],
          duration: eighth * 1.8,
          gain: 0.85,
          onStart: () => {
            setActiveChord(i);
            setActiveNote(pos ? { chord: i, string: pos.string, fret: pos.fret } : null);
          },
        });
      });
    });
    setPlaying('arps');
    play(events, () => {
      setPlaying(null);
      setActiveChord(null);
      setActiveNote(null);
    });
  };

  const tonic = key ? tonicChord(key, chords) : null;
  const relative = key
    ? key.mode === 'major'
      ? `${formatNote(chooseScaleRoot(mod12(key.tonicPc + 9), 'aeolian', pref))} minor`
      : key.mode === 'minor'
        ? `${formatNote(chooseScaleRoot(mod12(key.tonicPc + 3), 'ionian', pref))} major`
        : null
    : null;
  const parentMajor = key && key.mode !== 'major' && key.mode !== 'minor' ? parentOf(key, pref) : null;

  return (
    <>
      <section className="card" aria-label="Chord progression input">
        <div className="card-head">
          <div>
            <h2>Chord progression</h2>
            <p className="hint">
              Type chords separated by spaces or bars — e.g. <code>Am7 | D7 | Gmaj7 Cmaj7</code> — or pick them below. Symbols like m7♭5, ø, °7, maj9,
              7♯9, sus4, add9, 6/9 and slash chords (D/F♯) are understood.
            </p>
          </div>
        </div>
        <form className="prog-input row gap wrap" onSubmit={addText}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Dm7 G7 Cmaj7 A7"
            aria-label="Chords to add"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            Add chords
          </button>
          <select
            aria-label="Load an example progression"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.name === e.target.value);
              if (p) setItems(() => p.chords.split(' '));
            }}
          >
            <option value="">Load an example…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}: {p.chords}
              </option>
            ))}
          </select>
        </form>
        {errors.length > 0 && <p className="warning">Not recognised: {errors.join(', ')}</p>}
        <div className="quick-add row gap wrap">
          <span className="muted small">Quick add:</span>
          <select aria-label="Root" value={qRoot} onChange={(e) => setQRoot(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                {pcName(pc, pref)}
              </option>
            ))}
          </select>
          <select aria-label="Chord quality" value={qType} onChange={(e) => setQType(e.target.value)}>
            <optgroup label="Common">
              {COMMON_TYPES.map((id) => {
                const t = CHORD_TYPES.find((x) => x.id === id)!;
                return (
                  <option key={id} value={id}>
                    {chordTypeLabel(t)}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label="More">
              {CHORD_TYPES.filter((t) => !COMMON_TYPES.includes(t.id)).map((t) => (
                <option key={t.id} value={t.id}>
                  {chordTypeLabel(t)}
                </option>
              ))}
            </optgroup>
          </select>
          <select aria-label="Bass note" value={qBass} onChange={(e) => setQBass(Number(e.target.value))}>
            <option value={-1}>no slash bass</option>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                / {pcName(pc, pref)}
              </option>
            ))}
          </select>
          <select aria-label="Added note" value={qAdd} onChange={(e) => setQAdd(e.target.value)}>
            <option value="">no added note</option>
            {['b9', '9', '#9', '11', '#11', 'b13', '13', '2', '4', '6', '7'].map((a) => (
              <option key={a} value={a}>
                add {prettyDegree(a)}
                {a === '7' ? ' (maj 7)' : ''}
              </option>
            ))}
          </select>
          <select aria-label="Omitted notes" value={qOmit} onChange={(e) => setQOmit(e.target.value)}>
            <option value="">omit nothing</option>
            <option value="3">no 3rd</option>
            <option value="5">no 5th</option>
            <option value="3,5">no 3rd, no 5th</option>
          </select>
          <button type="button" className="btn" onClick={addQuick} disabled={!quickChord}>
            + Add {quickChord ? quickChord.display : '…'}
          </button>
        </div>

        {chords.length > 0 ? (
          <ol className="prog-chips" aria-label="Progression">
            {chords.map((c, i) => (
              <li key={`${i}-${c.input}`} className={`prog-chip ${FUNC_CLASS[analyses[i]?.func ?? '']}${activeChord === i ? ' playing' : ''}`}>
                <button type="button" className="pc-main" onClick={() => setDetail(detail === i ? null : i)} aria-expanded={detail === i} title="Show arpeggios for this chord">
                  <span className="pc-name">{c.display}</span>
                  <span className="pc-roman">{analyses[i]?.roman}</span>
                </button>
                <div className="pc-tools">
                  <button type="button" aria-label={`Move ${c.display} left`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ‹
                  </button>
                  <button type="button" aria-label={`Move ${c.display} right`} disabled={i === chords.length - 1} onClick={() => move(i, 1)}>
                    ›
                  </button>
                  <button type="button" aria-label={`Remove ${c.display}`} onClick={() => remove(i)}>
                    ×
                  </button>
                </div>
              </li>
            ))}
            <li className="prog-chip-clear">
              <button type="button" className="btn small" onClick={() => setItems(() => [])}>
                Clear all
              </button>
            </li>
          </ol>
        ) : (
          <div className="empty">
            <div className="empty-title">Your progression is empty</div>
            <p>Add chords above, load an example, or use “+ Add to progression” in the Chord finder.</p>
          </div>
        )}
      </section>

      {key && chords.length > 0 && (
        <section className="card key-card" aria-label="Key analysis">
          <div className="key-top">
            <div className="key-main">
              <div className="kicker">Most likely key / tonal centre</div>
              <div className="key-name">{key.name}</div>
              <div className="confidence">
                <div className="bar">
                  <span style={{ width: `${Math.round(key.probability * 100)}%` }} />
                </div>
                <span>{Math.round(key.probability * 100)}% likely</span>
              </div>
              <div className="chips alt-keys">
                <span className="muted small">Other readings:</span>
                {keys.slice(0, 4).map((k, i) => (
                  <button
                    type="button"
                    key={k.name}
                    className={`chip${i === keyIdx ? ' active' : ''}`}
                    aria-pressed={i === keyIdx}
                    onClick={() => setKeyIdx(i)}
                    title="Analyse the progression in this key instead"
                  >
                    {k.name}
                    <span className="chip-note">{Math.max(1, Math.round(k.probability * 100))}%</span>
                  </button>
                ))}
              </div>
            </div>
            <dl className="facts key-facts">
              <div>
                <dt>Root note (tonic)</dt>
                <dd className="big">{formatNote(key.tonic)}</dd>
              </div>
              <div>
                <dt>Base (tonic) chord</dt>
                <dd className="big">{tonic ? chordName(tonic, pref) : '—'}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>
                  {scaleType(key.scaleId).name}
                  {key.mode === 'minor' && analyses.some((a) => /harmonic/.test(a.note)) ? ' (+ harmonic minor V)' : ''}
                </dd>
              </div>
              <div>
                <dt>Key scale</dt>
                <dd>{spellScale(key.tonic, key.tonicPc, key.scaleId).map(formatNote).join(' ')}</dd>
              </div>
              {relative && (
                <div>
                  <dt>Relative key</dt>
                  <dd>{relative}</dd>
                </div>
              )}
              {parentMajor && (
                <div>
                  <dt>Parent major scale</dt>
                  <dd>{parentMajor}</dd>
                </div>
              )}
            </dl>
          </div>
          <ul className="reasons">
            {key.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <ScaleRanking fits={scaleFits} tuning={tuning} settings={settings} win={win} labels={labels} />
        </section>
      )}

      {key && chords.length > 0 && (
        <section className="card" aria-label="Chord-by-chord analysis">
          <div className="card-head">
            <h2>Chord-by-chord analysis</h2>
          </div>
          <div className="table-wrap">
            <table className="analysis">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Chord</th>
                  <th>Roman</th>
                  <th>Function</th>
                  <th>Chord tones</th>
                  <th>Chord-scale</th>
                  <th>Arpeggio ideas</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {chords.map((c, i) => {
                  const a = analyses[i];
                  return (
                    <tr key={`${i}-${c.input}`} className={activeChord === i ? 'playing' : ''}>
                      <td>{i + 1}</td>
                      <td className="strong">{c.display}</td>
                      <td className="roman">{a.roman}</td>
                      <td>
                        <span className={`func-badge ${FUNC_CLASS[a.func]}`}>{a.funcLabel}</span>
                      </td>
                      <td>
                        {spellChord(c, pref)
                          .tones.map((t) => formatNote(t.note))
                          .join(' ')}
                      </td>
                      <td>{scaleLabel(a.scale, pref)}</td>
                      <td>
                        {subs[i]
                          .slice(0, 2)
                          .map((s) => `${s.name}${s.sound && s.sound !== c.display ? ` (→ ${s.sound})` : ''}`)
                          .join(', ')}
                      </td>
                      <td className="muted">{a.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small legend-line">
            <span className="func-badge func-t">Tonic</span> = stable / home · <span className="func-badge func-s">Subdominant</span> = moving away ·{' '}
            <span className="func-badge func-d">Dominant</span> = tension that wants to resolve
          </p>
        </section>
      )}

      {key && detail !== null && chords[detail] && (
        <ArpeggioExplorer chord={chords[detail]} settings={settings} tuning={tuning} context={analyses[detail]?.scale} />
      )}

      {key && chords.length > 0 && (
        <section className="card" aria-label="Arpeggios through the changes">
          <div className="card-head">
            <div>
              <h2>Arpeggios through the changes</h2>
              <p className="hint">
                Choose one position to see every chord's arpeggio under the same hand shape — the best way to practise connecting chords smoothly. For each
                chord you can switch between its own arpeggio and a suggested substitute. Click a chord diagram to open it in the Chord finder.
              </p>
            </div>
            <LabelToggle value={labels} onChange={setLabels} />
          </div>
          <PositionPicker positions={positions} value={win} onChange={setWin} frets={settings.frets} />
          <div className="player row gap wrap">
            {playing ? (
              <button type="button" className="btn primary" onClick={stop}>
                ■ Stop
              </button>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={playChords}>
                  ▶ Play chords
                </button>
                <button type="button" className="btn" onClick={playArps}>
                  ▶ Play arpeggios
                </button>
              </>
            )}
            <label className="field inline">
              <span>Tempo</span>
              <input type="range" min={50} max={200} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo in BPM" />
              <span className="tempo">{tempo} BPM</span>
            </label>
          </div>
          <div className="prog-grid">
            {chords.map((c, i) => {
              const a = arpFor(i);
              const an = analyses[i];
              return (
                <article key={`${i}-${c.input}`} className={`pc-card${activeChord === i ? ' playing' : ''}`}>
                  <header>
                    <span className="pc-idx">{i + 1}</span>
                    <span className="pc-title">{c.display}</span>
                    <span className="pc-roman">{an.roman}</span>
                    <span className={`func-badge ${FUNC_CLASS[an.func]}`}>{an.funcLabel}</span>
                  </header>
                  <select
                    aria-label={`Arpeggio for ${c.display}`}
                    value={arpChoice[i] ?? -1}
                    onChange={(e) => setArpChoice((prev) => ({ ...prev, [i]: Number(e.target.value) }))}
                  >
                    <option value={-1}>
                      {exacts[i].name} arpeggio ({exacts[i].notes.map((n) => n.name).join(' ')})
                    </option>
                    {subs[i].map((s, j) => (
                      <option key={s.id} value={j}>
                        {s.name} over {c.display}
                        {s.sound && s.sound !== c.display ? ` → ${s.sound}` : ''}
                      </option>
                    ))}
                  </select>
                  <NoteMap
                    tuning={tuning}
                    settings={settings}
                    info={arpToInfo(a)}
                    win={win}
                    labels={labels}
                    compact
                    ringPc={a.chord.rootPc}
                    active={activeNote && activeNote.chord === i ? activeNote : null}
                    ariaLabel={`${a.name} arpeggio for chord ${i + 1}`}
                  />
                  <div className="pc-voicings">
                    {voicings[i].map((v) => (
                      <ChordDiagram
                        key={v.frets.join(',')}
                        frets={v.frets}
                        tuning={tuning}
                        chord={c}
                        onClick={() => onOpenInFinder(v.frets)}
                        title="Open this voicing in the Chord finder"
                      />
                    ))}
                    {voicings[i].length === 0 && <span className="muted small">No comfortable voicing in this tuning.</span>}
                  </div>
                  {an.note && <p className="muted small">{an.note}</p>}
                </article>
              );
            })}
          </div>
          <Legend />
        </section>
      )}
    </>
  );
}

function parentOf(key: KeyCandidate, pref: Settings['accidentals']): string {
  const info: Record<string, [number, string]> = { dorian: [2, '2nd'], phrygian: [4, '3rd'], lydian: [5, '4th'], mixolydian: [7, '5th'] };
  const [off, ord] = info[key.mode] ?? [0, '1st'];
  const pc = mod12(key.tonicPc - off);
  return `${formatNote(chooseScaleRoot(pc, 'ionian', pref))} major (${formatNote(key.tonic)} is its ${ord} degree)`;
}
