import { useMemo, useState } from 'react';
import type { FretWindow } from '../theory/fretboard';
import { degree } from '../theory/intervals';
import { formatNote, mod12 } from '../theory/notes';
import { chooseScaleRoot, scaleType, spellScale, type Mood } from '../theory/scales';
import type { ScaleFit } from '../theory/scaleFit';
import type { Settings } from '../state/settings';
import { NoteMap, type MapLabels, type PcInfo } from './NoteMap';

interface Props {
  fits: ScaleFit[];
  tuning: number[];
  settings: Settings;
  win: FretWindow | null;
  labels: MapLabels;
  /** Id of what is currently playing ("scale-<id>-solo" / "scale-<id>-over"). */
  playing?: string | null;
  /** The note being played, to highlight on the open scale's fretboard. */
  active?: { scaleId: string; string: number; fret: number } | null;
  /** Play a scale alone, or over the chords of the progression. */
  onPlay?: (fit: ScaleFit, over: boolean) => void;
}

const MOOD_ORDER: Mood[] = [
  'safe', 'happy', 'bright', 'dreamy', 'soulful', 'jazzy', 'bluesy', 'rock', 'sad', 'bittersweet',
  'epic', 'cinematic', 'dark', 'spicy', 'exotic', 'tense', 'mysterious', 'eerie',
];

const TOP = 10;

function scaleInfo(fit: ScaleFit, pref: Settings['accidentals']): Map<number, PcInfo> {
  const { rootPc, scaleId } = fit.ctx;
  const root = fit.root ?? chooseScaleRoot(rootPc, scaleId, pref);
  const spelled = spellScale(root, rootPc, scaleId);
  const m = new Map<number, PcInfo>();
  scaleType(scaleId).degrees.forEach((d, i) => m.set(mod12(rootPc + degree(d).semi), { degree: d, name: formatNote(spelled[i]) }));
  return m;
}

export function MoodTag({ mood }: { mood: Mood }) {
  return <span className={`mood mood-${mood}`}>{mood}</span>;
}

/** Every scale, ranked by how closely it fits the progression, with mood tags and comments. */
export function ScaleRanking({ fits, tuning, settings, win, labels, playing, active, onPlay }: Props) {
  const [mood, setMood] = useState<Mood | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const moods = useMemo(() => MOOD_ORDER.filter((m) => fits.some((f) => f.moods.includes(m))), [fits]);
  const filtered = mood === 'all' ? fits : fits.filter((f) => f.moods.includes(mood));
  const visible = showAll ? filtered : filtered.slice(0, TOP);

  return (
    <div className="solo-scales">
      <div className="solo-head">
        <div className="kicker">Scales for soloing — ranked by how closely they fit the progression</div>
        <span className="muted small">{fits.length} scales on the tonic · click one to see it on the neck · ▶ to hear it</span>
      </div>
      <div className="chips mood-filter" role="group" aria-label="Filter scales by mood">
        <button type="button" className={`chip${mood === 'all' ? ' active' : ''}`} aria-pressed={mood === 'all'} onClick={() => setMood('all')}>
          All
        </button>
        {moods.map((m) => (
          <button
            type="button"
            key={m}
            className={`chip mood-chip mood-${m}${mood === m ? ' active' : ''}`}
            aria-pressed={mood === m}
            onClick={() => setMood(mood === m ? 'all' : m)}
          >
            {m}
          </button>
        ))}
      </div>
      <ol className="scale-rank">
        {visible.map((f) => {
          const id = f.ctx.scaleId;
          const pct = Math.round(f.closeness * 100);
          const grade = pct >= 90 ? 'great' : pct >= 75 ? 'good' : pct >= 60 ? 'ok' : 'poor';
          const open = selected === id;
          return (
            <li key={id} className={`${open ? 'open' : ''}${playing?.startsWith(`scale-${id}-`) ? ' sounding' : ''}`}>
              <div className="scale-li">
                <button type="button" className="scale-row" aria-expanded={open} onClick={() => setSelected(open ? null : id)}>
                  <span className="sr-rank">{fits.indexOf(f) + 1}</span>
                  <span className="sr-main">
                    <span className="sr-name">{f.label}</span>
                    <span className="sr-moods">
                      {f.moods.map((m) => (
                        <MoodTag key={m} mood={m} />
                      ))}
                    </span>
                  </span>
                  <span className="sr-fit" title="How closely the scale matches the notes of the progression">
                    <span className="bar">
                      <span className={`fill ${grade}`} style={{ width: `${pct}%` }} />
                    </span>
                    <b>{pct}%</b>
                  </span>
                  <span className="sr-detail">
                    <span className="sr-notes">
                      {f.notes}
                      {f.sameAs && <span className="muted"> · {f.sameAs}</span>}
                    </span>
                    <span className={`sr-comment${f.clashes.length ? ' has-clash' : ''}`}>{f.comment}</span>
                  </span>
                </button>
                {onPlay && (
                  <span className="sr-play">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setSelected(id);
                        onPlay(f, false);
                      }}
                      title={`Play ${f.label} up and down`}
                    >
                      {playing === `scale-${id}-solo` ? '■ Stop' : '▶ Play'}
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setSelected(id);
                        onPlay(f, true);
                      }}
                      title={`Play ${f.label} as a line over the chords of the progression`}
                    >
                      {playing === `scale-${id}-over` ? '■ Stop' : '▶ Over the chords'}
                    </button>
                  </span>
                )}
              </div>
              {open && (
                <div className="scale-view">
                  <p className="small">
                    <b>{f.label}.</b> {f.info}
                  </p>
                  <NoteMap
                    tuning={tuning}
                    settings={settings}
                    info={scaleInfo(f, settings.accidentals)}
                    win={win}
                    labels={labels}
                    ringPc={f.ctx.rootPc}
                    active={active && active.scaleId === id ? active : null}
                    ariaLabel={`${f.label} on the fretboard`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {filtered.length > TOP && (
        <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `Show top ${TOP}` : `Show all ${filtered.length} scales`}
        </button>
      )}
    </div>
  );
}
