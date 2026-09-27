import { useEffect, useMemo, useState } from 'react';
import { exactArpeggios, suggestArpeggios, suggestScales, type Arpeggio, type ScaleContext } from '../theory/arpeggios';
import { chordName, chordPcs, spellChord, type ChordSpec } from '../theory/chords';
import { arpeggioRun, positionForMidi, rootPositions, type FretWindow } from '../theory/fretboard';
import { degree, labelInChord, prettyDegree } from '../theory/intervals';
import { formatNote, mod12 } from '../theory/notes';
import { scalePcs, scaleType, spellScale, chooseScaleRoot } from '../theory/scales';
import type { Settings } from '../state/settings';
import { sequence, stopAll } from '../audio/synth';
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
}

type Right = { kind: 'arp'; idx: number } | { kind: 'scale'; idx: number };

function arpInfo(a: Arpeggio): Map<number, PcInfo> {
  const m = new Map<number, PcInfo>();
  for (const n of a.notes) m.set(n.pc, { degree: n.label, name: n.name });
  return m;
}

export function ArpeggioExplorer({ chord, settings, tuning, context }: Props) {
  const pref = settings.accidentals;
  const chordKey = `${chord.rootPc}|${chord.type.id}|${chord.bassPc ?? ''}|${context?.rootPc ?? ''}|${context?.scaleId ?? ''}`;
  const exact = useMemo(() => exactArpeggios(chord, pref), [chordKey, pref]);
  const subs = useMemo(() => suggestArpeggios(chord, { pref, context, limit: 6 }), [chordKey, pref]);
  const scales = useMemo(() => suggestScales(chord, pref, context), [chordKey, pref]);
  const positions = useMemo(() => rootPositions(tuning, settings.frets, chord.rootPc), [tuning, settings.frets, chord.rootPc]);

  const [exactIdx, setExactIdx] = useState(0);
  const [right, setRight] = useState<Right>({ kind: 'arp', idx: 0 });
  const [win, setWin] = useState<FretWindow | null>(null);
  const [labels, setLabels] = useState<MapLabels>(settings.labelMode === 'intervals' ? 'intervals' : 'notes');
  const [activeL, setActiveL] = useState<{ string: number; fret: number } | null>(null);
  const [activeR, setActiveR] = useState<{ string: number; fret: number } | null>(null);

  useEffect(() => {
    setExactIdx(0);
    setRight({ kind: 'arp', idx: 0 });
  }, [chordKey]);
  useEffect(() => {
    if (win && win.end > settings.frets) setWin(null);
  }, [settings.frets, win]);
  useEffect(() => () => stopAll(), []);

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

  const playPcs = (pcs: number[], rootPc: number, setActive: (a: { string: number; fret: number } | null) => void) => {
    const run = arpeggioRun(tuning, settings.frets, pcs, rootPc, win);
    if (!run.length) return;
    sequence(
      run,
      132,
      (i) => {
        const pos = positionForMidi(tuning, settings.frets, run[i], win);
        setActive(pos ? { string: pos.string, fret: pos.fret } : null);
      },
      () => setActive(null),
    );
  };

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
            <button type="button" className="btn" onClick={() => playPcs(left.notes.map((n) => n.pc), chord.rootPc, setActiveL)}>
              ▶ Play arpeggio
            </button>
          </div>
          <p className="desc">{left.description}</p>
        </div>

        <div className="arp-col">
          <div className="arp-col-head">
            <h3>Suggested arpeggios</h3>
            <span className="muted small">best first</span>
          </div>
          <div className="sub-list" role="listbox" aria-label="Suggested arpeggios">
            {subs.map((a, i) => {
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
                  <span className="sub-name">{a.name}</span>
                  {a.sound && a.sound !== name && <span className="sub-sound">→ {a.sound}</span>}
                  <span className="sub-adds">
                    {a.adds.length ? a.adds.map((x) => <em key={x}>{prettyDegree(x)}</em>) : <em className="plain">chord tones</em>}
                    {a.warning && <em className="warn" title={a.warning}>!</em>}
                  </span>
                </button>
              );
            })}
          </div>
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
                <button type="button" className="btn" onClick={() => playPcs(rightArp.notes.map((n) => n.pc), rightArp.chord.rootPc, setActiveR)}>
                  ▶ Play arpeggio
                </button>
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
                <button
                  type="button"
                  className="btn"
                  onClick={() => playPcs(scalePcs(rightScale.rootPc, rightScale.scaleId), rightScale.rootPc, setActiveR)}
                >
                  ▶ Play scale
                </button>
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
