// Arpeggios for a chord: the chord's own arpeggio (plus simpler reductions), and "substitute"
// arpeggios that sound good over it — the classic technique of playing a different arpeggio
// (usually built on the 3rd, 5th or 7th of the chord) to bring out extensions such as the 9th,
// 11th or 13th. Substitutes are generated from the chord-scale (or the key when there is one),
// scored by how many chord tones / guide tones / colour tones they contain and filtered for
// avoid notes.

import { chordName, chordPcs, chordType, spellChord, type ChordSpec, type ChordType } from './chords';
import { nameOverRoot } from './identify';
import { nameFromSemis } from './custom';
import { degree, labelInChord, prettyDegree } from './intervals';
import { defaultSpelling, formatNote, mod12, spellWithLetter, type AccidentalPref, type PitchClass, type SpelledNote } from './notes';
import { chooseScaleRoot, modeOf, scalePcs, scaleType, spellScale, type Mood } from './scales';

export interface ArpNote {
  pc: PitchClass;
  /** Degree relative to the *target* chord's root (e.g. "9" when playing Em7 over Cmaj7). */
  label: string;
  chordTone: boolean;
  name: string;
}

export interface Arpeggio {
  id: string;
  chord: ChordSpec;
  name: string;
  kind: 'exact' | 'reduction' | 'substitute';
  notes: ArpNote[];
  /** Tensions added on top of the target chord, e.g. ["9"]. */
  adds: string[];
  /** Resulting sound over the target chord's root, e.g. "Cmaj9". */
  sound: string | null;
  description: string;
  scaleLabel?: string;
  warning?: string;
  score: number;
  /** How well it fits the chord, 0..1 (1 = the chord's own arpeggio). */
  fit: number;
}

export interface ScaleContext {
  rootPc: PitchClass;
  scaleId: string;
}

const ORDINAL: Record<number, string> = { 1: 'root', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 9: '9th', 11: '11th', 13: '13th' };

function soundName(target: ChordSpec, pcs: PitchClass[], pref: AccidentalPref): string | null {
  const base: ChordSpec = { ...target, bassPc: undefined };
  const union = [...new Set([...chordPcs(base), ...pcs])];
  const rootSpelling = spellChord(target, pref).root;
  const t = nameOverRoot(target.rootPc, union);
  if (t) return chordName({ rootPc: target.rootPc, type: t, rootSpelling }, pref);
  // No standard symbol: use the generic name, e.g. "Am(add11, add♭13)".
  let mask = 0;
  for (const p of union) mask |= 1 << mod12(p - target.rootPc);
  return chordName({ rootPc: target.rootPc, type: nameFromSemis(mask, false).type, rootSpelling }, pref);
}

/** Spell a note relative to the target chord using its degree label (e.g. the 9 of B is C♯). */
function spellRel(target: ChordSpec, pc: PitchClass, label: string, pref: AccidentalPref): SpelledNote {
  const root = spellChord(target, pref).root;
  return spellWithLetter(pc, root.letter + degree(label).step) ?? defaultSpelling(pc, pref);
}

// ---------------------------------------------------------------------------------------------
// Exact arpeggios (the chord itself and its simpler "core" versions)
// ---------------------------------------------------------------------------------------------

export function exactArpeggios(target: ChordSpec, pref: AccidentalPref = 'auto'): Arpeggio[] {
  const out: Arpeggio[] = [];
  const name = chordName(target, pref);
  const pcs = chordPcs(target);
  const labels = pcs.map((pc) => labelInChord(pc - target.rootPc, target.type.degrees));
  out.push({
    id: `exact-${target.rootPc}-${target.type.id}-${target.bassPc ?? ''}`,
    chord: target,
    name,
    kind: 'exact',
    notes: pcs.map((pc, i) => ({ pc, label: labels[i], chordTone: true, name: formatNote(spellRel(target, pc, labels[i], pref)) })),
    adds: [],
    sound: name,
    description: `The chord's own arpeggio: ${labels.map(prettyDegree).join(' – ')}.`,
    score: 100,
    fit: 1,
  });

  // Reductions: 7th-chord core and triad core of extended chords.
  const degs = target.type.degrees;
  const third = degs.find((d) => ['3', 'b3', '4', '2'].includes(d));
  const fifth = degs.find((d) => ['5', 'b5', '#5'].includes(d));
  const seventh = degs.find((d) => ['7', 'b7', 'bb7', '6'].includes(d));
  const cores: { degs: string[]; label: string }[] = [];
  if (seventh && degs.length > 4) cores.push({ degs: ['1', third, fifth ?? '5', seventh].filter(Boolean) as string[], label: '7th-chord core' });
  if (degs.length > 3 && third) cores.push({ degs: ['1', third, fifth ?? '5'], label: 'triad core' });
  for (const core of cores) {
    const corePcs = core.degs.map((l) => mod12(target.rootPc + degree(l).semi));
    const t = nameOverRoot(target.rootPc, corePcs);
    if (!t || t.id === target.type.id) continue;
    // Only accept exact matches (every note of the reduction is in the core).
    const exact = t.degreeInfo.every((d) => corePcs.includes(mod12(target.rootPc + d.semi)));
    if (!exact) continue;
    const c: ChordSpec = { rootPc: target.rootPc, type: t, rootSpelling: spellChord(target, pref).root };
    if (out.some((a) => a.chord.type.id === t.id)) continue;
    const cp = chordPcs(c);
    out.push({
      id: `red-${target.rootPc}-${t.id}`,
      chord: c,
      name: chordName(c, pref),
      kind: 'reduction',
      notes: cp.map((pc) => {
        const label = labelInChord(pc - target.rootPc, target.type.degrees);
        return { pc, label, chordTone: true, name: formatNote(spellRel(target, pc, label, pref)) };
      }),
      adds: [],
      sound: name,
      description: `Simpler ${core.label} of ${name} (${t.degrees.map(prettyDegree).join(' – ')}). Easier to finger; still outlines the harmony.`,
      score: 90,
      fit: 0.95,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Substitute arpeggios
// ---------------------------------------------------------------------------------------------

// Arpeggio shapes considered as substitutes, with how familiar/commonly used each one is.
const VOCAB: { id: string; prior: number }[] = [
  { id: 'maj', prior: 1 },
  { id: 'm', prior: 1 },
  { id: 'm7', prior: 1 },
  { id: 'maj7', prior: 0.95 },
  { id: '7', prior: 0.9 },
  { id: 'm7b5', prior: 0.8 },
  { id: 'dim7', prior: 0.7 },
  { id: '9', prior: 0.65 },
  { id: 'add9', prior: 0.6 },
  { id: 'maj9', prior: 0.6 },
  { id: 'm9', prior: 0.6 },
  { id: 'sus4', prior: 0.4 },
  { id: 'sus2', prior: 0.4 },
  { id: '6', prior: 0.5 },
  { id: '7sus4', prior: 0.4 },
  { id: 'madd9', prior: 0.5 },
  { id: 'dim', prior: 0.5 },
  { id: 'aug', prior: 0.5 },
  { id: 'm6', prior: 0.45 },
  { id: 'mmaj7', prior: 0.45 },
  { id: '6/9', prior: 0.4 },
  { id: 'maj7#5', prior: 0.4 },
  { id: '7#5', prior: 0.35 },
  { id: '7b9', prior: 0.35 },
  { id: '7b5', prior: 0.3 },
  { id: '7#9', prior: 0.3 },
];

const PENTATONIC_LIKE = new Set(['majorPentatonic', 'minorPentatonic', 'blues']);

function avoidNotes(target: ChordType, tensions: string[]): string[] {
  const has = (l: string) => target.degrees.includes(l);
  const dominant = target.family === 'dominant';
  const out: string[] = [];
  for (const t of tensions) {
    if (t === '11' && has('3')) out.push(t); // natural 4 against a major 3rd
    else if (t === 'b9' && !dominant) out.push(t);
    else if (t === 'b13' && has('3') && !dominant) out.push(t); // ♭6 over a major chord
    else if (t === '#9' && !dominant) out.push(t); // minor 3rd against a major 3rd
    else if (t === 'b7' && has('7')) out.push(t);
    else if (t === '7' && has('b7')) out.push(t);
    else if (t === '3' && has('b3')) out.push(t);
    else if (t === '#5' && has('5')) out.push(t);
    else if (t === 'b5' && has('5')) out.push(t);
  }
  return out;
}

function relationText(semi: number, target: ChordType): string {
  const lbl = labelInChord(semi, target.degrees);
  const d = degree(lbl);
  const ord = ORDINAL[d.num] ?? `${d.num}th`;
  const acc = lbl.startsWith('bb') ? '♭♭' : lbl.startsWith('b') ? '♭' : lbl.startsWith('#') ? '♯' : '';
  return `${acc}${ord}`;
}

export interface SuggestOptions {
  pref?: AccidentalPref;
  /** Key / scale context (e.g. from a progression). Used first when the chord fits it. */
  context?: ScaleContext;
  limit?: number;
}

/** Scales to draw substitute arpeggios from, best first, as absolute roots + ids. */
export function chordScales(target: ChordSpec, context?: ScaleContext): ScaleContext[] {
  const out: ScaleContext[] = [];
  const pcs = chordPcs(target);
  if (context) {
    const s = new Set(scalePcs(context.rootPc, context.scaleId));
    if (pcs.every((p) => s.has(p))) {
      const mode = modeOf(context.rootPc, context.scaleId, target.rootPc);
      out.push(mode ? { rootPc: target.rootPc, scaleId: mode } : context);
    }
  }
  for (const id of target.type.scales) {
    const s = new Set(scalePcs(target.rootPc, id));
    // Chord-scales must contain the whole chord (a slash bass may fall outside).
    if (!chordPcs({ ...target, bassPc: undefined }).every((p) => s.has(p))) continue;
    if (!out.some((o) => o.rootPc === target.rootPc && o.scaleId === id)) out.push({ rootPc: target.rootPc, scaleId: id });
  }
  return out;
}

export function scaleLabel(sc: ScaleContext, pref: AccidentalPref = 'auto'): string {
  return `${formatNote(chooseScaleRoot(sc.rootPc, sc.scaleId, pref))} ${scaleType(sc.scaleId).name}`;
}

/**
 * How much each of the target chord's tones matters for "outlining" it: the 3rd and 7th define
 * the quality, an altered 5th is characteristic, the root and a plain 5th matter least.
 */
function outlineWeights(target: ChordType): Map<number, number> {
  const w = new Map<number, number>();
  const hasThird = target.degrees.some((d) => degree(d).num === 3);
  const hasSeventh = target.degrees.some((d) => degree(d).num === 7);
  for (const d of target.degreeInfo) {
    const n = d.num;
    let weight: number;
    if (n === 1) weight = 0.15;
    else if (n === 3 || (!hasThird && (n === 2 || n === 4))) weight = 0.35;
    else if (n === 7 || (!hasSeventh && n === 6)) weight = 0.3;
    else if (n === 5) weight = d.label === '5' ? 0.1 : 0.25;
    else weight = 0.12; // extensions that are part of the chord (9, 11, 13, alterations)
    w.set(d.semi, weight);
  }
  return w;
}

function relationFamiliarity(rel: number, target: ChordType): number {
  if (rel === 3 || rel === 4) return 0.4; // built on the 3rd — the classic substitute
  if (rel === 7) return 0.35; // on the 5th
  if (rel === 10 || rel === 11) return 0.3; // on the 7th
  if (rel === 9 && target.family !== 'minor') return 0.3; // relative minor / 6th
  if (rel === 2) return 0.2; // on the 9th
  if (rel === 0) return 0;
  return 0.1;
}

/**
 * Substitute arpeggios over a chord, best fit first.
 *
 * fit = 0.35 · consonance  (chord tones and available tensions; avoid notes and notes from a less
 *                           likely chord-scale count less)
 *     + 0.25 · outline     (how much of the chord's 3rd/7th/characteristic tones it contains)
 *     + 0.15 · colour      (how many good tensions — 9ths, 11ths, 13ths — it adds)
 *     + 0.25 · familiarity (common shape; built on the 3rd/5th/7th, the classic substitutes)
 *     − small costs for 5-note shapes (harder to play) and for sharing the chord's root.
 */
/** Everything about the target chord that rating an arpeggio against it needs. */
interface RateEnv {
  target: ChordSpec;
  tPcs: Set<PitchClass>;
  tDegs: string[];
  weights: Map<number, number>;
  totalWeight: number;
  targetName: string;
  scales: ScaleContext[];
  scaleSets: Set<PitchClass>[];
  pref: AccidentalPref;
}

function rateEnv(target: ChordSpec, context: ScaleContext | undefined, pref: AccidentalPref): RateEnv {
  const base: ChordSpec = { ...target, bassPc: undefined };
  const tPcs = new Set(chordPcs(base));
  const weights = outlineWeights(target.type);
  const scales = chordScales(base, context).filter((s) => !PENTATONIC_LIKE.has(s.scaleId)).slice(0, 3);
  const scaleSets = scales.map((sc) => {
    const set = new Set(scalePcs(sc.rootPc, sc.scaleId));
    for (const p of tPcs) set.add(p);
    return set;
  });
  return {
    target,
    tPcs,
    tDegs: target.type.degrees,
    weights,
    totalWeight: [...weights.values()].reduce((a, b) => a + b, 0),
    targetName: chordName(base, pref),
    scales,
    scaleSets,
    pref,
  };
}

/**
 * Rate one arpeggio over the target chord.
 *
 * fit = 0.35 · consonance  (chord tones and available tensions; avoid notes, notes from a less
 *                           likely chord-scale and notes outside every chord-scale count less)
 *     + 0.25 · outline     (how much of the chord's 3rd/7th/characteristic tones it contains)
 *     + 0.15 · colour      (how many good tensions — 9ths, 11ths, 13ths — it adds)
 *     + 0.25 · familiarity (common shape; built on the 3rd/5th/7th, the classic substitutes)
 *     − small costs for 5-note shapes (harder to play) and for sharing the chord's root.
 *
 * strict = true is used when *generating* suggestions: arpeggios outside the chord-scales, or
 * sharing too few notes with the chord, are rejected (null). strict = false rates anything —
 * used for arpeggios the user types in.
 */
function rateArpeggio(env: RateEnv, chord: ChordSpec, prior: number, strict: boolean): Arpeggio | null {
  const { target, tPcs, tDegs, weights, totalWeight, targetName, scales, scaleSets, pref } = env;
  const pcs = [...new Set(chordPcs(chord))];
  const root = chord.rootPc;
  const scaleIdx = scaleSets.findIndex((set) => pcs.every((p) => set.has(p)));
  if (strict && scaleIdx < 0) return null;
  const subset = pcs.every((p) => tPcs.has(p));
  if (strict && root === target.rootPc && subset) return null; // a reduction of the chord itself
  if (strict && root === target.rootPc && chord.type.id === target.type.id) return null;

  const labels = pcs.map((pc) => labelInChord(pc - target.rootPc, tDegs));
  const tensions = labels.filter((_, i) => !tPcs.has(pcs[i]));
  const avoid = avoidNotes(target.type, tensions);
  const good = tensions.filter((t) => !avoid.includes(t));
  const ct = pcs.filter((p) => tPcs.has(p)).length;
  // An arpeggio should normally share at least two notes with the chord. Exceptions: over a
  // plain triad one shared note is enough if it adds ≥2 good colours (e.g. Em7 over Am), and
  // "upper structures" made only of good tensions (e.g. G over Am, D over Cmaj7) are allowed.
  const upperStructure = ct === 0 && avoid.length === 0 && good.length >= 3;
  if (strict && ct < 2 && !upperStructure && !(ct === 1 && tDegs.length <= 3 && avoid.length === 0 && good.length >= 2)) return null;

  const outside = pcs.filter((pc) => !tPcs.has(pc) && !scaleSets.some((set) => set.has(pc)));
  const quality = pcs.map((pc, i) => {
    if (tPcs.has(pc)) return 1;
    if (avoid.includes(labels[i])) return 0.35;
    if (scaleSets[0]?.has(pc)) return 1;
    return scaleSets.some((set) => set.has(pc)) ? 0.75 : 0.1;
  });
  const consonance = quality.reduce((a, b) => a + b, 0) / pcs.length;
  let outlined = 0;
  for (const pc of pcs) outlined += weights.get(mod12(pc - target.rootPc)) ?? 0;
  const outline = totalWeight ? outlined / totalWeight : 0;
  const colour = Math.min(1, good.filter((g) => !outside.some((pc) => labelInChord(pc - target.rootPc, tDegs) === g)).length / 2);
  const rel = mod12(root - target.rootPc);
  const familiarity = Math.min(1, 0.6 * prior + relationFamiliarity(rel, target.type));
  let fit = 0.35 * consonance + 0.25 * outline + 0.15 * colour + 0.25 * familiarity;
  if (rel === 0) fit -= 0.05; // same root: more an extension of the chord than a substitute
  if (pcs.length >= 5) fit -= 0.03;

  const name = chordName(chord, pref);
  const spelled = spellChord(chord, pref).tones;
  const nameOf = (pc: number) => {
    const t = spelled.find((x) => x.pc === pc);
    return t ? formatNote(t.note) : formatNote(spellRel(target, pc, labelInChord(pc - target.rootPc, tDegs), pref));
  };
  let sound = soundName(target, pcs, pref);
  const parts: string[] = [
    subset && ct === tPcs.size
      ? `Same notes as ${targetName}.`
      : rel === 0
        ? `Extends ${targetName} from its own root.`
        : `Built on the ${relationText(rel, target.type)} of ${targetName}.`,
  ];
  const dimParent = (target.type.id === 'dim7' || target.type.id === 'dim') && chord.type.id === '7' && tensions.length === 1 && !tPcs.has(root);
  if (dimParent) {
    parts.length = 0;
    parts.push(
      `${targetName} works like a rootless ${name}♭9 (its notes are the 3rd, 5th, 7th and ♭9 of ${name}). Use the ${name} arpeggio to hear that dominant function.`,
    );
    fit += 0.05;
    sound = `${name}♭9`;
  } else if (upperStructure) {
    parts.push(
      `Upper structure — only colour tones (${labels.map(prettyDegree).join(', ')})${sound && sound !== targetName ? ` → ${sound} sound` : ''}. Sounds modern and open; let the bass/chord supply the root.`,
    );
  } else if (good.length) parts.push(`Adds ${good.map(prettyDegree).join(' & ')}${sound && sound !== targetName ? ` → ${sound} sound` : ''}.`);
  else if (tensions.length) parts.push(`Adds ${tensions.map(prettyDegree).join(', ')} — notes that clash with ${targetName}: a tense, "outside" sound.`);
  else if (!(subset && ct === tPcs.size)) parts.push(`Only chord tones (${labels.map(prettyDegree).join('-')}) — outlines the chord without stating the root.`);
  fit = Math.max(0, Math.min(0.99, fit));

  const warnings: string[] = [];
  if (avoid.length) warnings.push(`Contains the ${avoid.map(prettyDegree).join(', ')} — an "avoid note" over ${targetName}; use it as a passing tone.`);
  if (outside.length && scales.length)
    warnings.push(`${outside.map(nameOf).join(', ')} ${outside.length > 1 ? 'are' : 'is'} outside the chord-scale (${scaleLabel(scales[0], pref)}) — a deliberate "outside" sound.`);

  return {
    id: `sub-${root}-${chord.type.id}-${chord.bassPc ?? ''}`,
    chord,
    name,
    kind: 'substitute',
    notes: pcs.map((pc, i) => ({ pc, label: labels[i], chordTone: tPcs.has(pc), name: nameOf(pc) })),
    adds: good,
    sound,
    description: parts.join(' '),
    scaleLabel: scaleIdx >= 0 ? scaleLabel(scales[scaleIdx], pref) : undefined,
    warning: warnings.length ? warnings.join(' ') : undefined,
    score: fit * 100,
    fit,
  };
}

/** Substitute arpeggios over a chord, best fit first (see rateArpeggio for the fit formula). */
export function suggestArpeggios(target: ChordSpec, opts: SuggestOptions = {}): Arpeggio[] {
  const pref = opts.pref ?? 'auto';
  const limit = opts.limit ?? 12;
  const env = rateEnv(target, opts.context, pref);
  const roots = new Set<number>();
  for (const sc of env.scales) for (const p of scalePcs(sc.rootPc, sc.scaleId)) roots.add(p);
  const cands = new Map<string, Arpeggio>();

  for (const root of roots) {
    for (const v of VOCAB) {
      const type = chordType(v.id);
      const rel = mod12(root - target.rootPc);
      // Spell the root relative to the chord (D♯m7 over B), but never as B♯/E♯/C♭/F♭ or a double accidental.
      const relSpelling = spellRel(target, root, labelInChord(rel, env.tDegs), pref);
      const awkward =
        Math.abs(relSpelling.acc) > 1 ||
        (relSpelling.acc === 1 && (relSpelling.letter === 2 || relSpelling.letter === 6)) ||
        (relSpelling.acc === -1 && (relSpelling.letter === 0 || relSpelling.letter === 3));
      const arp = rateArpeggio(env, { rootPc: root, type, rootSpelling: awkward ? undefined : relSpelling }, v.prior, true);
      if (!arp) continue;
      const prev = cands.get(arp.id);
      if (!prev || prev.fit < arp.fit) cands.set(arp.id, arp);
    }
  }

  // Arpeggios with identical notes (e.g. Em7 = G6, the four inversions of a dim7) are merged,
  // keeping the most common chord name; arpeggios with exactly the target chord's notes are dropped.
  const targetMask = maskOf(env.tPcs);
  const byNotes = new Map<number, Arpeggio>();
  for (const a of cands.values()) {
    const m = maskOf(a.notes.map((n) => n.pc));
    if (m === targetMask) continue;
    const prev = byNotes.get(m);
    if (!prev) {
      byNotes.set(m, a);
      continue;
    }
    const better = vocabPrior(a) > vocabPrior(prev) || (vocabPrior(a) === vocabPrior(prev) && a.fit > prev.fit) ? a : prev;
    const fit = Math.max(a.fit, prev.fit);
    byNotes.set(m, { ...better, fit, score: fit * 100 });
  }
  return [...byNotes.values()].sort((a, b) => b.fit - a.fit).slice(0, limit);
}

/**
 * Analyse any arpeggio (e.g. one the user typed in) over a chord with the same rating as the
 * suggestions: fit %, the colour tones it adds, the resulting sound, avoid and "outside" notes.
 */
export function analyzeArpeggio(target: ChordSpec, arp: ChordSpec, opts: { pref?: AccidentalPref; context?: ScaleContext } = {}): Arpeggio {
  const env = rateEnv(target, opts.context, opts.pref ?? 'auto');
  const prior = VOCAB.find((v) => v.id === arp.type.id)?.prior ?? Math.min(0.5, arp.type.prior);
  return { ...rateArpeggio(env, arp, prior, false)!, kind: 'substitute' };
}

/** Same pitch-class set as the arpeggio? (used to find a typed arpeggio among the suggestions) */
export function sameNotes(a: ChordSpec, b: ChordSpec): boolean {
  return a.rootPc === b.rootPc && maskOf(chordPcs(a)) === maskOf(chordPcs(b));
}

function maskOf(pcs: Iterable<PitchClass>): number {
  let m = 0;
  for (const p of pcs) m |= 1 << p;
  return m;
}

function vocabPrior(a: Arpeggio): number {
  return VOCAB.find((v) => v.id === a.chord.type.id)?.prior ?? 0;
}

export interface ScaleSuggestion extends ScaleContext {
  label: string;
  notes: string;
  info: string;
  moods: Mood[];
  root: SpelledNote;
}

export function suggestScales(target: ChordSpec, pref: AccidentalPref = 'auto', context?: ScaleContext): ScaleSuggestion[] {
  const out: ScaleSuggestion[] = [];
  for (const sc of chordScales({ ...target, bassPc: undefined }, context)) {
    // Scales on the chord's root use the chord's own spelling (E♭ Blues over E♭…, not D♯ Blues).
    const root = sc.rootPc === target.rootPc ? spellChord(target, pref).root : chooseScaleRoot(sc.rootPc, sc.scaleId, pref);
    out.push({
      ...sc,
      label: `${formatNote(root)} ${scaleType(sc.scaleId).name}`,
      notes: spellScale(root, sc.rootPc, sc.scaleId).map(formatNote).join(' '),
      info: scaleType(sc.scaleId).info,
      moods: scaleType(sc.scaleId).moods,
      root,
    });
  }
  return out.slice(0, 5);
}
