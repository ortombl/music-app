// Reading an arpeggio the user types: a chord symbol ("Bbmaj7", "F#m7b5", "E(add#11,no3)") or a
// list of notes ("E G B D", "Bb-D-F-A") that is recognised with the chord identifier.

import { chordName, type ChordSpec } from './chords';
import { identifyChord } from './identify';
import { parseNoteName, pcOf, type AccidentalPref } from './notes';
import { parseChordSymbol } from './parse';

export interface ArpInput {
  chord: ChordSpec;
  name: string;
  /** Set when the input was a list of notes: the notes as typed. */
  recognisedFrom?: string;
}

const NOTE_TOKEN = /^[A-Ga-g](#|♯|b|♭){0,2}$/;

export function parseArpeggioInput(text: string, pref: AccidentalPref = 'auto'): ArpInput | { error: string } {
  const t = text.trim();
  if (!t) return { error: 'Type a chord symbol (e.g. Bbmaj7, F#m7b5) or notes (e.g. E G B D).' };
  const tokens = t.split(/[\s,\-–]+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((x) => NOTE_TOKEN.test(x))) {
    const notes = tokens.map((x) => parseNoteName(x)!.note);
    // Stack the notes upwards from the first one, which is taken as the intended root.
    const midis: number[] = [];
    for (const n of notes) {
      const pc = pcOf(n);
      let m = midis.length ? midis[midis.length - 1] + 1 : 48 + pc;
      while (((m % 12) + 12) % 12 !== pc) m++;
      midis.push(m);
    }
    const matches = identifyChord(midis, pref, 30);
    if (!matches.length) return { error: 'Type at least two different notes.' };
    const rootPc = pcOf(notes[0]);
    const pick = matches.find((m) => m.chord.rootPc === rootPc) ?? matches[0];
    const chord: ChordSpec = {
      rootPc: pick.chord.rootPc,
      type: pick.chord.type,
      rootSpelling: pick.chord.rootPc === rootPc ? notes[0] : undefined,
    };
    return { chord, name: chordName(chord, pref), recognisedFrom: tokens.join(' ') };
  }
  const c = parseChordSymbol(t);
  if (c) return { chord: { rootPc: c.rootPc, type: c.type, rootSpelling: c.rootSpelling, bassPc: c.bassPc, bassSpelling: c.bassSpelling }, name: c.display };
  return { error: `Couldn't read "${t}". Type a chord symbol (Bbmaj7, F#m7b5, C(add#11)) or notes (E G B D).` };
}
