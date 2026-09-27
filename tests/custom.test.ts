import { describe, expect, it } from 'vitest';
import { chordPcs } from '../src/theory/chords';
import { identifyChord } from '../src/theory/identify';
import { parseChordSymbol, parseProgression, tokenizeProgression } from '../src/theory/parse';
import { generateVoicings } from '../src/theory/voicings';
import { exactArpeggios, suggestArpeggios, suggestScales } from '../src/theory/arpeggios';
import { findTuning } from '../src/theory/tunings';

const pcsOf = (c: Parameters<typeof chordPcs>[0]) => [...new Set(chordPcs(c))].sort((a, b) => a - b).join(',');

describe('chord symbols with add / no / alterations', () => {
  it.each([
    ['Eb(add#11,no3)', 'E♭(add♯11, no3)', '1 5 #11'],
    ['Eb(add#11, no3)', 'E♭(add♯11, no3)', '1 5 #11'],
    ['E♭(add♯11, no3)', 'E♭(add♯11, no3)', '1 5 #11'],
    ['Cadd#11', 'C(add♯11)', '1 3 5 #11'],
    ['C7(no5)', 'C7(no5)', '1 3 b7'],
    ['C(no5)', 'C(no5)', '1 3'],
    ['Cmaj7(no3)', 'Cmaj7(no3)', '1 5 7'],
    ['C9(b5)', 'C9(♭5)', '1 3 b5 b7 9'],
    ['G7sus4(b9)', 'G7sus4(♭9)', '1 4 5 b7 b9'],
    ['Dm(add b6)', 'Dm(add♭13)', '1 b3 5 b13'],
    ['Fsus2(add#11)', 'Fsus2(add♯11)', '1 2 5 #11'],
    ['Cm7(b9)', 'Cm7(♭9)', '1 b3 5 b7 b9'],
    ['Cm(maj7,add11)', 'Cm(maj7, 11)', '1 b3 5 7 11'],
    ['Csus4(add9)', 'Csus4(add9)', '1 4 5 9'],
    ['Cmaj13(#11)', 'Cmaj13(♯11)', '1 3 5 7 9 #11 13'],
  ])('%s → %s', (input, display, degrees) => {
    const c = parseChordSymbol(input)!;
    expect(c).not.toBeNull();
    expect(c.display).toBe(display);
    expect(c.type.degrees.join(' ')).toBe(degrees);
  });

  it('canonicalises to dictionary chords when the notes match exactly', () => {
    expect(parseChordSymbol('C(no3)')!.display).toBe('C5');
    expect(parseChordSymbol('C(omit3)')!.display).toBe('C5');
    expect(parseChordSymbol('C(add9,no3)')!.display).toBe('Csus2');
    expect(parseChordSymbol('C6(add9)')!.display).toBe('C6/9');
    expect(parseChordSymbol('C7(9,13)')!.display).toBe('C13');
    expect(parseChordSymbol('C7(-9)')!.display).toBe('C7♭9');
  });

  it('keeps slash basses with modifier chords', () => {
    const c = parseChordSymbol('Eb(add#11,no3)/A')!;
    expect(c.display).toBe('E♭(add♯11, no3)/A');
    expect(c.bassPc).toBe(9);
  });

  it('progression tokenizer does not split inside parentheses', () => {
    expect(tokenizeProgression('Eb(add#11, no3) | Am7, C7(b9, #11) Dm')).toEqual(['Eb(add#11, no3)', 'Am7', 'C7(b9, #11)', 'Dm']);
    const r = parseProgression('Eb(add#11,no3) Am7 C7(b9,#11)');
    expect(r.errors).toEqual([]);
    expect(r.chords.map((c) => c.display)).toEqual(['E♭(add♯11, no3)', 'Am7', 'C7♭9(♯11)']);
  });
});

describe('every combination of notes gets a name', () => {
  it('identifies E♭ A B♭ (E♭ bass) as E♭(add♯11, no3)', () => {
    expect(identifyChord([51, 57, 58])[0].name).toBe('E♭(add♯11, no3)');
  });

  it('prefers a root-position generic name to an awkward slash chord', () => {
    expect(identifyChord([48, 52, 55, 54])[0].name).toBe('C(add♯11)'); // C E G F♯
    expect(identifyChord([48, 55, 59])[0].name).toBe('Cmaj7(no3)'); // C G B
  });

  it('all 4083 sets of 2–12 pitch classes, with several bass notes: named, and the name round-trips', () => {
    let checked = 0;
    for (let mask = 1; mask < 4096; mask++) {
      const pcs = [...Array(12).keys()].filter((p) => mask & (1 << p));
      if (pcs.length < 2) continue;
      // try up to three different bass notes per set
      for (const bass of pcs.slice(0, 3)) {
        const midis = pcs.map((p) => 48 + ((p - bass + 12) % 12) + bass);
        const res = identifyChord(midis);
        expect(res.length, `notes ${pcs.join(',')} bass ${bass}`).toBeGreaterThan(0);
        const top = res[0];
        const parsed = parseChordSymbol(top.name);
        expect(parsed, `"${top.name}" should parse`).not.toBeNull();
        expect(pcsOf(parsed!), `"${top.name}" round-trips`).toBe(pcsOf(top.chord));
        expect(parsed!.bassPc ?? parsed!.rootPc).toBe(bass);
        // every sounding note is part of the named chord
        const named = new Set(chordPcs(top.chord));
        for (const p of pcs) expect(named.has(p), `${top.name} contains ${p}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('custom chords work with voicings and arpeggios', () => {
    const c = parseChordSymbol('Eb(add#11,no3)')!;
    const v = generateVoicings(c, findTuning('standard')!.strings, 15, { limit: 5 });
    expect(v.length).toBeGreaterThan(0);
    for (const x of v) expect(identifyChord(x.midis, 'auto', 20).map((m) => m.name)).toContain('E♭(add♯11, no3)');
    expect(exactArpeggios(c)[0].notes.map((n) => n.name)).toEqual(['E♭', 'B♭', 'A']);
    suggestArpeggios(c); // must not throw
  });

  it('scales over a custom chord use the chord root spelling and avoid double flats', () => {
    const scales = suggestScales(parseChordSymbol('Eb(add#11,no3)')!);
    const blues = scales.find((x) => x.scaleId === 'blues')!;
    expect(blues.label).toBe('E♭ Blues');
    expect(blues.notes).toBe('E♭ G♭ A♭ A B♭ D♭');
    expect(scales[0].label).toBe('E♭ Lydian');
  });
});
