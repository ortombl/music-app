import { useEffect, useRef, useState } from 'react';
import { LETTERS, midiName, midiOctave, mod12, pcName, type AccidentalPref } from '../theory/notes';
import { matchPreset, TUNING_GROUPS, TUNINGS, tuningNotes } from '../theory/tunings';
import type { Settings } from '../state/settings';

interface Props {
  settings: Settings;
  strings: number[];
  onChange: (tuningId: string, customStrings?: number[]) => void;
}

export function TuningPicker({ settings, strings, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="tuning-picker">
      <label className="field">
        <span>Tuning</span>
        <select value={settings.tuningId} onChange={(e) => onChange(e.target.value)} aria-label="Tuning">
          {TUNING_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {TUNINGS.filter((t) => t.group === g).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({tuningNotes(t.strings)})
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Custom">
            <option value="custom">
              Custom ({tuningNotes(settings.customStrings)}) · {settings.customStrings.length} strings
            </option>
          </optgroup>
        </select>
      </label>
      <button type="button" className="btn small" onClick={() => setEditing(true)} title="Edit the tuning string by string">
        Edit…
      </button>
      {editing && (
        <TuningEditor
          initial={strings}
          accidentals={settings.accidentals}
          onClose={() => setEditing(false)}
          onApply={(arr) => {
            const preset = matchPreset(arr);
            onChange(preset ? preset.id : 'custom', arr);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

const OCTAVES = [0, 1, 2, 3, 4, 5];

function TuningEditor({
  initial,
  accidentals,
  onApply,
  onClose,
}: {
  initial: number[];
  accidentals: AccidentalPref;
  onApply: (strings: number[]) => void;
  onClose: () => void;
}) {
  const [strs, setStrs] = useState<number[]>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('select, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (i: number, midi: number) => setStrs((s) => s.map((v, j) => (j === i ? Math.max(12, Math.min(96, midi)) : v)));
  const preset = matchPreset(strs);
  // Display highest string first, like a tab.
  const order = strs.map((_, i) => i).reverse();

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tuning-editor-title" ref={dialogRef}>
        <h2 id="tuning-editor-title">Edit tuning</h2>
        <p className="muted">
          {strs.length} strings · {preset ? preset.name : 'Custom tuning'} · {strs.map((m) => midiName(m, accidentals)).join(' ')}
        </p>
        <label className="field">
          <span>Start from</span>
          <select
            value=""
            onChange={(e) => {
              const t = TUNINGS.find((x) => x.id === e.target.value);
              if (t) setStrs([...t.strings]);
            }}
          >
            <option value="">Choose a preset…</option>
            {TUNINGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.group}: {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="tuning-rows">
          {order.map((i, row) => (
            <div className="tuning-row" key={i}>
              <span className="tuning-idx">String {row + 1}</span>
              <select aria-label={`String ${row + 1} note`} value={mod12(strs[i])} onChange={(e) => set(i, (midiOctave(strs[i]) + 1) * 12 + Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, pc) => (
                  <option key={pc} value={pc}>
                    {pcName(pc, accidentals)}
                  </option>
                ))}
              </select>
              <select aria-label={`String ${row + 1} octave`} value={midiOctave(strs[i])} onChange={(e) => set(i, (Number(e.target.value) + 1) * 12 + mod12(strs[i]))}>
                {OCTAVES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <button type="button" className="btn icon" aria-label="Tune down a semitone" onClick={() => set(i, strs[i] - 1)}>
                −
              </button>
              <button type="button" className="btn icon" aria-label="Tune up a semitone" onClick={() => set(i, strs[i] + 1)}>
                +
              </button>
              <button
                type="button"
                className="btn icon danger"
                aria-label={`Remove string ${row + 1}`}
                disabled={strs.length <= 3}
                onClick={() => setStrs((s) => s.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="row wrap gap">
          <button type="button" className="btn" disabled={strs.length >= 10} onClick={() => setStrs((s) => [...s, s[s.length - 1] + 5])}>
            + Add higher string
          </button>
          <button type="button" className="btn" disabled={strs.length >= 10} onClick={() => setStrs((s) => [s[0] - 5, ...s])}>
            + Add lower string
          </button>
          <button type="button" className="btn" onClick={() => setStrs((s) => s.map((v) => v - 1))}>
            All −1 semitone
          </button>
          <button type="button" className="btn" onClick={() => setStrs((s) => s.map((v) => v + 1))}>
            All +1 semitone
          </button>
          <button type="button" className="btn" onClick={() => setStrs((s) => [s[0] - 2, ...s.slice(1)])} title="Lower the lowest string by a whole step">
            Drop lowest string
          </button>
        </div>
        <p className="muted small">
          Note names use {LETTERS.join(' ')} with octave numbers (middle C = C4). Strings must be listed from lowest to highest pitch for the
          most natural results, but any order works.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(strs)}>
            Apply tuning
          </button>
        </div>
      </div>
    </div>
  );
}
