import { labelInChord } from '../theory/intervals';
import type { ChordSpec } from '../theory/chords';
import { mod12 } from '../theory/notes';
import { degreeColor, textOn } from './colors';

interface Props {
  frets: (number | null)[];
  tuning: number[];
  chord: ChordSpec;
  caption?: string;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}

/** Classic vertical chord box: low string on the left, nut at the top. */
export function ChordDiagram({ frets, tuning, chord, caption, onClick, title, active }: Props) {
  const n = tuning.length;
  const sg = n > 7 ? 11 : n > 6 ? 12 : 14;
  const fg = 17;
  const rows = 5;
  const left = 22;
  const top = 20;
  const width = left + (n - 1) * sg + 14;
  const height = top + rows * fg + 8;
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const base = maxF <= rows ? 1 : minF;
  const x = (s: number) => left + s * sg;
  const tab = frets.map((f) => (f === null ? 'x' : f)).join(frets.some((f) => f !== null && f > 9) ? ' ' : '');

  const content = (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        {base === 1 ? (
          <line className="cd-nut" x1={x(0)} x2={x(n - 1)} y1={top} y2={top} />
        ) : (
          <text className="cd-base" x={left - 8} y={top + fg * 0.5 + 4} textAnchor="end">
            {base}
          </text>
        )}
        {Array.from({ length: rows + 1 }, (_, i) => (
          <line key={`r${i}`} className="cd-fret" x1={x(0)} x2={x(n - 1)} y1={top + i * fg} y2={top + i * fg} />
        ))}
        {tuning.map((_, s) => (
          <line key={`s${s}`} className="cd-string" x1={x(s)} x2={x(s)} y1={top} y2={top + rows * fg} />
        ))}
        {frets.map((f, s) => {
          if (f === null)
            return (
              <text key={`m${s}`} className="cd-mute" x={x(s)} y={top - 6} textAnchor="middle">
                ×
              </text>
            );
          const midi = tuning[s] + f;
          const lbl = labelInChord(midi - chord.rootPc, chord.type.degrees);
          const isBass = chord.bassPc !== undefined && mod12(midi) === chord.bassPc && !chord.type.degreeInfo.some((d) => mod12(chord.rootPc + d.semi) === chord.bassPc);
          const color = isBass ? '#7c8aa5' : degreeColor(lbl);
          if (f === 0)
            return <circle key={`o${s}`} className="cd-open" cx={x(s)} cy={top - 9} r={4} stroke={color} />;
          const cy = top + (f - base + 0.5) * fg;
          return (
            <g key={`d${s}`}>
              <circle cx={x(s)} cy={cy} r={sg * 0.42} fill={color} />
              {sg >= 12 && (
                <text className="cd-dot" x={x(s)} y={cy + 3} textAnchor="middle" fill={textOn(color)}>
                  {lbl === '1' ? 'R' : lbl.replace('b', '♭').replace('#', '♯')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <span className="cd-tab">{tab}</span>
      {caption && <span className="cd-caption">{caption}</span>}
    </>
  );

  if (onClick)
    return (
      <button type="button" className={`chord-diagram${active ? ' active' : ''}`} onClick={onClick} title={title}>
        {content}
      </button>
    );
  return <div className="chord-diagram">{content}</div>;
}
