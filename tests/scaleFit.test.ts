import { describe, expect, it } from 'vitest';
import { detectKey } from '../src/theory/key';
import { parseProgression } from '../src/theory/parse';
import { rankScalesForProgression } from '../src/theory/scaleFit';
import { SCALES } from '../src/theory/scales';

function rank(text: string) {
  const { chords } = parseProgression(text);
  const key = detectKey(chords)[0];
  return rankScalesForProgression(chords, key.tonicPc, { bluesy: key.bluesy });
}
const labels = (text: string, n = 5) => rank(text).slice(0, n).map((f) => f.label);

describe('rankScalesForProgression', () => {
  it('ranks every scale in the library, closest first, with moods and a comment', () => {
    const r = rank('C G Am F');
    expect(r).toHaveLength(SCALES.length);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].closeness).toBeGreaterThanOrEqual(r[i].closeness);
    for (const f of r) {
      expect(f.moods.length).toBeGreaterThan(0);
      expect(f.comment.length).toBeGreaterThan(0);
      expect(f.closeness).toBeGreaterThanOrEqual(0);
      expect(f.closeness).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ['C G Am F', 'C Major (Ionian)'],
    ['Am Dm E7 Am', 'A Harmonic minor'],
    ['Dm7 G7 Dm7 G7', 'D Dorian'],
    ['G F C G', 'G Mixolydian'],
    ['Cmaj7 D/C', 'C Lydian'],
    ['Em C G D', 'E Natural minor (Aeolian)'],
    ['E F E F', 'E Phrygian dominant'],
  ])('%s → %s first', (prog, best) => {
    expect(labels(prog, 1)[0]).toBe(best);
  });

  it('explains clashes', () => {
    const lydian = rank('C G Am F').find((f) => f.label === 'C Lydian')!;
    expect(lydian.clashes[0].scaleNote).toBe('F♯');
    expect(lydian.clashes[0].against).toBe('F');
    expect(lydian.comment).toMatch(/F♯ rubs against F/);
  });

  it('pentatonics beat clashing modes, and are described as leaving notes out', () => {
    const r = rank('C G Am F');
    const idx = (l: string) => r.findIndex((f) => f.label === l);
    expect(idx('C Major pentatonic')).toBeLessThan(idx('C Lydian'));
    expect(r[idx('C Major pentatonic')].comment).toMatch(/Leaves out F, B/);
  });

  it('avoid notes separate close relatives (Dorian beats Dorian ♭2 over Dm7–G7)', () => {
    const r = rank('Dm7 G7 Dm7 G7');
    expect(r[0].label).toBe('D Dorian');
    expect(r.findIndex((f) => f.label.startsWith('D Dorian ♭2'))).toBeGreaterThan(0);
  });

  it('blues scales are idiomatic in a 12-bar blues', () => {
    const top = labels('A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7', 6);
    expect(top).toContain('A Blues');
    expect(top).toContain('A Minor pentatonic');
    const blues = rank('A7 D7 A7 E7').find((f) => f.label === 'A Blues')!;
    expect(blues.comment).toMatch(/blues/);
  });

  it('works with custom chords like E♭(add♯11, no3)', () => {
    const r = rank('Eb(add#11,no3) Bb F');
    expect(r.length).toBe(SCALES.length);
    expect(r[0].closeness).toBeGreaterThan(0.8);
  });
});
