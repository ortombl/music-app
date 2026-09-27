import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FretWindow } from '../theory/fretboard';
import { midiName, type AccidentalPref } from '../theory/notes';
import { textOn } from './colors';

export interface Marker {
  string: number;
  fret: number;
  label: string;
  color: string;
  /** Emphasise (e.g. the root). */
  ring?: boolean;
  faded?: boolean;
  title?: string;
}

interface Props {
  tuning: number[];
  frets: number;
  markers: Marker[];
  /** Faint label for empty positions (e.g. every note name). */
  ghost?: (string: number, fret: number, midi: number) => string | null;
  interactive?: boolean;
  /** Current selection (interactive mode) — used to draw the × for muted strings. */
  selection?: (number | null)[];
  onToggle?: (string: number, fret: number) => void;
  onStringLabel?: (string: number) => void;
  window?: FretWindow | null;
  active?: { string: number; fret: number } | null;
  compact?: boolean;
  leftHanded?: boolean;
  accidentals: AccidentalPref;
  ariaLabel: string;
}

const SINGLE_INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

/** Width available to the board, so frets can stretch to fill the card (text is not scaled). */
function useAvailableWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function FretboardImpl(p: Props) {
  const [wrapRef, avail] = useAvailableWidth();
  const n = p.tuning.length;
  const gap = p.compact ? 22 : 32;
  const openW = p.compact ? 34 : 46;
  const labelW = p.compact ? 30 : 38;
  const top = p.compact ? 12 : 16;
  const bottom = p.compact ? 22 : 28;
  const nutX = labelW + openW;
  const [minFretW, defFretW, maxFretW] = p.compact ? [28, 40, 64] : [36, 54, 90];
  const fretW = avail ? Math.max(minFretW, Math.min(maxFretW, (avail - nutX - 12) / p.frets)) : defFretW;
  const r = Math.min(p.compact ? 9 : 12.5, fretW * 0.33);
  const width = nutX + p.frets * fretW + 10;
  const boardH = (n - 1) * gap;
  const height = top + boardH + bottom;

  const X = (x: number) => (p.leftHanded ? width - x : x);
  const yOf = (s: number) => top + (n - 1 - s) * gap;
  const xOf = (f: number) => (f === 0 ? labelW + openW / 2 : nutX + (f - 0.5) * fretW);
  const lineX = (f: number) => nutX + f * fretW;

  const markerAt = new Map<string, Marker>();
  for (const m of p.markers) markerAt.set(`${m.string}:${m.fret}`, m);

  const onKey = (e: KeyboardEvent, s: number, f: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.onToggle?.(s, f);
    }
  };

  // Inlay dots sit between strings so they never hide a note label.
  const gaps = n - 1;
  const inlayMid = gaps % 2 === 0 ? gaps / 2 + 0.5 : gaps / 2;
  const inlayPair = Math.floor(gaps * 0.3) + 0.5;

  const win = p.window;
  const winX1 = win ? (win.start === 0 ? labelW : lineX(win.start - 1)) : 0;
  const winX2 = win ? lineX(Math.min(win.end, p.frets)) : 0;

  return (
    <div className={`fretboard-scroll${p.compact ? ' compact' : ''}`} ref={wrapRef}>
      <svg
        className="fretboard"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role={p.interactive ? 'group' : 'img'}
        aria-label={p.ariaLabel}
      >
        {/* board */}
        <rect className="fb-wood" x={Math.min(X(nutX), X(width - 6))} y={top - 8} width={width - 6 - nutX} height={boardH + 16} rx={4} />
        {win && (
          <rect
            className="fb-window"
            x={Math.min(X(winX1), X(winX2))}
            y={top - 10}
            width={Math.abs(winX2 - winX1)}
            height={boardH + 20}
            rx={6}
          />
        )}
        {/* inlays */}
        {SINGLE_INLAYS.filter((f) => f <= p.frets).map((f) => (
          <circle key={`in${f}`} className="fb-inlay" cx={X(xOf(f))} cy={top + gap * inlayMid} r={p.compact ? 4 : 6} />
        ))}
        {DOUBLE_INLAYS.filter((f) => f <= p.frets).map((f) => (
          <g key={`in${f}`}>
            <circle className="fb-inlay" cx={X(xOf(f))} cy={top + gap * inlayPair} r={p.compact ? 4 : 6} />
            <circle className="fb-inlay" cx={X(xOf(f))} cy={top + gap * (n - 1 - inlayPair)} r={p.compact ? 4 : 6} />
          </g>
        ))}
        {/* frets */}
        {Array.from({ length: p.frets }, (_, i) => i + 1).map((f) => (
          <line key={`f${f}`} className="fb-fret" x1={X(lineX(f))} x2={X(lineX(f))} y1={top - 8} y2={top + boardH + 8} />
        ))}
        <line className="fb-nut" x1={X(nutX)} x2={X(nutX)} y1={top - 8} y2={top + boardH + 8} />
        {/* strings */}
        {p.tuning.map((_, s) => (
          <line
            key={`s${s}`}
            className="fb-string"
            x1={X(labelW + 6)}
            x2={X(width - 6)}
            y1={yOf(s)}
            y2={yOf(s)}
            strokeWidth={0.9 + (1 - s / Math.max(1, n - 1)) * 1.7}
          />
        ))}
        {/* fret numbers */}
        {Array.from({ length: p.frets + 1 }, (_, f) => f).map((f) => (
          <text
            key={`n${f}`}
            className={`fb-fretnum${SINGLE_INLAYS.includes(f) || DOUBLE_INLAYS.includes(f) ? ' strong' : ''}`}
            x={X(xOf(f))}
            y={top + boardH + bottom - 6}
            textAnchor="middle"
          >
            {f}
          </text>
        ))}
        {/* string names */}
        {p.tuning.map((open, s) => {
          const name = midiName(open, p.accidentals);
          const clickable = !!p.onStringLabel;
          return (
            <g
              key={`l${s}`}
              className={`fb-strlabel${clickable ? ' clickable' : ''}`}
              onClick={clickable ? () => p.onStringLabel!(s) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), p.onStringLabel!(s)) : undefined}
              aria-label={clickable ? `String ${n - s} (${name}): toggle open / muted` : undefined}
            >
              <title>{`String ${n - s}: ${name}`}</title>
              <text x={X(labelW / 2)} y={yOf(s) + 4} textAnchor="middle">
                {name.replace(/-?\d+$/, '')}
                <tspan className="fb-oct">{name.match(/-?\d+$/)?.[0]}</tspan>
              </text>
            </g>
          );
        })}
        {/* cells */}
        {p.tuning.map((open, s) =>
          Array.from({ length: p.frets + 1 }, (_, f) => f).map((f) => {
            const m = markerAt.get(`${s}:${f}`);
            const cx = X(xOf(f));
            const cy = yOf(s);
            const midi = open + f;
            const outside = win && (f < win.start || f > win.end);
            // In interactive mode the open-string column shows × for muted strings instead of a label.
            const ghost = !m && p.ghost && !(p.interactive && f === 0) ? p.ghost(s, f, midi) : null;
            const muted = p.interactive && f === 0 && p.selection && p.selection[s] === null;
            const isActive = p.active && p.active.string === s && p.active.fret === f;
            const cellW = f === 0 ? openW : fretW;
            return (
              <g
                key={`c${s}:${f}`}
                className={`fb-cell${p.interactive ? ' interactive' : ''}${outside ? ' outside' : ''}`}
                onClick={p.interactive ? () => p.onToggle?.(s, f) : undefined}
                onKeyDown={p.interactive ? (e) => onKey(e, s, f) : undefined}
                tabIndex={p.interactive ? 0 : undefined}
                role={p.interactive ? 'button' : undefined}
                aria-pressed={p.interactive ? !!m : undefined}
                aria-label={p.interactive ? `String ${n - s}, ${f === 0 ? 'open' : `fret ${f}`}: ${midiName(midi, p.accidentals)}` : undefined}
              >
                {p.interactive && <rect className="fb-hit" x={cx - cellW / 2} y={cy - gap / 2} width={cellW} height={gap} />}
                {p.interactive && !m && <circle className="fb-hover" cx={cx} cy={cy} r={r} />}
                {muted && (
                  <text className="fb-muted" x={cx} y={cy + 5} textAnchor="middle">
                    ×
                  </text>
                )}
                {ghost && (
                  <text className="fb-ghost" x={cx} y={cy + 3.5} textAnchor="middle">
                    {ghost}
                  </text>
                )}
                {m && (
                  <g className={`fb-marker${m.faded ? ' faded' : ''}${isActive ? ' active' : ''}`}>
                    {m.title && <title>{m.title}</title>}
                    {isActive && <circle className="fb-pulse" cx={cx} cy={cy} r={r + 5} />}
                    <circle cx={cx} cy={cy} r={r} fill={m.color} className={m.ring ? 'ring' : ''} />
                    <text x={cx} y={cy + (p.compact ? 3.5 : 4.3)} textAnchor="middle" fill={textOn(m.color)} className={m.label.length > 2 ? 'small' : ''}>
                      {m.label}
                    </text>
                  </g>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

export const Fretboard = memo(FretboardImpl);
