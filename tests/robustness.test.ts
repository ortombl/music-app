import { describe, expect, it } from 'vitest';
import { exactArpeggios, suggestArpeggios, suggestScales } from '../src/theory/arpeggios';
import { CHORD_TYPES, chordName, chordPcs } from '../src/theory/chords';
import { identifyChord } from '../src/theory/identify';
import { detectKey, analyzeChord } from '../src/theory/key';
import { parseChordSymbol } from '../src/theory/parse';
import { TUNINGS } from '../src/theory/tunings';
import { generateVoicings } from '../src/theory/voicings';
import { arpeggioRun, rootPositions } from '../src/theory/fretboard';

describe('robustness sweep', () => {
  it('every chord type × root: name round-trips through the parser and the identifier', () => {
    for (const t of CHORD_TYPES) {
      if (t.parseOnly) continue;
      for (let root = 0; root < 12; root++) {
        const chord = { rootPc: root, type: t };
        const name = chordName(chord);
        const parsed = parseChordSymbol(name);
        expect(parsed, name).not.toBeNull();
        expect(parsed!.rootPc, name).toBe(root);
        expect(parsed!.type.id, name).toBe(t.id);
        // Voice the full chord in close position from the root and identify it.
        const midis = chordPcs(chord).map((pc) => 48 + ((pc - root + 12) % 12) + root);
        const found = identifyChord(midis, 'auto', 50).map((m) => m.name);
        expect(found, name).toContain(name);
      }
    }
  });

  it('arpeggio suggestions never crash and never contain duplicate notes', () => {
    for (const t of CHORD_TYPES) {
      for (const root of [0, 3, 6, 10]) {
        const chord = { rootPc: root, type: t };
        const ex = exactArpeggios(chord);
        expect(ex.length).toBeGreaterThan(0);
        for (const a of [...ex, ...suggestArpeggios(chord)]) {
          const pcs = a.notes.map((n) => n.pc);
          expect(new Set(pcs).size).toBe(pcs.length);
          expect(a.name.length).toBeGreaterThan(0);
        }
        suggestScales(chord);
      }
    }
  });

  it('voicings exist for common chords in every tuning', () => {
    for (const tuning of TUNINGS) {
      for (const sym of ['C', 'Am', 'G7', 'Fmaj7', 'Bm7b5', 'E5']) {
        const v = generateVoicings(parseChordSymbol(sym)!, tuning.strings, 22, { limit: 4 });
        expect(v.length, `${sym} in ${tuning.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('positions and runs work in every tuning', () => {
    for (const tuning of TUNINGS) {
      const pos = rootPositions(tuning.strings, 22, 9);
      expect(pos.length).toBeGreaterThan(0);
      for (const p of pos) {
        expect(p.end - p.start).toBe(4);
        const run = arpeggioRun(tuning.strings, 22, [9, 0, 4], 9, p);
        expect(run.length).toBeGreaterThan(0);
      }
      expect(arpeggioRun(tuning.strings, 22, [9, 0, 4], 9).length).toBeGreaterThan(4);
    }
  });

  it('key detection handles single chords and odd input', () => {
    const one = detectKey([parseChordSymbol('F#m')!]);
    expect(one[0].tonicPc).toBe(6);
    const weird = [parseChordSymbol('C')!, parseChordSymbol('F#')!, parseChordSymbol('Bb7alt')!];
    const k = detectKey(weird)[0];
    for (const c of weird) expect(analyzeChord(c, k).roman.length).toBeGreaterThan(0);
  });
});
