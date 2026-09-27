// Turns bars of "chord + melody" into scheduled note events: a strummed chord and a bass note on
// beats 1 and 3 as the backing, with the melody (arpeggio or scale line) in eighth notes on top.

import type { NoteEvent } from './synth';

export interface Bar {
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
  stepsPerBar?: number;
}

export function arrange(bars: Bar[], { bpm, stepsPerBar = 8 }: ArrangeOptions): NoteEvent[] {
  const barDur = (4 * 60) / bpm;
  const step = barDur / stepsPerBar;
  const events: NoteEvent[] = [];
  bars.forEach((b, i) => {
    const t0 = i * barDur;
    const hasMelody = b.melody.length > 0;
    if (b.chord?.length) {
      const chord = [...b.chord].sort((x, y) => x - y);
      events.push({ time: t0, midis: chord, strum: 0.03, duration: barDur * 0.5, gain: hasMelody ? 0.42 : 0.85, onStart: b.onBar });
      events.push({ time: t0 + barDur / 2, midis: chord, strum: 0.025, duration: barDur * 0.5, gain: hasMelody ? 0.3 : 0.6 });
    } else if (b.onBar) {
      events.push({ time: t0, midis: [], duration: 0.01, onStart: b.onBar });
    }
    if (b.bass !== undefined) {
      events.push({ time: t0, midis: [b.bass], duration: barDur * 0.48, gain: hasMelody ? 0.5 : 0.7 });
      events.push({ time: t0 + barDur / 2, midis: [b.bass], duration: barDur * 0.48, gain: hasMelody ? 0.4 : 0.55 });
    }
    b.melody.forEach((m, k) => {
      events.push({
        time: t0 + k * step,
        midis: [m],
        duration: step * 1.7,
        gain: 0.95,
        onStart: b.onNote ? () => b.onNote!(k) : undefined,
      });
    });
  });
  return events;
}

/** A low bass note for a pitch class (between E1 and D♯2 — below any guitar voicing). */
export function bassNote(pc: number): number {
  const m = 28 + ((pc - 4 + 12) % 12); // E1 = 28
  return m;
}
