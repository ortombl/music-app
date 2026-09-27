import { useMemo } from 'react';
import { notesOnBoard, type FretWindow } from '../theory/fretboard';
import { prettyDegree } from '../theory/intervals';
import type { Settings } from '../state/settings';
import { degreeColor, NEUTRAL_COLOR } from './colors';
import { Fretboard, type Marker } from './Fretboard';

export interface PcInfo {
  degree: string;
  name: string;
  /** "other" notes (e.g. scale tones that are not chord tones) are drawn in a neutral colour. */
  other?: boolean;
}

export type MapLabels = 'intervals' | 'notes';

export const intervalText = (degree: string) => (degree === '1' ? 'R' : prettyDegree(degree));

interface Props {
  tuning: number[];
  settings: Settings;
  info: Map<number, PcInfo>;
  win: FretWindow | null;
  labels: MapLabels;
  active?: { string: number; fret: number } | null;
  compact?: boolean;
  /** Pitch class to outline with a ring (e.g. the arpeggio's own root). */
  ringPc?: number;
  ariaLabel: string;
}

/** A fretboard showing every occurrence of a set of pitch classes, colour-coded by degree. */
export function NoteMap({ tuning, settings, info, win, labels, active, compact, ringPc, ariaLabel }: Props) {
  const markers = useMemo<Marker[]>(() => {
    return notesOnBoard(tuning, settings.frets, info.keys()).map((n) => {
      const i = info.get(n.pc)!;
      const color = i.other ? NEUTRAL_COLOR : degreeColor(i.degree);
      return {
        string: n.string,
        fret: n.fret,
        color,
        label: labels === 'intervals' ? intervalText(i.degree) : i.name,
        ring: ringPc !== undefined && n.pc === ringPc,
        faded: !!win && (n.fret < win.start || n.fret > win.end),
        title: `${i.name} (${intervalText(i.degree)})`,
      };
    });
  }, [tuning, settings.frets, info, labels, ringPc, win]);

  return (
    <Fretboard
      tuning={tuning}
      frets={settings.frets}
      markers={markers}
      window={win}
      active={active}
      compact={compact}
      leftHanded={settings.leftHanded}
      accidentals={settings.accidentals}
      ariaLabel={ariaLabel}
    />
  );
}

export function LabelToggle({ value, onChange }: { value: MapLabels; onChange: (v: MapLabels) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Marker labels">
      <button type="button" className={value === 'notes' ? 'active' : ''} aria-pressed={value === 'notes'} onClick={() => onChange('notes')}>
        Notes
      </button>
      <button type="button" className={value === 'intervals' ? 'active' : ''} aria-pressed={value === 'intervals'} onClick={() => onChange('intervals')}>
        Intervals
      </button>
    </div>
  );
}
