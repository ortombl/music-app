import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { analyzeArpeggio, exactArpeggios, sameNotes, scaleLabel, suggestArpeggios } from '../theory/arpeggios';
import { parseArpeggioInput } from '../theory/arpInput';
import {
  beatsText,
  exportArrangementText,
  parseArrangementText,
  slotAt,
  toAscii,
  type ArrangementDoc,
  type Slot,
} from '../theory/arrangement';
import { findTuning, tuningNotes, tuningNotesWithOctave } from '../theory/tunings';
import { CHORD_TYPES, chordName, chordPcs, chordTypeLabel, spellChord } from '../theory/chords';
import { arpeggioRun, positionForMidi, rootPositions, type FretWindow } from '../theory/fretboard';
import { analyzeChord, detectKey, tonicChord, type ChordAnalysis, type KeyCandidate } from '../theory/key';
import { rankScalesForProgression } from '../theory/scaleFit';
import { prettyDegree } from '../theory/intervals';
import { formatNote, mod12, pcName } from '../theory/notes';
import { parseChordSymbol, parseProgression, type ParsedChord } from '../theory/parse';
import { chooseScaleRoot, scaleType, spellScale } from '../theory/scales';
import { generateVoicings, type Voicing } from '../theory/voicings';
import { usePersistentState, type Settings } from '../state/settings';
import { arrange, bassNote, type Bar } from '../audio/arrange';
import { usePlayer } from '../audio/usePlayer';
import { lineFromRoot, pitchPool, scaleLineOverChords, voiceLedLines } from '../theory/lines';
import { scalePcs } from '../theory/scales';
import type { ScaleFit } from '../theory/scaleFit';
import { LabelToggle, type MapLabels } from './NoteMap';
import { ArrangementCard, type ResolvedArp } from './ArrangementCard';
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
  /** Change the tuning (used when importing a file that specifies one). */
  onSetTuning?: (strings: number[]) => void;
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

export function ProgressionBuilder({ settings, tuning, items, setItems, onOpenInFinder, onSetTuning }: Props) {
  const pref = settings.accidentals;
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [qRoot, setQRoot] = useState(0);
  const [qType, setQType] = useState('maj');
  const [qBass, setQBass] = useState(-1);
  const [qAdd, setQAdd] = useState('');
  const [qOmit, setQOmit] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  // The arrangement (per-chord arpeggio, position, length) and its shared settings are remembered.
  const [win, setWin] = usePersistentState<FretWindow | null>('arrangement-position', null);
  const [slots, setSlots] = usePersistentState<Slot[]>('arrangement-slots', []);
  const [ioStatus, setIoStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [labels, setLabels] = useState<MapLabels>(settings.labelMode === 'intervals' ? 'intervals' : 'notes');
  const [tempo, setTempo] = usePersistentState('arrangement-tempo', 90);
  const [backingOn, setBackingOn] = useState(true);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const player = usePlayer();
  const [activeChord, setActiveChord] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<{ chord: number; string: number; fret: number } | null>(null);
  const [scaleActive, setScaleActive] = useState<{ scaleId: string; string: number; fret: number } | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const parsedItems = useMemo(() => items.map((s) => parseChordSymbol(s)), [items]);
  const chords = useMemo(() => parsedItems.filter((c): c is ParsedChord => c !== null), [parsedItems]);
  // Items that no longer parse (e.g. edited storage) are dropped together with their slots, so
  // slots stay aligned with chords.
  useEffect(() => {
    if (parsedItems.every(Boolean)) return;
    const keep = parsedItems.map(Boolean);
    setItems((prev) => prev.filter((_, i) => keep[i]));
    setSlots((prev) => prev.filter((_, i) => keep[i] !== false));
  }, [parsedItems, setItems, setSlots]);
  const itemsKey = items.join(' ');
  useEffect(() => {
    setKeyIdx(0);
  }, [itemsKey]);

  const keys = useMemo(() => detectKey(chords, pref), [chords, pref]);
  const key: KeyCandidate | undefined = keys[Math.min(keyIdx, keys.length - 1)];
  const analyses: ChordAnalysis[] = useMemo(
    () => (key ? chords.map((c, i) => analyzeChord(c, key, chords[i + 1], pref)) : []),
    [chords, key, pref],
  );
  const subs = useMemo(() => chords.map((c, i) => suggestArpeggios(c, { pref, context: analyses[i]?.scale, limit: 20 })), [chords, analyses, pref]);
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
  // Reordering / removing chords keeps each chord's arpeggio settings with it.
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const swap = <T,>(arr: T[], fill: T) => {
      const next = [...arr];
      while (next.length <= Math.max(i, j)) next.push(fill);
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    };
    setItems((prev) => swap(prev, ''));
    setSlots((prev) => swap(prev, slotAt(prev, prev.length)));
  };
  const remove = (i: number) => {
    setItems((prev) => prev.filter((_, j) => j !== i));
    setSlots((prev) => prev.filter((_, j) => j !== i));
  };
  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(slotAt(next, next.length));
      next[i] = { ...slotAt(prev, i), ...patch };
      return next;
    });

  /** Each chord's arpeggio: its own, one of the suggestions, or one the user typed in. */
  const resolved: ResolvedArp[] = useMemo(
    () =>
      chords.map((c, i) => {
        const slot = slotAt(slots, i);
        if (!slot.arp) return { arp: exacts[i], kind: 'own' };
        const r = parseArpeggioInput(slot.arp, pref);
        if ('error' in r) return { arp: exacts[i], kind: 'own', error: r.error };
        const idx = subs[i].findIndex((s) => sameNotes(s.chord, r.chord));
        if (idx >= 0) return { arp: subs[i][idx], kind: 'sub', subIndex: idx, recognisedFrom: r.recognisedFrom };
        return { arp: analyzeArpeggio(c, r.chord, { pref, context: analyses[i]?.scale }), kind: 'custom', recognisedFrom: r.recognisedFrom };
      }),
    [chords, slots, subs, exacts, analyses, pref],
  );
  const arpFor = (i: number) => resolved[i].arp;
  /** The fret window a chord's arpeggio is played in (null = whole neck). */
  const winFor = (i: number): FretWindow | null => {
    const pos = slotAt(slots, i).pos;
    if (pos === 'global') return win;
    if (pos === 'neck') return null;
    const end = Math.min(pos.end, settings.frets);
    return { start: Math.min(pos.start, Math.max(0, end - 4)), end };
  };
  const beatsFor = (i: number) => slotAt(slots, i).beats;

  // ---- Playback -------------------------------------------------------------------------------
  const backingVoicing = (i: number) => voicings[i]?.[0]?.midis ?? chordPcs(chords[i]).map((pc) => 48 + pc);
  const bassFor = (i: number) => bassNote(chords[i].bassPc ?? chords[i].rootPc);
  const clearHighlights = () => {
    setActiveChord(null);
    setActiveNote(null);
    setScaleActive(null);
  };
  const run = (id: string, bars: () => Bar[]) =>
    player.toggle(id, () => arrange(bars(), { bpm: tempo }), { loop: () => loopRef.current, onDone: clearHighlights });
  const showNote = (i: number, midi: number) => {
    const pos = positionForMidi(tuning, settings.frets, midi, winFor(i));
    setActiveChord(i);
    setActiveNote(pos ? { chord: i, string: pos.string, fret: pos.fret } : null);
  };
  const withBacking = (i: number, on: boolean): Pick<Bar, 'chord' | 'bass'> => (on ? { chord: backingVoicing(i), bass: bassFor(i) } : {});

  /** The chords alone, one bar each. */
  const playChords = () =>
    run('chords', () => chords.map((_, i) => ({ ...withBacking(i, true), beats: beatsFor(i), melody: [], onBar: () => setActiveChord(i) })));

  /** Every chord's chosen arpeggio as one voice-led line through the changes (optionally over the chords). */
  const playArps = () =>
    run('arps', () => {
      const pools = chords.map((_, i) => pitchPool(tuning, settings.frets, arpFor(i).notes.map((n) => n.pc), winFor(i)));
      const lines = voiceLedLines(
        pools,
        chords.map((_, i) => arpFor(i).chord.rootPc),
        chords.map((_, i) => beatsFor(i) * 2),
      );
      return chords.map((_, i) => ({
        ...withBacking(i, backingOn),
        beats: beatsFor(i),
        melody: lines[i],
        onBar: () => setActiveChord(i),
        onNote: (k: number) => showNote(i, lines[i][k]),
      }));
    });

  /** One chord's arpeggio, alone or over its chord (its length, twice — at least two bars). */
  const playCardArp = (i: number, over: boolean) =>
    run(`card-${i}-${over ? 'over' : 'solo'}`, () => {
      const a = arpFor(i);
      const beats = Math.max(4, beatsFor(i));
      const line = lineFromRoot(pitchPool(tuning, settings.frets, a.notes.map((n) => n.pc), winFor(i)), a.chord.rootPc, beats * 4);
      return [line.slice(0, beats * 2), line.slice(beats * 2)].map((notes) => ({
        ...withBacking(i, over),
        beats,
        melody: notes,
        onBar: () => setActiveChord(i),
        onNote: (k: number) => showNote(i, notes[k]),
      }));
    });

  /** A scale alone (up and down), or as a line over the whole progression that lands on chord tones. */
  const playScale = (fit: ScaleFit, over: boolean) =>
    run(`scale-${fit.ctx.scaleId}-${over ? 'over' : 'solo'}`, () => {
      const pcs = scalePcs(fit.ctx.rootPc, fit.ctx.scaleId);
      const mark = (midi: number) => {
        const pos = positionForMidi(tuning, settings.frets, midi, win);
        setScaleActive(pos ? { scaleId: fit.ctx.scaleId, string: pos.string, fret: pos.fret } : null);
      };
      if (!over) {
        const runNotes = arpeggioRun(tuning, settings.frets, pcs, fit.ctx.rootPc, win);
        const bars: Bar[] = [];
        for (let b = 0; b < runNotes.length; b += 8) {
          const notes = runNotes.slice(b, b + 8);
          bars.push({ melody: notes, onNote: (k) => mark(notes[k]) });
        }
        return bars;
      }
      const pool = pitchPool(tuning, settings.frets, pcs, win);
      const lines = scaleLineOverChords(
        pool,
        chords.map((c) => new Set(chordPcs(c))),
        fit.ctx.rootPc,
        chords.map((_, i) => beatsFor(i) * 2),
      );
      return chords.map((_, i) => ({
        ...withBacking(i, true),
        beats: beatsFor(i),
        melody: lines[i],
        onBar: () => setActiveChord(i),
        onNote: (k: number) => mark(lines[i][k]),
      }));
    });
  const label = (id: string, text: string) => (player.playing === id ? '■ Stop' : text);

  // ---- Export / import ------------------------------------------------------------------------
  const positionLabel = (i: number) => {
    const pos = slotAt(slots, i).pos;
    if (pos === 'global') return win ? `frets ${win.start}–${win.end} (all)` : 'whole neck (all)';
    if (pos === 'neck') return 'whole neck';
    return `frets ${pos.start}–${pos.end}`;
  };
  const buildExport = () => {
    const doc: ArrangementDoc = {
      chords: chords.map((c) => c.display),
      slots: chords.map((_, i) => slotAt(slots, i)),
      tempo,
      position: win,
      tuning,
    };
    const preset = findTuning(settings.tuningId);
    return exportArrangementText(doc, {
      key: key ? `${key.name} · tonic chord ${tonic ? chordName(tonic, pref) : '—'}` : '—',
      tuning: `${settings.tuningId === 'custom' || !preset ? 'Custom' : preset.name} (${tuningNotes(tuning)} · ${tuningNotesWithOctave(tuning)})`,
      tempo,
      position: win ? `frets ${win.start}–${win.end}` : 'whole neck',
      date: new Date().toLocaleString(),
      rows: chords.map((c, i) => {
        const r = resolved[i];
        return {
          chord: c.display,
          roman: analyses[i]?.roman ?? '',
          arpeggio: r.kind === 'own' ? `${r.arp.name} (chord)` : r.kind === 'custom' ? `${r.arp.name} (own)` : r.arp.name,
          notes: r.arp.notes.map((n) => n.name).join(' '),
          fit: r.kind === 'own' ? '—' : `${Math.round(r.arp.fit * 100)}%`,
          sound: r.arp.sound && r.arp.sound !== c.display ? r.arp.sound : '',
          position: positionLabel(i),
          length: beatsText(beatsFor(i)),
        };
      }),
    });
  };
  const exportFile = () => {
    const text = buildExport();
    const name = `fretboard-lab ${chords.map((c) => toAscii(c.display)).join(' ')}`.replace(/[^A-Za-z0-9#()+,-]+/g, '_').slice(0, 80);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setIoStatus({ ok: true, text: `Exported ${chords.length} chords with their arpeggios to ${name}.txt.` });
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(buildExport());
      setIoStatus({ ok: true, text: 'Copied to the clipboard — paste it into your notes.' });
    } catch {
      setIoStatus({ ok: false, text: 'The browser did not allow copying here; use Export instead.' });
    }
  };
  const importText = (text: string, fileName: string) => {
    const { doc, errors } = parseArrangementText(text);
    const problems = [...errors];
    const newItems: string[] = [];
    const newSlots: Slot[] = [];
    doc.chords.forEach((c, i) => {
      if (!parseChordSymbol(c)) {
        problems.push(`chord "${c}" not recognised — skipped`);
        return;
      }
      let slot = doc.slots[i];
      if (slot.arp && 'error' in parseArpeggioInput(slot.arp)) {
        problems.push(`arpeggio "${slot.arp}" for ${c} not recognised — using the chord's own`);
        slot = { ...slot, arp: null };
      }
      newItems.push(c);
      newSlots.push(slot);
    });
    if (!newItems.length) {
      setIoStatus({ ok: false, text: `No chords found in ${fileName}.${problems.length ? ` ${problems.join('; ')}.` : ''}` });
      return;
    }
    player.stop();
    setItems(() => newItems);
    setSlots(newSlots);
    if (doc.tempo) setTempo(doc.tempo);
    if (doc.position !== undefined) setWin(doc.position);
    let tuningNote = '';
    if (doc.tuning && onSetTuning && doc.tuning.join(',') !== tuning.join(',')) {
      onSetTuning(doc.tuning);
      tuningNote = ` Tuning set to ${tuningNotes(doc.tuning)}.`;
    }
    setIoStatus({
      ok: problems.length === 0,
      text: `Imported ${newItems.length} chords from ${fileName}.${tuningNote}${problems.length ? ` Warnings: ${problems.join('; ')}.` : ''}`,
    });
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    file
      .text()
      .then((t) => importText(t, file.name))
      .catch(() => setIoStatus({ ok: false, text: `Could not read ${file.name}.` }));
  };
  const importButton = (
    <>
      <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Load a progression + arpeggios saved with Export">
        ⬆ Import .txt
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );

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
              if (p) {
                setItems(() => p.chords.split(' '));
                setSlots([]);
              }
            }}
          >
            <option value="">Load an example…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}: {p.chords}
              </option>
            ))}
          </select>
          {importButton}
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
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setItems(() => []);
                  setSlots([]);
                }}
              >
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
          <ScaleRanking
            fits={scaleFits}
            tuning={tuning}
            settings={settings}
            win={win}
            labels={labels}
            playing={player.playing}
            active={scaleActive}
            onPlay={playScale}
          />
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
        <ArpeggioExplorer
          chord={chords[detail]}
          settings={settings}
          tuning={tuning}
          context={analyses[detail]?.scale}
          backingMidis={voicings[detail]?.[0]?.midis}
        />
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
            <button type="button" className="btn primary" onClick={playArps}>
              {label('arps', backingOn ? '▶ Arpeggios over the chords' : '▶ Arpeggios only')}
            </button>
            <button type="button" className="btn" onClick={playChords}>
              {label('chords', '▶ Chords only')}
            </button>
            <label className="check" title="Strum each chord (with a bass note) under the arpeggio line">
              <input type="checkbox" checked={backingOn} onChange={(e) => setBackingOn(e.target.checked)} />
              Chord backing
            </label>
            <label className="check">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              Loop
            </label>
            <label className="field inline">
              <span>Tempo</span>
              <input type="range" min={50} max={200} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo in BPM" />
              <span className="tempo">{tempo} BPM</span>
            </label>
            {player.playing && player.playing !== 'arps' && player.playing !== 'chords' && (
              <button type="button" className="btn" onClick={player.stop}>
                ■ Stop
              </button>
            )}
          </div>
          <p className="muted small player-hint">
            The arpeggio line moves to the nearest note at every chord change (voice leading), eight notes per chord, inside the chosen position.
          </p>
          <div className="prog-grid">
            {chords.map((c, i) => (
              <ArrangementCard
                key={`${i}-${c.input}`}
                index={i}
                chord={c}
                analysis={analyses[i]}
                slot={slotAt(slots, i)}
                resolved={resolved[i]}
                exact={exacts[i]}
                subs={subs[i]}
                voicings={voicings[i]}
                tuning={tuning}
                settings={settings}
                labels={labels}
                globalWin={win}
                win={winFor(i)}
                active={activeNote && activeNote.chord === i ? activeNote : null}
                playing={activeChord === i}
                soloLabel={label(`card-${i}-solo`, '▶')}
                overLabel={label(`card-${i}-over`, '▶ over chord')}
                onPlaySolo={() => playCardArp(i, false)}
                onPlayOver={() => playCardArp(i, true)}
                onChange={(patch) => updateSlot(i, patch)}
                onOpenInFinder={onOpenInFinder}
              />
            ))}
          </div>
          <Legend />
          <div className="io-bar">
            <div>
              <b>Save your arrangement</b>
              <p className="muted small">
                Export the progression with every chord's arpeggio, position and length as a text file (readable, and editable) — Import loads it back. Your
                work is also kept automatically in this browser.
              </p>
            </div>
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={exportFile}>
                ⬇ Export .txt
              </button>
              <button type="button" className="btn" onClick={copyText}>
                Copy as text
              </button>
              {importButton}
            </div>
            {ioStatus && <p className={ioStatus.ok ? 'io-ok small' : 'warning small'}>{ioStatus.text}</p>}
          </div>
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
