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
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Substitute arpeggios
// ---------------------------------------------------------------------------------------------

const VOCAB: { id: string; prior: number }[] = [
  { id: 'maj', prior: 1 },
  { id: 'm', prior: 1 },
  { id: 'm7', prior: 1 },
  { id: 'maj7', prior: 0.95 },
  { id: '7', prior: 0.9 },
  { id: 'm7b5', prior: 0.8 },
  { id: 'dim', prior: 0.5 },
  { id: 'dim7', prior: 0.7 },
  { id: 'aug', prior: 0.5 },
  { id: 'mmaj7', prior: 0.45 },
  { id: 'maj7#5', prior: 0.4 },
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

function tensionValue(t: string, target: ChordType): number {
  switch (t) {
    case '9':
      return 1.3;
    case '13':
    case '6':
      return 1.1;
    case '#11':
      return target.family === 'major' || target.family === 'dominant' ? 1.1 : 0.6;
    case '11':
      return 1.1; // only reached when it is not an avoid note (minor / sus chords)
    case 'b9':
    case '#9':
    case 'b13':
      return target.family === 'dominant' ? 1.0 : 0.5;
    case '7':
    case 'b7':
      return 0.9; // turning a triad into a 7th chord
    default:
      return 0.4;
  }
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

export function suggestArpeggios(target: ChordSpec, opts: SuggestOptions = {}): Arpeggio[] {
  const pref = opts.pref ?? 'auto';
  const limit = opts.limit ?? 6;
  const base: ChordSpec = { ...target, bassPc: undefined };
  const tPcs = new Set(chordPcs(base));
  const tDegs = target.type.degrees;
  const guideLabels = tDegs.filter((l) => {
    const n = degree(l).num;
    return n === 3 || n === 7 || (n === 4 && target.type.family === 'suspended') || (n === 6 && !tDegs.some((x) => degree(x).num === 7));
  });
  const guidePcs = new Set(guideLabels.map((l) => mod12(target.rootPc + degree(l).semi)));

  const scales = chordScales(base, opts.context).filter((s) => !PENTATONIC_LIKE.has(s.scaleId)).slice(0, 3);
  const cands = new Map<string, Arpeggio>();

  scales.forEach((sc, scaleIdx) => {
    const S = new Set(scalePcs(sc.rootPc, sc.scaleId));
    for (const p of tPcs) S.add(p);
    for (const root of scalePcs(sc.rootPc, sc.scaleId)) {
      for (const v of VOCAB) {
        const type = chordType(v.id);
        const pcs = type.degreeInfo.map((d) => mod12(root + d.semi));
        if (!pcs.every((p) => S.has(p))) continue;
        const subset = pcs.every((p) => tPcs.has(p));
        if (root === target.rootPc && subset) continue; // a reduction of the chord itself
        if (root === target.rootPc && type.id === target.type.id) continue;

        const labels = pcs.map((pc) => labelInChord(pc - target.rootPc, tDegs));
        const tensions = labels.filter((_, i) => !tPcs.has(pcs[i]));
        const avoid = avoidNotes(target.type, tensions);
        const good = tensions.filter((t) => !avoid.includes(t));
        const ct = pcs.filter((p) => tPcs.has(p)).length;
        // Normally an arpeggio should share at least two notes with the chord. Exceptions: over a
        // plain triad one shared note is enough if it adds ≥2 good colours (e.g. Em7 over Am), and
        // "upper structures" made only of good tensions (e.g. G over Am, D over Cmaj7) are allowed.
        const upperStructure = ct === 0 && avoid.length === 0 && good.length >= 3;
        if (ct < 2 && !upperStructure && !(ct === 1 && tDegs.length <= 3 && avoid.length === 0 && good.length >= 2)) continue;
        const guide = pcs.filter((p) => guidePcs.has(p)).length;
        const rel = mod12(root - target.rootPc);
        let relationBonus = 0;
        if (rel === 3 || rel === 4) relationBonus = 1.2;
        else if (rel === 7) relationBonus = 0.8;
        else if (rel === 10 || rel === 11) relationBonus = 0.6;
        else if (rel === 9 && target.type.family === 'major') relationBonus = 0.5;
        else if (rel === 2) relationBonus = 0.3;

        let score =
          1.0 * ct +
          1.5 * guide +
          good.slice(0, 3).reduce((s, t) => s + tensionValue(t, target.type), 0) -
          4 * avoid.length +
          (pcs.length >= 4 ? 0.7 : 0) +
          1.5 * v.prior +
          relationBonus +
          (scaleIdx === 0 ? 1 : scaleIdx === 1 ? 0.4 : 0);
        // Containing the root makes it less of a "substitute"
        if (pcs.includes(target.rootPc) && tensions.length === 0) score -= 1;

        const chord: ChordSpec = { rootPc: root, type, rootSpelling: spellRel(target, root, labelInChord(rel, tDegs), pref) };
        const name = chordName(chord, pref);
        const ownSpelling = spellChord(chord, pref).tones.map((t) => t.note);
        let sound = soundName(target, pcs, pref);
        const targetName = chordName(base, pref);
        const relTxt = relationText(rel, target.type);
        const parts: string[] = [];
        parts.push(`Built on the ${relTxt} of ${targetName}.`);
        const dimParent =
          (target.type.id === 'dim7' || target.type.id === 'dim') && type.id === '7' && tensions.length === 1 && !tPcs.has(root);
        if (dimParent) {
          parts.length = 0;
          parts.push(
            `${targetName} works like a rootless ${name}♭9 (its notes are the 3rd, 5th, 7th and ♭9 of ${name}). Use the ${name} arpeggio to hear that dominant function.`,
          );
          score += 1;
          sound = `${name}♭9`;
        } else if (upperStructure) parts.push(`Upper structure — only colour tones (${labels.map(prettyDegree).join(', ')})${sound && sound !== targetName ? ` → ${sound} sound` : ''}. Sounds modern and open; let the bass/chord supply the root.`);
        else if (good.length) parts.push(`Adds ${good.map(prettyDegree).join(' & ')}${sound && sound !== targetName ? ` → ${sound} sound` : ''}.`);
        else parts.push(`Only chord tones (${labels.map(prettyDegree).join('-')}) — outlines the chord without stating the root.`);
        const id = `sub-${root}-${type.id}`;
        const arp: Arpeggio = {
          id,
          chord,
          name,
          kind: 'substitute',
          notes: pcs.map((pc, i) => ({ pc, label: labels[i], chordTone: tPcs.has(pc), name: formatNote(ownSpelling[i]) })),
          adds: good,
          sound,
          description: parts.join(' '),
          scaleLabel: scaleLabel(sc, pref),
          warning: avoid.length ? `Contains the ${avoid.map(prettyDegree).join(', ')} — an "avoid note" over ${targetName}; use it as a passing tone.` : undefined,
          score,
        };
        const prev = cands.get(id);
        if (!prev || prev.score < score) cands.set(id, arp);
      }
    }
  });

  // Arpeggios with identical notes (e.g. the four inversions of a dim7) are merged, keeping the
  // most common chord name; arpeggios with exactly the target chord's notes are dropped.
  const targetMask = maskOf(tPcs);
  const byNotes = new Map<number, Arpeggio>();
  for (const a of cands.values()) {
    const m = maskOf(a.notes.map((n) => n.pc));
    if (m === targetMask) continue;
    const prev = byNotes.get(m);
    if (!prev) {
      byNotes.set(m, a);
      continue;
    }
    const better = vocabPrior(a) > vocabPrior(prev) || (vocabPrior(a) === vocabPrior(prev) && a.score > prev.score) ? a : prev;
    byNotes.set(m, { ...better, score: Math.max(a.score, prev.score) });
  }
  return [...byNotes.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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
