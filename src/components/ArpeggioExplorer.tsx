import { useEffect, useMemo, useState } from 'react';
import { exactArpeggios, suggestArpeggios, suggestScales, type Arpeggio, type ScaleContext } from '../theory/arpeggios';
import { chordName, chordPcs, spellChord, type ChordSpec } from '../theory/chords';
import { arpeggioRun, positionForMidi, rootPositions, type FretWindow } from '../theory/fretboard';
import { generateVoicings } from '../theory/voicings';
import { degree, labelInChord, prettyDegree } from '../theory/intervals';
import { formatNote, mod12 } from '../theory/notes';
import { scalePcs, scaleType, spellScale, chooseScaleRoot } from '../theory/scales';
import type { Settings } from '../state/settings';
import { arrange, bassNote, type Bar } from '../audio/arrange';
import { usePlayer } from '../audio/usePlayer';
import { LabelToggle, NoteMap, intervalText, type MapLabels, type PcInfo } from './NoteMap';
import { PositionPicker } from './PositionPicker';
import { Legend } from './Legend';
import { MoodTag } from './ScaleRanking';

interface Props {
  chord: ChordSpec;
  settings: Settings;
  tuning: number[];
  /** Key context (e.g. from a progression) used to pick the chord-scale. */
  context?: ScaleContext;
  /** Voicing to strum as the backing chord (defaults to the best generated voicing). */
  backingMidis?: number[];
}

const SHOWN = 8;
type Active = { string: number; fret: number } | null;

type Right = { kind: 'arp'; idx: number } | { kind: 'scale'; idx: number };

function arpInfo(a: Arpeggio): Map<number, PcInfo> {
  const m = new Map<number, PcInfo>();
  for (const n of a.notes) m.set(n.pc, { degree: n.label, name: n.name });
  return m;
}

export function ArpeggioExplorer({ chord, settings, tuning, context, backingMidis }: Props) {
  const pref = settings.accidentals;
  const chordKey = `${chord.rootPc}|${chord.type.id}|${chord.bassPc ?? ''}|${context?.rootPc ?? ''}|${context?.scaleId ?? ''}`;
  const exact = useMemo(() => exactArpeggios(chord, pref), [chordKey, pref]);
  const subs = useMemo(() => suggestArpeggios(chord, { pref, context, limit: 20 }), [chordKey, pref]);
  const scales = useMemo(() => suggestScales(chord, pref, context), [chordKey, pref]);
  const positions = useMemo(() => rootPositions(tuning, settings.frets, chord.rootPc), [tuning, settings.frets, chord.rootPc]);

  const [exactIdx, setExactIdx] = useState(0);
  const [right, setRight] = useState<Right>({ kind: 'arp', idx: 0 });
  const [win, setWin] = useState<FretWindow | null>(null);
  const [labels, setLabels] = useState<MapLabels>(settings.labelMode === 'intervals' ? 'intervals' : 'notes');
  const [activeL, setActiveL] = useState<Active>(null);
  const [activeR, setActiveR] = useState<Active>(null);
  const [showAll, setShowAll] = useState(false);
  const [tempo, setTempo] = useState(100);
  const player = usePlayer();

  useEffect(() => {
    setExactIdx(0);
    setRight({ kind: 'arp', idx: 0 });
    setShowAll(false);
  }, [chordKey]);
  useEffect(() => {
    if (win && win.end > settings.frets) setWin(null);
  }, [settings.frets, win]);

  const name = chordName(chord, pref);
  const left = exact[Math.min(exactIdx, exact.length - 1)];
  const rightArp = right.kind === 'arp' ? subs[Math.min(right.idx, subs.length - 1)] : undefined;
  const rightScale = right.kind === 'scale' ? scales[Math.min(right.idx, scales.length - 1)] : undefined;

  const scaleInfo = useMemo(() => {
    if (!rightScale) return null;
    const m = new Map<number, PcInfo>();
    const chordSet = new Set(chordPcs({ ...chord, bassPc: undefined }));
    const root = rightScale.root ?? chooseScaleRoot(rightScale.rootPc, rightScale.scaleId, pref);
    const spelled = spellScale(root, rightScale.rootPc, rightScale.scaleId);
    scaleType(rightScale.scaleId).degrees.forEach((d, i) => {
      const pc = mod12(rightScale.rootPc + degree(d).semi);
      const chordTone = chordSet.has(pc);
      m.set(pc, {
        degree: chordTone ? labelInChord(pc - chord.rootPc, chord.type.degrees) : d,
        name: formatNote(spelled[i]),
        other: !chordTone,
      });
    });
    return m;
  }, [rightScale, chord, pref]);

  // Backing for "over the chord": the chord as played on the fretboard, or its best voicing.
  const backing = useMemo(() => {
    if (backingMidis?.length) return backingMidis;
    const v = generateVoicings(chord, tuning, settings.frets, { limit: 1 })[0];
    return v ? v.midis : chordPcs(chord).map((pc) => 48 + pc);
  }, [backingMidis, chordKey, tuning, settings.frets]);

  /** Up-and-down run through the notes, alone or over the strummed chord (at least two bars). */
  const playPcs = (id: string, pcs: number[], rootPc: number, withChord: boolean, setActive: (a: Active) => void) => {
    player.toggle(
      id,
      () => {
        const run = arpeggioRun(tuning, settings.frets, pcs, rootPc, win);
        let line = run;
        while (withChord && line.length && line.length < 16) line = [...line, ...run.slice(1)];
        const bars: Bar[] = [];
        for (let i = 0; i < line.length; i += 8) {
          const notes = line.slice(i, i + 8);
          bars.push({
            chord: withChord ? backing : undefined,
            bass: withChord ? bassNote(chord.bassPc ?? chord.rootPc) : undefined,
            melody: notes,
            onNote: (k) => {
              const pos = positionForMidi(tuning, settings.frets, notes[k], win);
              setActive(pos ? { string: pos.string, fret: pos.fret } : null);
            },
          });
        }
        return arrange(bars, { bpm: tempo });
      },
      { onDone: () => setActive(null) },
    );
  };
  const btn = (id: string, label: string) => (player.playing === id ? '■ Stop' : label);

  const leftInfo = useMemo(() => arpInfo(left), [left]);
  const rightInfo = useMemo(() => (rightArp ? arpInfo(rightArp) : scaleInfo ?? new Map()), [rightArp, scaleInfo]);

  return (
    <section className="card arp-explorer" aria-label={`Arpeggios for ${name}`}>
      <div className="card-head">
        <div>
          <h2>Arpeggios for {name}</h2>
          <p className="hint">
            Left: the chord's own arpeggio. Right: arpeggios that sound great over it — each one adds colour tones (9ths, 11ths, 13ths) on top of the
            harmony. Colours show each note's role relative to <b>{formatNote(spellChord(chord, pref).root)}</b>.
          </p>
        </div>
        <div className="row gap wrap">
          <label className="field inline" title="Playback tempo">
            <span>Tempo</span>
            <input type="range" min={50} max={200} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo in BPM" />
            <span className="tempo">{tempo} BPM</span>
          </label>
          <LabelToggle value={labels} onChange={setLabels} />
        </div>
      </div>
      <PositionPicker positions={positions} value={win} onChange={setWin} frets={settings.frets} />

      <div className="arp-grid">
        <div className="arp-col">
          <div className="arp-col-head">
            <h3>Chord arpeggio</h3>
            <div className="chips" role="tablist" aria-label="Arpeggio variants">
              {exact.map((a, i) => (
                <button
                  type="button"
                  key={a.id}
                  role="tab"
                  aria-selected={i === exactIdx}
                  className={`chip${i === exactIdx ? ' active' : ''}`}
                  onClick={() => setExactIdx(i)}
                  title={a.description}
                >
                  {a.name}
                  {a.kind === 'reduction' && <span className="chip-note">core</span>}
                </button>
              ))}
            </div>
          </div>
          <NoteMap
            tuning={tuning}
            settings={settings}
            info={leftInfo}
            win={win}
            labels={labels}
            active={activeL}
            ringPc={chord.rootPc}
            ariaLabel={`${left.name} arpeggio on the fretboard`}
          />
          <div className="arp-meta">
            <NoteChips info={leftInfo} order={left.notes.map((n) => n.pc)} />
            <PlayButtons
              solo={btn('L-solo', '▶ Play')}
              over={btn('L-over', '▶ Over the chord')}
              onSolo={() => playPcs('L-solo', left.notes.map((n) => n.pc), chord.rootPc, false, setActiveL)}
              onOver={() => playPcs('L-over', left.notes.map((n) => n.pc), chord.rootPc, true, setActiveL)}
            />
          </div>
          <p className="desc">{left.description}</p>
        </div>

        <div className="arp-col">
          <div className="arp-col-head">
            <h3>Suggested arpeggios</h3>
            <span className="muted small">{subs.length} options · best fit first</span>
          </div>
          <div className="sub-list" role="listbox" aria-label="Suggested arpeggios">
            {subs.slice(0, showAll ? subs.length : SHOWN).map((a, i) => {
              const selected = right.kind === 'arp' && right.idx === i;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  key={a.id}
                  className={`sub-card${selected ? ' active' : ''}`}
                  onClick={() => setRight({ kind: 'arp', idx: i })}
                >
                  <span className="sub-top">
                    <span className="sub-name">{a.name}</span>
                    <span className="sub-fit" title="How well it fits the chord">
                      {Math.round(a.fit * 100)}%
                    </span>
                  </span>
                  {a.sound && a.sound !== name && <span className="sub-sound">→ {a.sound}</span>}
                  <span className="sub-adds">
                    {a.adds.length ? a.adds.map((x) => <em key={x}>{prettyDegree(x)}</em>) : <em className="plain">chord tones</em>}
                    {a.warning && <em className="warn" title={a.warning}>!</em>}
                  </span>
                </button>
              );
            })}
          </div>
          {subs.length > SHOWN && (
            <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show top ${SHOWN}` : `Show all ${subs.length} arpeggios`}
            </button>
          )}
          {subs.length === 0 && <p className="muted small">No standard arpeggio fits this chord well — try the scales below.</p>}
          <NoteMap
            tuning={tuning}
            settings={settings}
            info={rightInfo}
            win={win}
            labels={labels}
            active={activeR}
            ringPc={rightArp ? rightArp.chord.rootPc : rightScale?.rootPc}
            ariaLabel={rightArp ? `${rightArp.name} arpeggio over ${name}` : `${rightScale?.label} scale`}
          />
          {rightArp && (
            <>
              <div className="arp-meta">
                <NoteChips info={rightInfo} order={rightArp.notes.map((n) => n.pc)} />
                <PlayButtons
                  solo={btn('R-solo', '▶ Play')}
                  over={btn('R-over', `▶ Over ${name}`)}
                  onSolo={() => playPcs('R-solo', rightArp.notes.map((n) => n.pc), rightArp.chord.rootPc, false, setActiveR)}
                  onOver={() => playPcs('R-over', rightArp.notes.map((n) => n.pc), rightArp.chord.rootPc, true, setActiveR)}
                />
              </div>
              <p className="desc">
                <b>
                  {rightArp.name} over {name}.
                </b>{' '}
                {rightArp.description} {rightArp.scaleLabel && <span className="muted">(from {rightArp.scaleLabel})</span>}
              </p>
              {rightArp.warning && <p className="warning">⚠ {rightArp.warning}</p>}
            </>
          )}
          {rightScale && (
            <>
              <div className="arp-meta">
                <span className="muted small">
                  Coloured = chord tones, grey = other scale notes. Notes: {rightScale.notes}
                </span>
                <PlayButtons
                  solo={btn('S-solo', '▶ Play scale')}
                  over={btn('S-over', `▶ Over ${name}`)}
                  onSolo={() => playPcs('S-solo', scalePcs(rightScale.rootPc, rightScale.scaleId), rightScale.rootPc, false, setActiveR)}
                  onOver={() => playPcs('S-over', scalePcs(rightScale.rootPc, rightScale.scaleId), rightScale.rootPc, true, setActiveR)}
                />
              </div>
              <p className="desc">
                <b>{rightScale.label}.</b> {rightScale.info}{' '}
                {rightScale.moods.map((m) => (
                  <MoodTag key={m} mood={m} />
                ))}
              </p>
            </>
          )}
          <div className="scales-row">
            <span className="muted small">Scales that fit:</span>
            {scales.map((s, i) => {
              const selected = right.kind === 'scale' && right.idx === i;
              return (
                <button
                  type="button"
                  key={`${s.rootPc}-${s.scaleId}`}
                  className={`chip${selected ? ' active' : ''}`}
                  aria-pressed={selected}
                  title={`${s.notes} — ${s.info}`}
                  onClick={() => setRight({ kind: 'scale', idx: i })}
                >
                  {s.label}
                  <span className="chip-note">{s.moods.join(' · ')}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <Legend />
    </section>
  );
}

function PlayButtons({ solo, over, onSolo, onOver }: { solo: string; over: string; onSolo: () => void; onOver: () => void }) {
  return (
    <div className="row gap wrap">
      <button type="button" className="btn" onClick={onSolo}>
        {solo}
      </button>
      <button type="button" className="btn" onClick={onOver} title="Play it while the chord is strummed underneath">
        {over}
      </button>
    </div>
  );
}

function NoteChips({ info, order }: { info: Map<number, PcInfo>; order: number[] }) {
  return (
    <ul className="note-chips">
      {order.map((pc) => {
        const i = info.get(pc);
        if (!i) return null;
        return (
          <li key={pc}>
            <b>{i.name}</b>
            <span>{intervalText(i.degree)}</span>
          </li>
        );
      })}
    </ul>
  );
}
