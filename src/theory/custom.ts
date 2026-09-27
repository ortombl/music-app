// Generic chord naming: *any* set of notes gets a name.
//
// A set of intervals above a root is described as the dictionary chord that needs the fewest
// changes, plus modifiers: added tones ("add♯11"), altered fifths ("♭5") and omissions ("no3").
// Examples: E♭ A B♭ → E♭(add♯11, no3); C E B♭ D♭ F♯ → C7♭9(♯11); C G B → Cmaj7(no3).
// The same machinery builds chord types for symbols typed by the user (see parse.ts).

import { CHORD_TYPES, type ChordFamily, type ChordType } from './chords';
import { degree, labelInChord, prettyDegree } from './intervals';
import { SCALES } from './scales';

export interface Modifier {
  kind: 'add' | 'alt' | 'no';
  label: string;
}

const accOf = (label: string) => (label.startsWith('bb') ? -2 : label.startsWith('b') ? -1 : label.startsWith('#') ? 1 : 0);
/** Sort key: 1, 2, ♭3, 3, 4, ♭5, 5, ♯5, 6, ♭7, 7, ♭9, 9, ♯9, 11, ♯11, ♭13, 13. */
const orderKey = (label: string) => degree(label).num * 10 + accOf(label);

const ORDINALS: Record<number, string> = { 1: 'root', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 9: '9th', 11: '11th', 13: '13th' };

function isSeventhLike(t: ChordType): boolean {
  return t.degrees.some((d) => d === '7' || d === 'b7' || d === 'bb7' || d === '6');
}

function maskOf(labels: string[]): number {
  let m = 0;
  for (const l of labels) m |= 1 << degree(l).semi;
  return m;
}

/** Text after the root, e.g. "(add♯11, no3)", "7(♭9, ♯11)", "maj7(no3)", "(♭5, no3)". */
export function formatSymbol(base: ChordType, mods: Modifier[]): string {
  if (!mods.length) return base.symbol;
  const seventh = isSeventhLike(base);
  const changes = mods.filter((m) => m.kind !== 'no').sort((a, b) => orderKey(a.label) - orderKey(b.label));
  const omits = mods.filter((m) => m.kind === 'no').sort((a, b) => orderKey(a.label) - orderKey(b.label));
  // On 7th chords tensions are written plainly ("C7(♭9, ♯11)"); "add" is kept when the chord
  // already has another version of that degree ("Cm9(add♭9)"), because a plain "♭9" would mean
  // "replace the 9".
  const present = [...base.degrees, ...changes.map((c) => c.label)];
  const sameNum = (label: string) => label !== String(degree(label).num) && present.includes(String(degree(label).num));
  const parts = [
    ...changes.map((m) => {
      const plain = m.kind === 'alt' || (seventh && degree(m.label).num >= 9 && !sameNum(m.label));
      return (plain ? '' : 'add') + prettyDegree(m.label);
    }),
    // "no7" normally; "no♭7" when another 7th is being added, so the name stays unambiguous.
    ...omits.map((m) => `no${changes.some((c) => degree(c.label).num === degree(m.label).num) ? prettyDegree(m.label) : degree(m.label).num}`),
  ];
  // "(♭5)" + mods → "(♭5, no3)"; "m(maj7)" + mods → "m(maj7, 11)"
  if (base.symbol.endsWith(')')) return `${base.symbol.slice(0, -1)}, ${parts.join(', ')})`;
  return `${base.symbol}(${parts.join(', ')})`;
}

function deriveFamily(labels: string[]): ChordFamily {
  const has = (l: string) => labels.includes(l);
  if (has('3')) {
    if (has('b7')) return 'dominant';
    if (has('#5') && !has('5')) return 'augmented';
    return 'major';
  }
  if (has('b3')) {
    if (has('b5') && !has('5')) return has('b7') ? 'half-diminished' : 'diminished';
    return 'minor';
  }
  if (has('4') || has('2')) return 'suspended';
  return 'power';
}

// Rough order of how commonly a scale is used — the chord-scales of a custom chord are all
// scales that contain it, most common first.
const SCALE_PREFERENCE = [
  'ionian', 'aeolian', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'majorPentatonic', 'minorPentatonic', 'blues',
  'harmonicMinor', 'melodicMinor', 'lydianDominant', 'phrygianDominant', 'mixolydianB6', 'locrian', 'locrianNat2',
  'altered', 'dimHW', 'dimWH', 'wholeTone', 'lydianAugmented',
];

function deriveScales(labels: string[]): string[] {
  const semis = labels.map((l) => degree(l).semi);
  const rank = (id: string) => {
    const i = SCALE_PREFERENCE.indexOf(id);
    return i < 0 ? 100 : i;
  };
  return SCALES.filter((s) => semis.every((x) => s.semis.includes(x)))
    .map((s) => s.id)
    .sort((a, b) => rank(a) - rank(b));
}

const exactDictionary = (mask: number): ChordType | undefined =>
  CHORD_TYPES.filter((t) => !t.parseOnly && t.mask === mask).sort((a, b) => b.prior - a.prior)[0];

/**
 * Build a chord type from a dictionary base plus modifiers. If the result has exactly the notes of
 * a dictionary chord, that chord is returned instead (e.g. C(add9, no3) → Csus2).
 */
export function makeCustomType(base: ChordType, mods: Modifier[]): ChordType {
  const omits = mods.filter((m) => m.kind === 'no').map((m) => m.label);
  const alts = mods.filter((m) => m.kind === 'alt').map((m) => m.label);
  const adds = mods.filter((m) => m.kind === 'add').map((m) => m.label);
  const labels: string[] = [];
  const seen = new Set<number>();
  const push = (l: string) => {
    const s = degree(l).semi;
    if (seen.has(s)) return;
    seen.add(s);
    labels.push(l);
  };
  for (const d of base.degrees) if (!omits.includes(d) && !(alts.length && d === '5')) push(d);
  for (const l of [...alts, ...adds]) push(l);
  labels.sort((a, b) => orderKey(a) - orderKey(b));
  const mask = maskOf(labels);
  const canonical = exactDictionary(mask);
  if (canonical) return canonical;
  if (!mods.length) return base;

  const optional = base.optional.filter((o) => labels.includes(o));
  const addText = [...alts, ...adds].map(prettyDegree);
  const omitText = omits.map((o) => `no ${ORDINALS[degree(o).num] ?? o}`);
  const degreeInfo = labels.map(degree);
  return {
    id: `custom:${base.id}|${mods.map((m) => `${m.kind}${m.label}`).join(',')}`,
    symbol: formatSymbol(base, mods),
    name: [base.name + (addText.length ? ` with ${addText.join(', ')}` : ''), ...omitText].join(', '),
    degrees: labels,
    optional,
    prior: 0.2,
    family: deriveFamily(labels),
    aliases: [],
    scales: deriveScales(labels),
    degreeInfo,
    mask,
    requiredMask: maskOf(labels.filter((l) => !optional.includes(l))),
  };
}

export interface GenericName {
  type: ChordType;
  /** Optional tones of the base chord that are simply not played (not written in the name). */
  omittedSilent: string[];
  cost: number;
}

/**
 * Name a set of intervals (bit mask of semitones above the root; the root is always included).
 *
 * exact = true  — the name must describe exactly these notes (used for typed chord symbols,
 *                 so "C7(no5)" stays "C7(no5)").
 * exact = false — optional tones such as the 5th may be missing silently (used for chords
 *                 played on the fretboard, like the dictionary matcher does).
 */
export function nameFromSemis(mask: number, exact: boolean): GenericName {
  const m = mask | 1;
  const exactType = exactDictionary(m);
  if (exactType) return { type: exactType, omittedSilent: [], cost: 1.5 * (1 - exactType.prior) };

  let best: { base: ChordType; mods: Modifier[]; silent: string[]; cost: number } | null = null;
  for (const base of CHORD_TYPES) {
    if (base.parseOnly) continue;
    let addSemis: number[] = [];
    for (let s = 1; s < 12; s++) if (m & (1 << s) && !(base.mask & (1 << s))) addSemis.push(s);
    let absent = base.degreeInfo.filter((d) => d.semi !== 0 && !(m & (1 << d.semi))).map((d) => d.label);
    const mods: Modifier[] = [];
    // A missing perfect 5th plus a ♭5/♯5 reads as an altered fifth, not "add♯11, no5".
    if (absent.includes('5')) {
      const alt = addSemis.includes(6) ? 6 : addSemis.includes(8) && !base.degrees.includes('b13') ? 8 : null;
      if (alt !== null) {
        mods.push({ kind: 'alt', label: alt === 6 ? 'b5' : '#5' });
        addSemis = addSemis.filter((s) => s !== alt);
        absent = absent.filter((l) => l !== '5');
      }
    }
    const named = exact ? absent : absent.filter((l) => !base.optional.includes(l));
    const silent = exact ? [] : absent.filter((l) => base.optional.includes(l));
    for (const s of addSemis) mods.push({ kind: 'add', label: labelInChord(s, base.degrees) });
    for (const l of named) mods.push({ kind: 'no', label: l });
    const alts = mods.filter((x) => x.kind === 'alt').length;
    let cost =
      addSemis.length * 1.0 +
      alts * 0.9 +
      named.length * 1.3 +
      silent.length * 0.15 +
      Math.max(0, addSemis.length - 2) * 0.5 +
      1.5 * (1 - base.prior);
    // "C5(add♯11)" is valid but "C(add♯11, no3)" is the more familiar way to write it.
    if (base.id === '5' && mods.length) cost += 1.1;
    // Without its 3rd a chord is neither major nor minor: prefer "C(♭5, no3)" to "Cdim(no3)".
    if (named.includes('b3')) cost += 0.6;
    if (!best || cost < best.cost - 1e-9) best = { base, mods, silent, cost };
  }
  const b = best!;
  return { type: makeCustomType(b.base, b.mods), omittedSilent: b.silent, cost: b.cost };
}
