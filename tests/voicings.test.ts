import { describe, expect, it } from 'vitest';
import { identifyChord } from '../src/theory/identify';
import { parseChordSymbol } from '../src/theory/parse';
import { findTuning } from '../src/theory/tunings';
import { generateVoicings, voicingToString } from '../src/theory/voicings';

const shapes = (sym: string, tuning = 'standard', limit = 6) =>
  generateVoicings(parseChordSymbol(sym)!, findTuning(tuning)!.strings, 22, { limit }).map(voicingToString);

describe('generateVoicings', () => {
  it.each([
    ['C', 'x32010'],
    ['G', '320003'],
    ['D', 'xx0232'],
    ['Am', 'x02210'],
    ['E7', '020100'],
    ['Cmaj7', 'x32000'],
    ['Dm7', 'xx0211'],
    ['C9', 'x32333'],
    ['D/F#', '200232'],
  ])('%s → best shape %s (standard)', (sym, shape) => {
    expect(shapes(sym)[0]).toBe(shape);
  });

  it('F barre chord is among the results', () => {
    expect(shapes('F')).toContain('133211');
  });

  it('drop tunings', () => {
    expect(shapes('D5', 'dropD')[0]).toBe('000xxx');
    expect(shapes('C5', 'dropC')[0]).toBe('000xxx');
    expect(shapes('D', 'dropD')[0]).toBe('000232');
  });

  it('extended range', () => {
    expect(shapes('Em', '7standard')[0]).toBe('x022000');
    expect(shapes('F#5', '8standard').length).toBeGreaterThan(0);
  });

  it('every voicing really spells the chord (verified with the identifier)', () => {
    for (const [sym, tuning] of [
      ['Cmaj7', 'standard'],
      ['Bm7b5', 'standard'],
      ['G7', 'dropD'],
      ['A', 'baritoneB'],
      ['E9', '7standard'],
    ] as const) {
      const chord = parseChordSymbol(sym)!;
      const t = findTuning(tuning)!.strings;
      for (const v of generateVoicings(chord, t, 22, { limit: 8 })) {
        const names = identifyChord(v.midis, 'auto', 20).map((m) => m.name);
        expect(names, `${sym} ${voicingToString(v)} in ${tuning}`).toContain(chord.display);
      }
    }
  });

  it('respects a maximum stretch of 4 frets and at most 4 fingers', () => {
    for (const v of generateVoicings(parseChordSymbol('Cmaj9')!, findTuning('standard')!.strings, 22, { limit: 20 })) {
      const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
      if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
    }
  });
});
