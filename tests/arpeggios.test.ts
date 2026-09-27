import { describe, expect, it } from 'vitest';
import { exactArpeggios, suggestArpeggios, suggestScales } from '../src/theory/arpeggios';
import { chordType } from '../src/theory/chords';

const names = (root: number, type: string, ctx?: { rootPc: number; scaleId: string }) =>
  suggestArpeggios({ rootPc: root, type: chordType(type) }, { context: ctx }).map((a) => a.name);

describe('exact arpeggios', () => {
  it('lists the chord and its simpler cores', () => {
    const ex = exactArpeggios({ rootPc: 0, type: chordType('9') });
    expect(ex.map((a) => a.name)).toEqual(['C9', 'C7', 'C']);
    expect(ex[0].notes.map((n) => n.name)).toEqual(['C', 'E', 'G', 'B♭', 'D']);
    expect(ex[0].notes.map((n) => n.label)).toEqual(['1', '3', '5', 'b7', '9']);
  });
  it('includes a slash-chord bass', () => {
    const ex = exactArpeggios({ rootPc: 2, type: chordType('maj'), bassPc: 0 });
    expect(ex[0].notes.map((n) => n.name)).toContain('C');
  });
});

describe('substitute arpeggios', () => {
  it('classic choices', () => {
    expect(names(0, 'maj7')[0]).toBe('Em7'); // Cmaj9 sound
    expect(names(0, '7')[0]).toBe('Em7♭5'); // C9 sound
    expect(names(9, 'm7')[0]).toBe('Cmaj7'); // Am9 sound
    expect(names(11, 'm7b5')).toContain('Dm'); // from the ♭3
    expect(names(9, 'm7')).toContain('Em7'); // Am11 sound
  });
  it('describe the resulting sound', () => {
    const s = suggestArpeggios({ rootPc: 0, type: chordType('maj7') })[0];
    expect(s.sound).toBe('Cmaj9');
    expect(s.adds).toEqual(['9']);
    expect(s.description).toMatch(/3rd/);
  });
  it('never suggests the chord itself or a note-for-note duplicate', () => {
    const subs = suggestArpeggios({ rootPc: 9, type: chordType('m7') });
    expect(subs.map((s) => s.name)).not.toContain('Am7');
    expect(subs.map((s) => s.name)).not.toContain('C6');
  });
  it('uses key context (harmonic minor V7 → 7♭9 colours)', () => {
    const subs = suggestArpeggios({ rootPc: 4, type: chordType('7') }, { context: { rootPc: 9, scaleId: 'harmonicMinor' } });
    expect(subs[0].scaleLabel).toBe('E Phrygian dominant');
    expect(subs.some((s) => s.adds.includes('b9'))).toBe(true);
  });
  it('dim7 chords are explained as rootless 7♭9 chords', () => {
    const subs = suggestArpeggios({ rootPc: 1, type: chordType('dim7') });
    expect(subs.some((s) => /rootless/.test(s.description))).toBe(true);
  });
  it('spells notes in the arpeggio’s own key', () => {
    const subs = suggestArpeggios({ rootPc: 11, type: chordType('maj') });
    const dSharp = subs.find((s) => s.chord.rootPc === 3)!;
    expect(dSharp.name.startsWith('D♯')).toBe(true);
    expect(dSharp.notes.map((n) => n.name)).toContain('A♯');
  });
});

describe('suggestScales', () => {
  it('chord-scales', () => {
    expect(suggestScales({ rootPc: 2, type: chordType('m7') }).map((s) => s.label)[0]).toBe('D Dorian');
    expect(suggestScales({ rootPc: 7, type: chordType('7') }).map((s) => s.label)[0]).toBe('G Mixolydian');
    expect(suggestScales({ rootPc: 5, type: chordType('maj7#11') }).map((s) => s.label)[0]).toBe('F Lydian');
    expect(suggestScales({ rootPc: 10, type: chordType('maj7') })[0].notes).toBe('B♭ C D E♭ F G A');
  });
});
