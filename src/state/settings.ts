import { useEffect, useState } from 'react';
import type { AccidentalPref } from '../theory/notes';
import { findTuning } from '../theory/tunings';

export type LabelMode = 'notes' | 'octave' | 'intervals' | 'frets' | 'none';
export type Theme = 'dark' | 'light';

export interface Settings {
  tuningId: string; // a preset id, or "custom"
  customStrings: number[]; // MIDI notes, low → high (used when tuningId === "custom")
  frets: number;
  labelMode: LabelMode;
  accidentals: AccidentalPref;
  showAllNotes: boolean;
  leftHanded: boolean;
  theme: Theme;
}

const prefersLight = (() => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
})();

export const DEFAULT_SETTINGS: Settings = {
  tuningId: 'standard',
  customStrings: [40, 45, 50, 55, 59, 64],
  frets: 15,
  labelMode: 'notes',
  accidentals: 'auto',
  showAllNotes: true,
  leftHanded: false,
  theme: prefersLight ? 'light' : 'dark',
};

export const FRET_OPTIONS = [12, 15, 17, 19, 21, 22, 24];

export function tuningStrings(s: Settings): number[] {
  if (s.tuningId === 'custom') return s.customStrings;
  return findTuning(s.tuningId)?.strings ?? findTuning('standard')!.strings;
}

const PREFIX = 'fretboard-lab:';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...parsed };
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode etc.) — settings just won't persist */
  }
}

/** useState that remembers its value in localStorage (per browser). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load(key, initial));
  useEffect(() => save(key, value), [key, value]);
  return [value, setValue];
}
