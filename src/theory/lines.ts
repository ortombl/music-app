// Melodic lines for practice playback: arpeggio and scale lines that stay in one playing
// position (or a two-octave middle register) and connect smoothly from chord to chord.

import { notesOnBoard, type FretWindow } from './fretboard';
import { mod12, type PitchClass } from './notes';

/**
 * Every distinct pitch of the given pitch classes that can be played in the position window, or —
 * for the whole neck — in the two octaves above the second-lowest open string.
 */
export function pitchPool(tuning: number[], numFrets: number, pcs: Iterable<PitchClass>, window?: FretWindow | null): number[] {
  const all = [...new Set(notesOnBoard(tuning, numFrets, pcs, window).map((n) => n.midi))].sort((a, b) => a - b);
  if (window) return all;
  const low = tuning[Math.min(1, tuning.length - 1)];
  return all.filter((m) => m >= low && m <= low + 24);
}

/** Walk step by step through a sorted pool, bouncing at either end. */
export function walk(pool: number[], start: number, dir: 1 | -1, count: number): { notes: number[]; end: number; dir: 1 | -1 } {
  if (!pool.length) return { notes: [], end: 0, dir };
  let idx = Math.max(0, Math.min(pool.length - 1, start));
  let d = dir;
  const notes: number[] = [];
  for (let k = 0; k < count; k++) {
    notes.push(pool[idx]);
    if (pool.length === 1) continue;
    if (idx + d < 0 || idx + d >= pool.length) d = (d === 1 ? -1 : 1) as 1 | -1;
    idx += d;
  }
  // `idx` is already the next position to play.
  return { notes, end: idx, dir: d };
}

function nearestIndex(pool: number[], target: number, dir: 1 | -1): number {
  let best = 0;
  let bestKey = Infinity;
  pool.forEach((m, i) => {
    const dist = Math.abs(m - target);
    // tie-break towards the direction of travel
    const key = dist * 2 + ((m - target) * dir >= 0 ? 0 : 1);
    if (key < bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}

/** Up-and-down line through one chord's arpeggio (or a scale), starting from the lowest root. */
export function lineFromRoot(pool: number[], rootPc: PitchClass, count: number): number[] {
  const start = Math.max(0, pool.findIndex((m) => mod12(m) === rootPc));
  return walk(pool, start, 1, count).notes;
}

/**
 * Arpeggio lines through a progression with voice leading: each chord's line starts on the note
 * of its arpeggio nearest to where the previous line ended, and keeps moving in the same
 * direction (bouncing at the edges of the position).
 */
export function voiceLedLines(pools: number[][], rootPcs: PitchClass[], notesPerChord: number | number[]): number[][] {
  const count = (i: number) => (Array.isArray(notesPerChord) ? notesPerChord[i] : notesPerChord);
  let prev: number | null = null;
  let dir: 1 | -1 = 1;
  return pools.map((pool, i) => {
    if (!pool.length) return [];
    let start: number;
    if (prev === null) {
      start = Math.max(0, pool.findIndex((m) => mod12(m) === rootPcs[i]));
    } else {
      start = nearestIndex(pool, prev + dir, dir);
    }
    const w = walk(pool, start, dir, count(i));
    dir = w.dir;
    prev = w.notes[w.notes.length - 1];
    return w.notes;
  });
}

/**
 * A continuous scale line over a progression that lands on a chord tone at every chord change
 * (the downbeat), so the scale is heard *against* the harmony rather than just run up and down.
 */
export function scaleLineOverChords(pool: number[], chordTones: Set<PitchClass>[], rootPc: PitchClass, notesPerChord: number | number[]): number[][] {
  const count = (i: number) => (Array.isArray(notesPerChord) ? notesPerChord[i] : notesPerChord);
  if (!pool.length) return chordTones.map(() => []);
  let idx = Math.max(0, pool.findIndex((m) => mod12(m) === rootPc));
  let dir: 1 | -1 = 1;
  return chordTones.map((tones, i) => {
    if (!tones.has(mod12(pool[idx]))) {
      // move to the nearest chord tone, preferring the direction of travel
      for (let d = 1; d < pool.length; d++) {
        const ahead = idx + d * dir;
        const behind = idx - d * dir;
        if (ahead >= 0 && ahead < pool.length && tones.has(mod12(pool[ahead]))) {
          idx = ahead;
          break;
        }
        if (behind >= 0 && behind < pool.length && tones.has(mod12(pool[behind]))) {
          idx = behind;
          break;
        }
      }
    }
    const w = walk(pool, idx, dir, count(i));
    idx = w.end;
    dir = w.dir;
    return w.notes;
  });
}
