// Chord-symbol parser: "Am7", "C#m7b5", "Bbmaj7/D", "G7(#9)", "F6/9", "Eø", "D-7", "Cmaj7#11",
// and any chord written as a base chord plus modifiers: "Eb(add#11,no3)", "C7(b9,#11)",
// "Cmaj7(no3)", "G7sus4(b9)", "C9(b5)", "Dm(add b6)", "C(omit3)", "Fsus2(add#11)"...

import { CHORD_TYPES, chordName, chordType, type ChordSpec, type ChordType } from './chords';
import { nameFromSemis } from './custom';
import { degree } from './intervals';
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
  q = q.replace(/(^|[\d,])\+(5|9|11|13)/g, '$1#$2').replace(/([\d,])-(5|9|11|13)/g, '$1b$2');
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
  const alt = ({ aug5: 'aug', sus24: 'sus2' } as Record<string, string>)[q];
  if (alt) return ALIAS_MAP.get(alt) ?? null;
  return parseWithModifiers(q);
}

// Degree numbers that may follow "add", "no", an accidental, or stand alone after a base chord.
const ADDABLE = new Set([2, 3, 4, 5, 6, 7, 9, 11, 13]);
const slot = (num: number) => ((num - 1) % 7) + 1; // 9 → 2, 11 → 4, 13 → 6

/**
 * Apply modifier tokens ("add#11", "no3", "b9", "13", "sus4", separated optionally by commas) to a
 * base chord. Returns the resulting interval mask, or null if the text is not understood.
 */
function applyModifiers(base: ChordType, text: string, implicitBase: boolean): number | null {
  const tones = new Map<number, string>(); // semitone → degree label
  for (const d of base.degreeInfo) tones.set(d.semi, d.label);
  const add = (label: string) => {
    const d = degree(label);
    if (!tones.has(d.semi)) tones.set(d.semi, label);
  };
  const removeWhere = (pred: (label: string) => boolean) => {
    for (const [semi, l] of [...tones]) if (semi !== 0 && pred(l)) tones.delete(semi);
  };
  // Tokenise first; omissions refer to the base chord, so they are applied before additions.
  const ops: (() => boolean)[] = [];
  const omissions: (() => void)[] = [];
  let s = text;
  let tokens = 0;
  while (s.length) {
    if (s[0] === ',') {
      s = s.slice(1);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^add(bb|b|#)?(\d{1,2})/.exec(s))) {
      const label = (m[1] ?? '') + m[2];
      ops.push(() => ADDABLE.has(Number(m![2])) && (add(label), true));
    } else if ((m = /^(?:no|omit)(bb|b|#)?(\d{1,2})/.exec(s))) {
      const num = Number(m[2]);
      if (num === 1 || !ADDABLE.has(num)) return null;
      const exactLabel = m[1] ? m[1] + num : null;
      omissions.push(() => removeWhere((l) => (exactLabel ? l === exactLabel : slot(degree(l).num) === slot(num))));
    } else if ((m = /^sus(2|4)?/.exec(s))) {
      const two = m[1] === '2';
      ops.push(() => (removeWhere((l) => degree(l).num === 3), add(two ? '2' : '4'), true));
    } else if ((m = /^(bb|b|#)(\d{1,2})/.exec(s))) {
      const num = Number(m[2]);
      const label = m[1] + num;
      // an altered tone replaces the natural one (♭9 replaces 9, but not ♯9)
      ops.push(() => ADDABLE.has(num) && (removeWhere((l) => l === String(num)), add(label), true));
    } else if (!(implicitBase && tokens === 0) && (m = /^(\d{1,2})/.exec(s)) && [2, 4, 6, 9, 11, 13].includes(Number(m[1]))) {
      const label = m[1];
      ops.push(() => (add(label), true));
    } else {
      return null;
    }
    s = s.slice(m[0].length);
    tokens++;
  }
  for (const o of omissions) o();
  for (const op of ops) if (!op()) return null;
  if (!tokens) return null;
  let mask = 0;
  for (const semi of tones.keys()) mask |= 1 << semi;
  return mask | 1;
}

/** "base chord + modifiers": the longest known chord symbol at the start, then modifier tokens. */
function parseWithModifiers(q: string): ChordType | null {
  for (let len = q.length - 1; len >= 0; len--) {
    const base = len === 0 ? chordType('maj') : ALIAS_MAP.get(q.slice(0, len));
    if (!base || base.parseOnly) continue;
    const mask = applyModifiers(base, q.slice(len), len === 0);
    if (mask !== null) return nameFromSemis(mask, true).type;
  }
  return null;
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
  const slash = /\/([A-Ga-g](?:#|♯|b|♭|x|𝄪|𝄫){0,2})$/.exec(rest);
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

/** Split on spaces, bar lines, commas and semicolons — but not inside parentheses. */
export function tokenizeProgression(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s|,;]/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse a progression such as "Am7 | D7 | Gmaj7 Cmaj7 | %" ("%" repeats the previous chord). */
export function parseProgression(text: string): ProgressionParse {
  const tokens = tokenizeProgression(text);
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
