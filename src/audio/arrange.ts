// Turns bars of "chord + melody" into scheduled note events: a strummed chord and a bass note on
// beats 1 and 3 as the backing, with the melody (arpeggio or scale line) in eighth notes on top.

import type { NoteEvent } from './synth';

export interface Bar {
  /** Length in beats (default 4 = one bar of 4/4). The backing strums every two beats. */
  beats?: number;
  /** Backing chord voicing (MIDI notes); omit for no backing. */
  chord?: number[];
  /** Bass note (MIDI) played with the backing. */
  bass?: number;
  /** Melody notes, one per step (eighth notes by default). */
  melody: number[];
  /** Called when the bar starts (e.g. highlight the current chord). */
  onBar?: () => void;
  /** Called when melody note k starts (e.g. highlight it on the fretboard). */
  onNote?: (k: number) => void;
}

export interface ArrangeOptions {
  bpm: number;
}

/** Melody notes are eighth notes: two per beat. */
export const STEPS_PER_BEAT = 2;

export function arrange(bars: Bar[], { bpm }: ArrangeOptions): NoteEvent[] {
  const beat = 60 / bpm;
  const step = beat / STEPS_PER_BEAT;
  const events: NoteEvent[] = [];
  let t0 = 0;
  for (const b of bars) {
    const beats = b.beats ?? 4;
    const hasMelody = b.melody.length > 0;
    // Strum on every other beat (beats 1 and 3 of a 4/4 bar), accenting the first.
    for (let at = 0; at < beats; at += 2) {
      const first = at === 0;
      const dur = Math.min(2, beats - at) * beat;
      if (b.chord?.length) {
        const chord = [...b.chord].sort((x, y) => x - y);
        events.push({
          time: t0 + at * beat,
          midis: chord,
          strum: first ? 0.03 : 0.025,
          duration: dur,
          gain: hasMelody ? (first ? 0.42 : 0.3) : first ? 0.85 : 0.6,
          onStart: first ? b.onBar : undefined,
        });
      } else if (first && b.onBar) {
        events.push({ time: t0, midis: [], duration: 0.01, onStart: b.onBar });
      }
      if (b.bass !== undefined) {
        events.push({ time: t0 + at * beat, midis: [b.bass], duration: dur * 0.96, gain: hasMelody ? (first ? 0.5 : 0.4) : first ? 0.7 : 0.55 });
      }
    }
    const barStart = t0;
    b.melody.forEach((m, k) => {
      events.push({
        time: barStart + k * step,
        midis: [m],
        duration: step * 1.7,
        gain: 0.95,
        onStart: b.onNote ? () => b.onNote!(k) : undefined,
      });
    });
    t0 += beats * beat;
  }
  return events;
}

/** A low bass note for a pitch class (between E1 and D♯2 — below any guitar voicing). */
export function bassNote(pc: number): number {
  const m = 28 + ((pc - 4 + 12) % 12); // E1 = 28
  return m;
}
