import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { analyzeArpeggio, type Arpeggio } from '../theory/arpeggios';
import { parseArpeggioInput } from '../theory/arpInput';
import { BEAT_OPTIONS, beatsText, toAscii, type Slot } from '../theory/arrangement';
import { rootPositions, type FretWindow } from '../theory/fretboard';
import { prettyDegree } from '../theory/intervals';
import type { ChordAnalysis } from '../theory/key';
import type { ParsedChord } from '../theory/parse';
import type { Voicing } from '../theory/voicings';
import type { Settings } from '../state/settings';
import { ChordDiagram } from './ChordDiagram';
import { NoteMap, type MapLabels, type PcInfo } from './NoteMap';

/** Which arpeggio a chord uses, after reading its slot. */
export interface ResolvedArp {
  arp: Arpeggio;
  kind: 'own' | 'sub' | 'custom';
  subIndex?: number;
  recognisedFrom?: string;
  error?: string;
}

interface Props {
  index: number;
  chord: ParsedChord;
  analysis: ChordAnalysis;
  slot: Slot;
  resolved: ResolvedArp;
  exact: Arpeggio;
  subs: Arpeggio[];
  voicings: Voicing[];
  tuning: number[];
  settings: Settings;
  labels: MapLabels;
  globalWin: FretWindow | null;
  win: FretWindow | null;
  active: { string: number; fret: number } | null;
  playing: boolean;
  soloLabel: string;
  overLabel: string;
  onPlaySolo: () => void;
  onPlayOver: () => void;
  onChange: (patch: Partial<Slot>) => void;
  onOpenInFinder: (frets: (number | null)[]) => void;
}

const FUNC_CLASS: Record<string, string> = { T: 'func-t', S: 'func-s', D: 'func-d', '': 'func-x' };
const pct = (a: Arpeggio) => `${Math.round(a.fit * 100)}%`;

function arpToInfo(a: Arpeggio): Map<number, PcInfo> {
  const m = new Map<number, PcInfo>();
  for (const n of a.notes) m.set(n.pc, { degree: n.label, name: n.name });
  return m;
}

const posValue = (pos: Slot['pos']) => (pos === 'global' || pos === 'neck' ? pos : `${pos.start}-${pos.end}`);

/** One chord of the arrangement: its arpeggio, position and length, all editable. */
export function ArrangementCard(p: Props) {
  const { chord, analysis: an, slot, resolved, exact, subs, settings } = p;
  const pref = settings.accidentals;
  const a = resolved.arp;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.arp ?? '');
  useEffect(() => {
    if (!editing) setDraft(slot.arp ?? '');
  }, [slot.arp, editing]);

  // Live preview of a typed arpeggio: recognised name + analysis over this chord.
  const preview = useMemo(() => {
    if (!editing || !draft.trim()) return null;
    const r = parseArpeggioInput(draft, pref);
    if ('error' in r) return { error: r.error };
    return { input: r, arp: analyzeArpeggio(chord, r.chord, { pref, context: an.scale }) };
  }, [editing, draft, chord, an.scale, pref]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!preview || 'error' in preview) return;
    p.onChange({ arp: draft.trim() });
    setEditing(false);
  };

  const selectValue = resolved.kind === 'own' ? 'own' : resolved.kind === 'sub' ? `sub:${resolved.subIndex}` : 'custom';
  const onSelect = (v: string) => {
    if (v === 'own') p.onChange({ arp: null });
    else if (v === 'type') {
      setDraft(resolved.kind === 'custom' ? (slot.arp ?? '') : '');
      setEditing(true);
    } else if (v.startsWith('sub:')) p.onChange({ arp: toAscii(subs[Number(v.slice(4))].name) });
  };

  const positions = useMemo(() => {
    const list = [...rootPositions(p.tuning, settings.frets, a.chord.rootPc), ...rootPositions(p.tuning, settings.frets, chord.rootPc)];
    const seen = new Set<string>();
    const out = list
      .filter((w) => {
        const k = `${w.start}-${w.end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => x.start - y.start)
      .map((w) => ({ value: `${w.start}-${w.end}`, label: `Frets ${w.start}–${w.end}` }));
    if (typeof slot.pos === 'object' && !seen.has(posValue(slot.pos))) out.push({ value: posValue(slot.pos), label: `Frets ${slot.pos.start}–${slot.pos.end}` });
    return out;
  }, [p.tuning, settings.frets, a.chord.rootPc, chord.rootPc, slot.pos]);

  const onPosition = (v: string) => {
    if (v === 'global' || v === 'neck') p.onChange({ pos: v });
    else {
      const [start, end] = v.split('-').map(Number);
      p.onChange({ pos: { start, end } });
    }
  };

  const shown = preview && !('error' in preview) ? preview.arp : a;
  const kindLabel = resolved.kind === 'own' ? "the chord's own arpeggio" : resolved.kind === 'sub' ? 'suggested' : 'your arpeggio';

  return (
    <article className={`pc-card editor${p.playing ? ' playing' : ''}`}>
      <header>
        <span className="pc-idx">{p.index + 1}</span>
        <span className="pc-title">{chord.display}</span>
        <span className="pc-roman">{an.roman}</span>
        <span className={`func-badge ${FUNC_CLASS[an.func]}`}>{an.funcLabel}</span>
        <span className="pc-play">
          <button type="button" className="btn small" onClick={p.onPlaySolo} title={`Play the ${a.name} arpeggio`}>
            {p.soloLabel}
          </button>
          <button type="button" className="btn small" onClick={p.onPlayOver} title={`Play the ${a.name} arpeggio over ${chord.display}`}>
            {p.overLabel}
          </button>
        </span>
      </header>

      <div className="pc-controls">
        <label className="field stack">
          <span>Arpeggio</span>
          <select value={selectValue} onChange={(e) => onSelect(e.target.value)} aria-label={`Arpeggio for chord ${p.index + 1}, ${chord.display}`}>
            <option value="own">
              {exact.name} — the chord's own ({exact.notes.map((n) => n.name).join(' ')})
            </option>
            <optgroup label="Suggested · best fit first">
              {subs.map((s, j) => (
                <option key={s.id} value={`sub:${j}`}>
                  {pct(s)} · {s.name}
                  {s.sound && s.sound !== chord.display ? ` → ${s.sound}` : ''}
                </option>
              ))}
            </optgroup>
            {resolved.kind === 'custom' && (
              <optgroup label="Your arpeggio">
                <option value="custom">
                  ★ {a.name} · {pct(a)}
                </option>
              </optgroup>
            )}
            <option value="type">✎ Type your own arpeggio…</option>
          </select>
        </label>
        <label className="field stack">
          <span>Position</span>
          <select value={posValue(slot.pos)} onChange={(e) => onPosition(e.target.value)} aria-label={`Position for chord ${p.index + 1}`}>
            <option value="global">Same as all ({p.globalWin ? `frets ${p.globalWin.start}–${p.globalWin.end}` : 'whole neck'})</option>
            <option value="neck">Whole neck</option>
            {positions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field stack">
          <span>Length</span>
          <select value={slot.beats} onChange={(e) => p.onChange({ beats: Number(e.target.value) })} aria-label={`Length of chord ${p.index + 1}`}>
            {(BEAT_OPTIONS.includes(slot.beats) ? BEAT_OPTIONS : [...BEAT_OPTIONS, slot.beats].sort((x, y) => x - y)).map((b) => (
              <option key={b} value={b}>
                {beatsText(b)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {editing && (
        <form className="arp-custom" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Chord symbol or notes: Bbmaj7, F#m7b5, E(add#11,no3), E G B D…"
            aria-label={`Your arpeggio for ${chord.display}`}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button type="submit" className="btn small primary" disabled={!preview || 'error' in preview}>
            Use
          </button>
          <button type="button" className="btn small" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {preview && 'error' in preview && <p className="warning small">{preview.error}</p>}
          {preview && !('error' in preview) && preview.input.recognisedFrom && (
            <p className="muted small">
              Recognised <b>{preview.input.recognisedFrom}</b> as <b>{preview.arp.name}</b>.
            </p>
          )}
        </form>
      )}

      <div className="arp-analysis">
        <div className="aa-head">
          <b>{shown.name}</b>
          <span className="muted small">
            {editing && preview && !('error' in preview) ? 'preview' : kindLabel}
            {resolved.recognisedFrom && !editing ? ` · from ${resolved.recognisedFrom}` : ''}
          </span>
          {(resolved.kind !== 'own' || editing) && <span className="aa-fit">fit {pct(shown)}</span>}
          {shown.sound && shown.sound !== chord.display && <span className="muted small">→ {shown.sound}</span>}
          <span className="sub-adds">
            {shown.adds.map((x) => (
              <em key={x}>{prettyDegree(x)}</em>
            ))}
          </span>
        </div>
        <p className="small">
          {shown.notes.map((n) => n.name).join(' ')} · {shown.description}
          {shown.scaleLabel && resolved.kind !== 'own' ? <span className="muted"> (from {shown.scaleLabel})</span> : null}
        </p>
        {shown.warning && <p className="warning small">⚠ {shown.warning}</p>}
        {resolved.error && <p className="warning small">Saved arpeggio "{slot.arp}" could not be read — using the chord's own arpeggio.</p>}
      </div>

      <NoteMap
        tuning={p.tuning}
        settings={settings}
        info={arpToInfo(shown)}
        win={p.win}
        labels={p.labels}
        compact
        ringPc={shown.chord.rootPc}
        active={p.active}
        ariaLabel={`${shown.name} arpeggio for chord ${p.index + 1}`}
      />
      <div className="pc-voicings">
        {p.voicings.map((v) => (
          <ChordDiagram
            key={v.frets.join(',')}
            frets={v.frets}
            tuning={p.tuning}
            chord={chord}
            onClick={() => p.onOpenInFinder(v.frets)}
            title="Open this voicing in the Chord finder"
          />
        ))}
        {p.voicings.length === 0 && <span className="muted small">No comfortable voicing in this tuning.</span>}
      </div>
      {an.note && <p className="muted small">{an.note}</p>}
    </article>
  );
}
