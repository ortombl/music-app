import { describe, expect, it } from 'vitest';
import { describeInversion, identifyChord, nameOverRoot } from '../src/theory/identify';
import { chordName, chordType, spellChord } from '../src/theory/chords';
import { formatNote } from '../src/theory/notes';
import { shape } from './helpers';

const top = (frets: string, tuning?: string) => identifyChord(shape(frets, tuning))[0]?.name;

describe('identifyChord — common shapes in standard tuning', () => {
  it.each([
    ['x32010', 'C'],
    ['320003', 'G'],
    ['xx0232', 'D'],
    ['022100', 'E'],
    ['x02220', 'A'],
    ['022000', 'Em'],
    ['x02210', 'Am'],
    ['xx0231', 'Dm'],
    ['133211', 'F'],
    ['x13331', 'B♭'],
    ['x13321', 'B♭m'],
    ['x46664', 'D♭'],
    ['466544', 'A♭'],
    ['x02010', 'Am7'],
    ['x32000', 'Cmaj7'],
    ['xx0212', 'D7'],
    ['020100', 'E7'],
    ['x3231x', 'C7'],
    ['x2323x', 'Bm7♭5'],
    ['x3424x', 'Cdim7'],
    ['x32030', 'Cadd9'],
    ['x35555', 'C6'],
    ['x3234x', 'C7♯9'],
    ['x3233x', 'C9'],
    ['x3243x', 'Cmaj9'],
    ['x3133x', 'Cm9'],
    ['2x0232', 'D/F♯'],
    ['x00232', 'D/A'],
    ['xx0233', 'Dsus4'],
    ['xx0230', 'Dsus2'],
    ['x02200', 'Asus2'],
    ['x02030', 'A7sus4'],
    ['x3x2x0', 'Am/C'],
  ])('%s → %s', (frets, name) => {
    expect(top(frets)).toBe(name);
  });

  it('power chords', () => {
    expect(top('355xxx')).toBe('G5');
    expect(top('x355xx')).toBe('C5');
  });

  it('bass note decides between relative chords (C6 vs Am7)', () => {
    expect(top('x32253')).toBe('C6'); // C E A E G with C in the bass
    expect(top('x02013')).toBe('Am7'); // same notes, A in the bass
    expect(top('x0221x')).toBe('Am');
  });

  it('describes inversions', () => {
    const m = identifyChord(shape('2x0232'))[0];
    expect(describeInversion(m)).toMatch(/1st inversion/);
  });

  it('returns alternatives with probabilities summing to ≤ 1', () => {
    const res = identifyChord(shape('x02010'));
    expect(res.length).toBeGreaterThan(1);
    expect(res.some((r) => r.name === 'C6/A')).toBe(true);
    const sum = res.reduce((s, r) => s + r.probability, 0);
    expect(sum).toBeLessThanOrEqual(1.0001);
    expect(res[0].probability).toBeGreaterThan(0.5);
  });

  it('identifies slash chords with a non-chord bass', () => {
    // C bass under a D major triad → D/C (named as D7/C, 3rd inversion of D7, or D/C)
    const res = identifyChord(shape('x3x232')).map((r) => r.name);
    expect(res[0]).toMatch(/^D7?\/C$/);
  });

  it('returns nothing for a single note', () => {
    expect(identifyChord(shape('x3xxxx'))).toEqual([]);
  });
});

describe('identifyChord — other tunings', () => {
  it('drop D', () => {
    expect(top('000xxx', 'dropD')).toBe('D5');
    expect(top('555xxx', 'dropD')).toBe('G5');
    expect(top('000232', 'dropD')).toBe('D');
  });
  it('drop C', () => {
    expect(top('000xxx', 'dropC')).toBe('C5');
    expect(top('222xxx', 'dropC')).toBe('D5');
  });
  it('7-string: power chord on the low B', () => {
    expect(top('022xxxx', '7standard')).toBe('B5');
  });
  it('8-string: low F♯ power chord', () => {
    expect(top('022xxxxx', '8standard')).toBe('F♯5');
  });
  it('open tunings', () => {
    expect(top('000000', 'openG')).toBe('G/D'); // D is the lowest string
    expect(top('x00000', 'openG')).toBe('G');
    expect(top('000000', 'openE')).toBe('E');
    expect(top('000000', 'openD')).toBe('D');
  });
  it('baritone B: standard E-shape at fret 0 is a B major chord', () => {
    expect(top('022100', 'baritoneB')).toBe('B');
  });
  it('bass is the lowest *pitch*, not the lowest string', () => {
    // Low E string at fret 7 (B2) sits above the open A string (A2) → A is the bass.
    expect(identifyChord(shape('70xxxx'))).toEqual([]); // only two notes, B & A — no chord
    const res = identifyChord(shape('7022xx')); // B2 A2 E3 A3
    expect(res[0].name).toBe('Asus2');
  });
});

describe('nameOverRoot', () => {
  it('names the sound of an arpeggio over a root', () => {
    // E G B D over C → Cmaj9
    expect(nameOverRoot(0, [0, 4, 7, 11, 2])?.id).toBe('maj9');
    expect(nameOverRoot(0, [4, 7, 10, 2])?.id).toBe('9');
  });
});

describe('chordName spelling', () => {
  it('uses conventional enharmonic roots', () => {
    expect(top('x46654')).toBe('C♯m');
    expect(chordName({ rootPc: 1, type: chordType('maj') })).toBe('D♭');
    expect(chordName({ rootPc: 1, type: chordType('m') })).toBe('C♯m');
    expect(chordName({ rootPc: 8, type: chordType('maj') })).toBe('A♭');
    expect(chordName({ rootPc: 8, type: chordType('m') })).toBe('G♯m');
    expect(chordName({ rootPc: 3, type: chordType('maj') })).toBe('E♭');
    expect(chordName({ rootPc: 6, type: chordType('maj') })).toBe('F♯');
    expect(chordName({ rootPc: 10, type: chordType('m7') })).toBe('B♭m7');
  });
  it('spells chord tones by letter (dim7 has a double flat)', () => {
    const tones = spellChord({ rootPc: 0, type: chordType('dim7') }).tones.map((t) => formatNote(t.note));
    expect(tones).toEqual(['C', 'E♭', 'G♭', 'B♭♭']);
    const e7 = spellChord({ rootPc: 4, type: chordType('7#9') }).tones.map((t) => formatNote(t.note));
    expect(e7).toEqual(['E', 'G♯', 'B', 'D', 'F♯♯']);
  });
});
