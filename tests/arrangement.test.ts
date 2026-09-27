import { describe, expect, it } from 'vitest';
import { analyzeArpeggio, suggestArpeggios } from '../src/theory/arpeggios';
import { parseArpeggioInput } from '../src/theory/arpInput';
import { DEFAULT_SLOT, exportArrangementText, parseArrangementText, type ArrangementDoc } from '../src/theory/arrangement';
import { chordType } from '../src/theory/chords';
import { parseChordSymbol } from '../src/theory/parse';

describe('parseArpeggioInput', () => {
  it('reads chord symbols', () => {
    const r = parseArpeggioInput('F#m7b5');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.name).toBe('F♯m7♭5');
  });
  it('recognises a list of notes, taking the first as the root', () => {
    const r = parseArpeggioInput('E G B D');
    if ('error' in r) throw new Error(r.error);
    expect(r.name).toBe('Em7');
    expect(r.recognisedFrom).toBe('E G B D');
    const r2 = parseArpeggioInput('C-E-G-A');
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.name).toBe('C6');
    const r3 = parseArpeggioInput('Eb A Bb');
    if ('error' in r3) throw new Error(r3.error);
    expect(r3.name).toBe('E♭(add♯11, no3)');
  });
  it('explains what went wrong', () => {
    const r = parseArpeggioInput('hello');
    expect('error' in r && r.error).toMatch(/Couldn't read/);
  });
});

describe('analyzeArpeggio', () => {
  const c7 = { rootPc: 0, type: chordType('7') };
  it('rates a typed arpeggio exactly like the same suggestion', () => {
    const sub = suggestArpeggios(c7, { limit: 20 }).find((s) => s.name === 'Em7♭5')!;
    const own = analyzeArpeggio(c7, parseChordSymbol('Em7b5')!);
    expect(own.fit).toBeCloseTo(sub.fit, 5);
    expect(own.sound).toBe('C9');
  });
  it('flags avoid notes and notes outside the chord-scale', () => {
    const fm = analyzeArpeggio(c7, parseChordSymbol('Fmaj7')!); // F = 11 over C7 (avoid), A, C, E
    expect(fm.warning).toMatch(/avoid/);
    const outside = analyzeArpeggio({ rootPc: 0, type: chordType('maj7') }, parseChordSymbol('Dbmaj7')!);
    expect(outside.warning).toMatch(/outside the chord-scale/);
    expect(outside.fit).toBeLessThan(0.6);
    expect(outside.description).toMatch(/clash/);
    expect(outside.description).not.toMatch(/Only chord tones/);
  });
  it('handles an arpeggio with the same notes as the chord', () => {
    const a = analyzeArpeggio({ rootPc: 9, type: chordType('m7') }, parseChordSymbol('C6')!);
    expect(a.description).toMatch(/Same notes/);
  });
});

describe('arrangement export / import', () => {
  const doc: ArrangementDoc = {
    chords: ['Dm7', 'G7', 'E♭(add♯11, no3)'],
    slots: [
      { arp: 'Fmaj7', pos: 'global', beats: 4 },
      { arp: 'B D F A', pos: { start: 7, end: 11 }, beats: 2 },
      { arp: null, pos: 'neck', beats: 8 },
    ],
    tempo: 104,
    position: { start: 5, end: 9 },
    tuning: [38, 45, 50, 55, 59, 64],
  };
  const text = exportArrangementText(doc, {
    key: 'C major',
    tuning: 'Drop D (D A D G B E)',
    tempo: 104,
    position: 'frets 5–9',
    date: '2026-09-27 12:00',
    rows: [
      { chord: 'Dm7', roman: 'ii7', arpeggio: 'Fmaj7', notes: 'F A C E', fit: '88%', sound: 'Dm9', position: 'same as all', length: '1 bar' },
      { chord: 'G7', roman: 'V7', arpeggio: 'Bm7♭5', notes: 'B D F A', fit: '85%', sound: 'G9', position: 'frets 7–11', length: '1/2 bar' },
      { chord: 'E♭(add♯11, no3)', roman: '♭III', arpeggio: 'chord', notes: 'E♭ B♭ A', fit: '—', sound: '', position: 'whole neck', length: '2 bars' },
    ],
  });

  it('writes a readable table and a [data] section', () => {
    expect(text).toMatch(/Key: C major/);
    expect(text).toMatch(/1\s+Dm7\s+ii7\s+Fmaj7/);
    expect(text).toContain('[data]');
    expect(text).toContain('chord: Dm7 | arpeggio: Fmaj7 | position: all | length: 4');
    expect(text).toContain('chord: Eb(add#11, no3) | arpeggio: - | position: neck | length: 8');
    expect(text).toContain('tuning: D2 A2 D3 G3 B3 E4');
  });

  it('round-trips through import', () => {
    const { doc: back, errors } = parseArrangementText(text);
    expect(errors).toEqual([]);
    expect(back.chords).toEqual(['Dm7', 'G7', 'Eb(add#11, no3)']);
    expect(back.slots).toEqual(doc.slots);
    expect(back.tempo).toBe(104);
    expect(back.position).toEqual({ start: 5, end: 9 });
    expect(back.tuning).toEqual(doc.tuning);
    for (const c of back.chords) expect(parseChordSymbol(c)).not.toBeNull();
  });

  it('reads hand-written files', () => {
    const r = parseArrangementText('# my solo\nDm7 -> Fmaj7\nG7 → Bm7b5\nCmaj7 -> -\ntempo: 80\n');
    expect(r.doc.chords).toEqual(['Dm7', 'G7', 'Cmaj7']);
    expect(r.doc.slots.map((s) => s.arp)).toEqual(['Fmaj7', 'Bm7b5', null]);
    expect(r.doc.tempo).toBe(80);
    const plain = parseArrangementText('Am7 | D7 | Gmaj7 Eb(add#11, no3)');
    expect(plain.doc.chords).toEqual(['Am7', 'D7', 'Gmaj7', 'Eb(add#11, no3)']);
    expect(plain.doc.slots[0]).toEqual(DEFAULT_SLOT);
  });

  it('reports bad values', () => {
    const r = parseArrangementText('[data]\nchord: Dm7 | position: up there | length: lots\ntempo: 9000');
    expect(r.errors.length).toBe(3);
    expect(r.doc.chords).toEqual(['Dm7']);
  });
});
