import { describe, expect, it } from 'vitest';
import { chordName } from '../src/theory/chords';
import { analyzeChord, detectKey, tonicChord } from '../src/theory/key';
import { parseProgression } from '../src/theory/parse';

function analyse(text: string) {
  const { chords } = parseProgression(text);
  const keys = detectKey(chords);
  const key = keys[0];
  return {
    key,
    keys,
    romans: chords.map((c, i) => analyzeChord(c, key, chords[i + 1]).roman),
    analyses: chords.map((c, i) => analyzeChord(c, key, chords[i + 1])),
    chords,
  };
}

describe('detectKey', () => {
  it.each([
    ['C G Am F', 'C major'],
    ['Dm7 G7 Cmaj7', 'C major'],
    ['Gmaj7 Cmaj7 Am7 D7', 'G major'],
    ['E A B E', 'E major'],
    ['C A7 Dm G7 C', 'C major'],
    ['Am Dm E7 Am', 'A minor'],
    ['Bm7b5 E7 Am', 'A minor'],
    ['Am G F E', 'A minor'],
    ['Cm Ab Bb Cm', 'C minor'],
    ['Am F C G', 'A minor'],
    ['Am D Am D', 'A Dorian'],
    ['Dm7 G7 Dm7 G7', 'D Dorian'],
    ['G F C G', 'G Mixolydian'],
    ['A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7', 'A Mixolydian'],
    ['Bb Eb F Bb', 'B♭ major'],
    ['F#m D A E', 'F♯ minor'],
    ['Db Ab Bbm Gb', 'D♭ major'],
    ['E F E F', 'E Phrygian dominant'],
    ['Am G F E', 'A minor'],
  ])('%s → %s', (prog, expected) => {
    expect(analyse(prog).key.name).toBe(expected);
  });

  it('probabilities are normalised and sorted', () => {
    const { keys } = analyse('C G Am F');
    const total = keys.reduce((s, k) => s + k.probability, 0);
    expect(total).toBeCloseTo(1, 5);
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1].score).toBeGreaterThanOrEqual(keys[i].score);
  });

  it('gives reasons', () => {
    const { key } = analyse('Dm7 G7 Cmaj7');
    expect(key.reasons.join(' ')).toMatch(/V → I/);
  });
});

describe('Roman numeral analysis', () => {
  it('diatonic major', () => {
    expect(analyse('Cmaj7 Am7 Dm7 G7').romans).toEqual(['Imaj7', 'vi7', 'ii7', 'V7']);
  });
  it('minor key with harmonic-minor V and half-diminished ii', () => {
    expect(analyse('Bm7b5 E7 Am').romans).toEqual(['iiø7', 'V7', 'i']);
  });
  it('secondary dominants', () => {
    const r = analyse('C A7 Dm G7 C');
    expect(r.romans[1]).toBe('V7/ii');
    expect(r.analyses[1].func).toBe('D');
    expect(analyse('C E7 Am F G C').romans[1]).toBe('V7/vi');
  });
  it('borrowed chords', () => {
    const r = analyse('C Ab Bb C');
    expect(r.romans).toEqual(['I', '♭VI', '♭VII', 'I']);
    expect(r.analyses[1].note).toMatch(/Borrowed/);
  });
  it('inversions use figured bass', () => {
    expect(analyse('C G/B Am C/G F C').romans[1]).toBe('V⁶');
    expect(analyse('C G/B Am C/G F C').romans[3]).toBe('I⁶₄');
  });
  it('blues chords are I7 IV7 V7', () => {
    const r = analyse('A7 D7 A7 E7 D7 A7');
    expect(r.romans).toEqual(['I7', 'IV7', 'I7', 'V7', 'IV7', 'I7']);
  });
  it('tonic chord prefers the version in the progression', () => {
    const r = analyse('Dm7 G7 Cmaj7');
    expect(chordName(tonicChord(r.key, r.chords))).toBe('Cmaj7');
  });
  it('chord-scales follow the key', () => {
    const r = analyse('Dm7 G7 Cmaj7');
    expect(r.analyses.map((a) => a.scale.scaleId)).toEqual(['dorian', 'mixolydian', 'ionian']);
    const m = analyse('Am Dm E7 Am');
    expect(m.analyses[2].scale.scaleId).toBe('phrygianDominant');
  });
});
