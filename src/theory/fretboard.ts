// Fretboard geometry helpers: where notes lie on a given tuning, playing positions, runs.

import { mod12, type PitchClass } from './notes';

export interface FretNote {
  string: number; // 0 = lowest string
  fret: number;
  midi: number;
  pc: PitchClass;
}

export interface FretWindow {
  start: number;
  end: number;
}

export function notesOnBoard(tuning: number[], numFrets: number, pcs: Iterable<PitchClass>, window?: FretWindow | null): FretNote[] {
  const set = new Set(pcs);
  const out: FretNote[] = [];
  tuning.forEach((open, s) => {
    const lo = window ? window.start : 0;
    const hi = window ? Math.min(window.end, numFrets) : numFrets;
    for (let f = lo; f <= hi; f++) {
      const midi = open + f;
      if (set.has(mod12(midi))) out.push({ string: s, fret: f, midi, pc: mod12(midi) });
    }
  });
  return out;
}

export interface PositionSuggestion extends FretWindow {
  label: string;
}

/**
 * Playing positions anchored on the chord root (root on one of the three lowest strings, as in
 * the CAGED / "root on the 6th, 5th, 4th string" way of thinking), each spanning 5 frets.
 */
export function rootPositions(tuning: number[], numFrets: number, rootPc: PitchClass, span = 4): PositionSuggestion[] {
  const n = tuning.length;
  const out: PositionSuggestion[] = [];
  const anchorStrings = [0, 1, 2].filter((s) => s < n);
  for (const s of anchorStrings) {
    for (let f = 0; f <= numFrets; f++) {
      if (mod12(tuning[s] + f) !== rootPc) continue;
      let start = Math.max(0, f - 1);
      let end = start + span;
      if (end > numFrets) {
        end = numFrets;
        start = Math.max(0, end - span);
      }
      const stringNo = n - s; // conventional numbering: highest string = 1
      out.push({ start, end, label: `Frets ${start}–${end} · root on string ${stringNo}` });
    }
  }
  out.sort((a, b) => a.start - b.start);
  const merged: PositionSuggestion[] = [];
  for (const p of out) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.start - p.start) <= 1) continue;
    merged.push(p);
  }
  return merged;
}

/**
 * A playable run through the given notes: all distinct pitches in the window (or two octaves
 * from the lowest root on the neck), ascending then descending.
 */
export function arpeggioRun(tuning: number[], numFrets: number, pcs: PitchClass[], rootPc: PitchClass, window?: FretWindow | null): number[] {
  const notes = notesOnBoard(tuning, numFrets, pcs, window);
  let midis = [...new Set(notes.map((x) => x.midi))].sort((a, b) => a - b);
  if (!window) {
    const firstRoot = midis.find((m) => mod12(m) === rootPc);
    if (firstRoot === undefined) return [];
    midis = midis.filter((m) => m >= firstRoot && m <= firstRoot + 24);
  } else {
    // Start from the lowest root inside the window when there is one.
    const firstRoot = midis.find((m) => mod12(m) === rootPc);
    if (firstRoot !== undefined && firstRoot - midis[0] <= 12) midis = midis.filter((m) => m >= firstRoot);
  }
  if (midis.length < 2) return midis;
  return [...midis, ...midis.slice(0, -1).reverse()];
}

/** For a note of a run, pick a fret position (string/fret) in the window — lowest string first. */
export function positionForMidi(tuning: number[], numFrets: number, midi: number, window?: FretWindow | null): FretNote | null {
  const lo = window ? window.start : 0;
  const hi = window ? Math.min(window.end, numFrets) : numFrets;
  let best: FretNote | null = null;
  for (let s = 0; s < tuning.length; s++) {
    const f = midi - tuning[s];
    if (f < lo || f > hi) continue;
    // Prefer lower frets (closer to the window start) on higher strings for a compact run.
    if (!best || f < best.fret) best = { string: s, fret: f, midi, pc: mod12(midi) };
  }
  return best;
}
