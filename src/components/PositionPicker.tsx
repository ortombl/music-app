import type { FretWindow, PositionSuggestion } from '../theory/fretboard';

interface Props {
  positions: PositionSuggestion[];
  value: FretWindow | null;
  onChange: (w: FretWindow | null) => void;
  frets: number;
}

/** "Whole neck" or a 5-fret playing position (suggested ones are anchored on the root). */
export function PositionPicker({ positions, value, onChange, frets }: Props) {
  const maxStart = Math.max(0, frets - 4);
  return (
    <div className="position-picker" role="group" aria-label="Fretboard position">
      <span className="pp-label">Position</span>
      <button type="button" className={`chip${value === null ? ' active' : ''}`} onClick={() => onChange(null)} aria-pressed={value === null}>
        Whole neck
      </button>
      {positions.map((p) => {
        const active = value !== null && value.start === p.start && value.end === p.end;
        return (
          <button
            type="button"
            key={`${p.start}-${p.end}`}
            className={`chip${active ? ' active' : ''}`}
            title={p.label}
            aria-pressed={active}
            onClick={() => onChange({ start: p.start, end: p.end })}
          >
            {p.start}–{p.end}
          </button>
        );
      })}
      <label className="pp-slider" title="Slide the 5-fret window along the neck">
        <input
          type="range"
          min={0}
          max={maxStart}
          value={value ? value.start : 0}
          aria-label="Position window start fret"
          onChange={(e) => {
            const s = Number(e.target.value);
            onChange({ start: s, end: s + 4 });
          }}
        />
        <span>{value ? `frets ${value.start}–${value.end}` : 'slide'}</span>
      </label>
    </div>
  );
}
