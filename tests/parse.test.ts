import { describe, expect, it } from 'vitest';
import { parseChordSymbol, parseProgression } from '../src/theory/parse';

const id = (s: string) => parseChordSymbol(s)?.type.id;

describe('parseChordSymbol', () => {
  it.each([
    ['C', 'maj'], ['Cmaj', 'maj'], ['CM', 'maj'], ['Am', 'm'], ['Amin', 'm'], ['A-', 'm'], ['Ami', 'm'],
    ['C7', '7'], ['Cmaj7', 'maj7'], ['CM7', 'maj7'], ['CΔ7', 'maj7'], ['CΔ', 'maj7'],
    ['Cm7', 'm7'], ['C-7', 'm7'], ['Cmin7', 'm7'], ['Cm7b5', 'm7b5'], ['Cø', 'm7b5'], ['Cø7', 'm7b5'], ['Cm7-5', 'm7b5'],
    ['Cdim', 'dim'], ['C°', 'dim'], ['Cdim7', 'dim7'], ['C°7', 'dim7'], ['Caug', 'aug'], ['C+', 'aug'],
    ['C7#5', '7#5'], ['C+7', '7#5'], ['Caug7', '7#5'], ['Csus', 'sus4'], ['Csus4', 'sus4'], ['Csus2', 'sus2'],
    ['C7sus4', '7sus4'], ['C6', '6'], ['Cm6', 'm6'], ['C6/9', '6/9'], ['C69', '6/9'], ['Cadd9', 'add9'], ['Cadd2', 'add9'],
    ['Cm(add9)', 'madd9'], ['C5', '5'], ['C9', '9'], ['Cmaj9', 'maj9'], ['Cm9', 'm9'], ['C7b9', '7b9'], ['C7(b9)', '7b9'],
    ['C7#9', '7#9'], ['C7♯9', '7#9'], ['C11', '11'], ['Cm11', 'm11'], ['C13', '13'], ['Cmaj7#11', 'maj7#11'],
    ['Cm(maj7)', 'mmaj7'], ['CmM7', 'mmaj7'], ['CmMaj7', 'mmaj7'], ['C7alt', '7alt'], ['CMA7', 'maj7'],
  ])('%s → %s', (sym, expected) => {
    expect(id(sym)).toBe(expected);
  });

  it('keeps the user spelling of the root', () => {
    expect(parseChordSymbol('Db7')!.display).toBe('D♭7');
    expect(parseChordSymbol('C#m7')!.display).toBe('C♯m7');
    expect(parseChordSymbol('Bbmaj7')!.rootPc).toBe(10);
  });

  it('parses slash chords', () => {
    const c = parseChordSymbol('D/F#')!;
    expect(c.rootPc).toBe(2);
    expect(c.bassPc).toBe(6);
    expect(c.display).toBe('D/F♯');
    expect(parseChordSymbol('Am7/G')!.bassPc).toBe(7);
    // "6/9" is not a slash chord
    expect(parseChordSymbol('C6/9')!.bassPc).toBeUndefined();
  });

  it('rejects garbage', () => {
    expect(parseChordSymbol('H7')).toBeNull();
    expect(parseChordSymbol('Cxyz')).toBeNull();
    expect(parseChordSymbol('')).toBeNull();
  });
});

describe('parseProgression', () => {
  it('splits on spaces, bars and commas and supports % repeats', () => {
    const r = parseProgression('Am7 | D7 | Gmaj7, Cmaj7 | %');
    expect(r.errors).toEqual([]);
    expect(r.chords.map((c) => c.display)).toEqual(['Am7', 'D7', 'Gmaj7', 'Cmaj7', 'Cmaj7']);
  });
  it('reports unknown tokens', () => {
    const r = parseProgression('C foo G');
    expect(r.chords).toHaveLength(2);
    expect(r.errors).toEqual(['foo']);
  });
});
