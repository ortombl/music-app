import { describe, expect, it } from 'vitest';
import { arrange, bassNote } from '../src/audio/arrange';
import { chordPcs } from '../src/theory/chords';
import { mod12 } from '../src/theory/notes';
import { parseProgression } from '../src/theory/parse';
import { findTuning } from '../src/theory/tunings';
import { lineFromRoot, pitchPool, scaleLineOverChords, voiceLedLines, walk } from '../src/theory/lines';
import { scalePcs } from '../src/theory/scales';

const std = findTuning('standard')!.strings;

describe('pitchPool', () => {
  it('only contains playable notes of the pitch classes, inside the window', () => {
    const pool = pitchPool(std, 15, [0, 4, 7], { start: 7, end: 11 });
    expect(pool.length).toBeGreaterThan(4);
    for (const m of pool) expect([0, 4, 7]).toContain(mod12(m));
    // everything is reachable at frets 7–11
    for (const m of pool) expect(std.some((open) => m - open >= 7 && m - open <= 11)).toBe(true);
    expect([...pool].sort((a, b) => a - b)).toEqual(pool);
  });
  it('whole neck = two octaves above the second-lowest string', () => {
    const pool = pitchPool(std, 15, [0, 4, 7]);
    expect(Math.min(...pool)).toBeGreaterThanOrEqual(45);
    expect(Math.max(...pool)).toBeLessThanOrEqual(69);
  });
});

describe('walk', () => {
  it('bounces at the ends', () => {
    expect(walk([1, 2, 3], 0, 1, 7).notes).toEqual([1, 2, 3, 2, 1, 2, 3]);
    expect(walk([5], 0, 1, 3).notes).toEqual([5, 5, 5]);
  });
});

describe('lines over a progression', () => {
  const { chords } = parseProgression('Dm7 G7 Cmaj7 A7');
  const win = { start: 5, end: 9 };

  it('arpeggio lines use only each chord’s notes and move smoothly between chords', () => {
    const pools = chords.map((c) => pitchPool(std, 15, chordPcs(c), win));
    const lines = voiceLedLines(pools, chords.map((c) => c.rootPc), 8);
    lines.forEach((line, i) => {
      expect(line).toHaveLength(8);
      const pcs = new Set(chordPcs(chords[i]));
      for (const m of line) expect(pcs.has(mod12(m))).toBe(true);
    });
    // voice leading: each new chord starts close to where the previous one ended
    for (let i = 1; i < lines.length; i++) expect(Math.abs(lines[i][0] - lines[i - 1][7])).toBeLessThanOrEqual(5);
    expect(mod12(lines[0][0])).toBe(2); // starts on the root of Dm7
  });

  it('a scale line lands on a chord tone at every chord change and stays in the scale', () => {
    const pcs = scalePcs(0, 'ionian');
    const pool = pitchPool(std, 15, pcs, win);
    const sets = chords.map((c) => new Set(chordPcs(c)));
    const lines = scaleLineOverChords(pool, sets, 0, 8);
    lines.forEach((line, i) => {
      expect(line).toHaveLength(8);
      expect(sets[i].has(mod12(line[0]))).toBe(true);
      for (const m of line) expect(pcs).toContain(mod12(m));
    });
  });

  it('lineFromRoot starts on the root', () => {
    const line = lineFromRoot(pitchPool(std, 15, [9, 0, 4]), 9, 16);
    expect(line).toHaveLength(16);
    expect(mod12(line[0])).toBe(9);
  });
});

describe('arrange', () => {
  it('schedules backing on beats 1 and 3 and the melody in eighth notes', () => {
    const bars = [
      { chord: [48, 52, 55], bass: bassNote(0), melody: [60, 62, 64, 65, 67, 69, 71, 72] },
      { chord: [53, 57, 60], melody: [] },
    ];
    const ev = arrange(bars, { bpm: 120 });
    // bar = 2 s at 120 BPM → eighth = 0.25 s
    const melody = ev.filter((e) => e.midis.length === 1 && e.midis[0] >= 60);
    expect(melody.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    const strums = ev.filter((e) => e.midis.length === 3);
    expect(strums.map((e) => e.time)).toEqual([0, 1, 2, 3]);
    // the backing is quieter under a melody than on its own
    expect(strums[0].gain!).toBeLessThan(strums[2].gain!);
    expect(bassNote(0)).toBe(36);
    expect(bassNote(4)).toBe(28);
  });
});
