// Chord-symbol parser: "Am7", "C#m7b5", "Bbmaj7/D", "G7(#9)", "F6/9", "Eø", "D-7", "Cmaj7#11"...

import { CHORD_TYPES, chordName, type ChordSpec, type ChordType } from './chords';
import { formatNote, parseNoteName, pcOf } from './notes';

const ALIAS_MAP = new Map<string, ChordType>();
for (const t of CHORD_TYPES) {
  for (const a of t.aliases) {
    const key = a === 'M' ? 'maj' : a.toLowerCase();
    if (!ALIAS_MAP.has(key)) ALIAS_MAP.set(key, t);
  }
}

/** Normalise a chord-quality suffix to the lowercase ASCII alias form. */
export function normaliseQuality(raw: string): string {
  let q = raw.trim();
  q = q
    .replace(/[♯]/g, '#')
    .replace(/[♭]/g, 'b')
    .replace(/[−–]/g, '-')
    .replace(/[Δ△∆](?=\d)/g, 'maj')
    .replace(/[Δ△∆]/g, 'maj7') // a bare triangle means maj7
    .replace(/ø7?/g, 'm7b5')
    .replace(/[°º]/g, 'dim')
    .replace(/[\s()]/g, '');
  // Capital-M major: "M7", "M9", "mM7", "Maj7", "MA7", "Ma7"
  q = q.replace(/maj|Maj|MAJ|MA|Ma/g, 'maj');
  q = q.replace(/^mM/, 'mmaj');
  q = q.replace(/^M(?=\d|$|#|b|add)/, 'maj');
  q = q.toLowerCase();
  q = q.replace(/^min(?!or)/, 'm').replace(/^mi(?!n)/, 'm').replace(/^minor/, 'm').replace(/^major/, 'maj');
  q = q.replace(/^-/, 'm');
  // "+5" / "-5" / "+9" / "-9" / "+11" / "-13" → sharps & flats
  q = q.replace(/(\d|^)\+(5|9|11|13)/g, '$1#$2').replace(/(\d)-(5|9|11|13)/g, '$1b$2');
  q = q.replace(/^\+(?=\d|$)/, 'aug');
  q = q.replace(/^o7$/, 'dim7').replace(/^o$/, 'dim');
  q = q.replace(/maj7add9|maj7\/9/, 'maj9');
  q = q.replace(/^7\/9$/, '9');
  return q;
}

export function lookupQuality(raw: string): ChordType | null {
  const q = normaliseQuality(raw);
  const direct = ALIAS_MAP.get(q);
  if (direct) return direct;
  // A few extra spellings
  const extras: Record<string, string> = {
    aug5: 'aug', add9no3: 'sus2', sus24: 'sus2',
  };
  const alt = extras[q];
  return alt ? ALIAS_MAP.get(alt) ?? null : null;
}

export interface ParsedChord extends ChordSpec {
  input: string;
  display: string;
}

export function parseChordSymbol(input: string): ParsedChord | null {
  const s = input.trim();
  if (!s) return null;
  const r = parseNoteName(s);
  if (!r) return null;
  let rest = r.rest;
  let bass: ReturnType<typeof parseNoteName> = null;
  const slash = /\/([A-Ga-g](?:#|♯|b|♭)?)$/.exec(rest);
  if (slash) {
    bass = parseNoteName(slash[1]);
    rest = rest.slice(0, slash.index);
  }
  const type = lookupQuality(rest);
  if (!type) return null;
  const rootPc = pcOf(r.note);
  const bassPc = bass ? pcOf(bass.note) : undefined;
  const chord: ChordSpec = {
    rootPc,
    type,
    rootSpelling: r.note,
    bassPc: bassPc !== undefined && bassPc !== rootPc ? bassPc : undefined,
    bassSpelling: bass && bassPc !== rootPc ? bass.note : undefined,
  };
  return { ...chord, input: s, display: chordName(chord) };
}

export interface ProgressionParse {
  chords: ParsedChord[];
  errors: string[];
}

/** Parse a progression such as "Am7 | D7 | Gmaj7 Cmaj7 | %" ("%" repeats the previous chord). */
export function parseProgression(text: string): ProgressionParse {
  const tokens = text
    .split(/[\s|,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const chords: ParsedChord[] = [];
  const errors: string[] = [];
  for (const tok of tokens) {
    if (tok === '%' || tok === '-' || tok === '/') {
      if (chords.length) chords.push({ ...chords[chords.length - 1] });
      continue;
    }
    const c = parseChordSymbol(tok);
    if (c) chords.push(c);
    else errors.push(tok);
  }
  return { chords, errors };
}

export function rootText(c: ParsedChord): string {
  return formatNote(c.rootSpelling!);
}
