// The "arrangement": a progression plus, for every chord, which arpeggio is played, in which
// position and for how long — and its plain-text export / import format.

import type { FretWindow } from './fretboard';
import { parseMidiName } from './notes';
import { tokenizeProgression } from './parse';

export type SlotPosition = 'global' | 'neck' | FretWindow;

export interface Slot {
  /** Arpeggio as typed or chosen (chord symbol or notes); null = the chord's own arpeggio. */
  arp: string | null;
  pos: SlotPosition;
  /** Length in beats (4 = one bar of 4/4). */
  beats: number;
}

export const DEFAULT_SLOT: Slot = { arp: null, pos: 'global', beats: 4 };
export const BEAT_OPTIONS = [2, 4, 8];

export function slotAt(slots: (Slot | null | undefined)[], i: number): Slot {
  return { ...DEFAULT_SLOT, ...(slots[i] ?? {}) };
}

export interface ArrangementDoc {
  chords: string[];
  slots: Slot[];
  tempo?: number;
  /** The shared position ("same as all"); null = whole neck. */
  position?: FretWindow | null;
  tuning?: number[];
}

export const toAscii = (s: string) =>
  s.replace(/♭♭|𝄫/g, 'bb').replace(/♯♯|𝄪/g, '##').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/–/g, '-');

export function positionText(pos: SlotPosition | FretWindow | null | undefined): string {
  if (pos === 'global') return 'all';
  if (pos === 'neck' || pos === null || pos === undefined) return 'neck';
  return `${pos.start}-${pos.end}`;
}

export function beatsText(beats: number): string {
  if (beats === 2) return '1/2 bar';
  if (beats === 4) return '1 bar';
  if (beats % 4 === 0) return `${beats / 4} bars`;
  return `${beats} beats`;
}

function parsePosition(v: string): SlotPosition | undefined {
  const t = v.trim().toLowerCase();
  if (!t || t === 'all' || t === 'same' || t === 'global' || t === 'same as all') return 'global';
  if (t === 'neck' || t === 'whole neck' || t === 'whole') return 'neck';
  const m = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(t.replace(/^frets?\s*/, ''));
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (end >= start) return { start, end };
  }
  return undefined;
}

function parseBeats(v: string): number | undefined {
  const t = v.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Math.max(1, Math.min(16, Number(t)));
  if (/^(1\/2|½|half)( bar)?$/.test(t)) return 2;
  const m = /^(\d+)\s*bars?$/.exec(t);
  if (m) return Math.max(1, Math.min(4, Number(m[1]))) * 4;
  return undefined;
}

export interface ExportRow {
  chord: string;
  roman: string;
  arpeggio: string;
  notes: string;
  fit: string;
  sound: string;
  position: string;
  length: string;
}

export interface ExportInfo {
  key: string;
  tuning: string;
  tempo: number;
  position: string;
  date: string;
  rows: ExportRow[];
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => [...r[c]].length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, c) => cell + ' '.repeat(Math.max(0, widths[c] - [...cell].length)))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** A readable summary followed by a [data] section that Import reads back. */
export function exportArrangementText(doc: ArrangementDoc, info: ExportInfo): string {
  const out: string[] = [];
  out.push('FRETBOARD LAB — PROGRESSION & ARPEGGIOS');
  out.push(`Saved: ${info.date}`);
  out.push(`Key: ${info.key}`);
  out.push(`Tuning: ${info.tuning}`);
  out.push(`Tempo: ${info.tempo} BPM`);
  out.push(`Position for all chords: ${info.position}`);
  out.push('');
  out.push(
    table(
      ['#', 'Chord', 'Roman', 'Arpeggio', 'Notes', 'Fit', 'Sound', 'Position', 'Length'],
      info.rows.map((r, i) => [String(i + 1), r.chord, r.roman, r.arpeggio, r.notes, r.fit, r.sound, r.position, r.length]),
    ),
  );
  out.push('');
  out.push('[data]');
  out.push('# Read by Fretboard Lab\'s Import button. You can edit it: one "chord:" line per chord, in order.');
  out.push('# arpeggio: chord symbol or notes, "-" = the chord\'s own arpeggio · position: all | neck | 5-9 · length: beats (2, 4, 8)');
  if (doc.tuning) out.push(`tuning: ${doc.tuning.map((m) => midiText(m)).join(' ')}`);
  if (doc.tempo) out.push(`tempo: ${doc.tempo}`);
  if (doc.position !== undefined) out.push(`position: ${positionText(doc.position)}`);
  doc.chords.forEach((c, i) => {
    const s = slotAt(doc.slots, i);
    out.push(`chord: ${toAscii(c)} | arpeggio: ${s.arp ? toAscii(s.arp) : '-'} | position: ${positionText(s.pos)} | length: ${s.beats}`);
  });
  return out.join('\n') + '\n';
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiText = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export interface ParsedArrangement {
  doc: ArrangementDoc;
  errors: string[];
}

/**
 * Read an exported file (or something hand-written). Understands:
 *   chord: Dm7 | arpeggio: Fmaj7 | position: 5-9 | length: 4
 *   Dm7 -> Fmaj7            (chord → arpeggio)
 *   tuning: D2 A2 D3 G3 B3 E4 · tempo: 100 · position: 5-9
 * If the file has a [data] section only that part is read. A file with no chord lines at all is
 * read as a plain progression ("Am F C G"); validating the symbols is left to the caller.
 */
export function parseArrangementText(text: string): ParsedArrangement {
  const all = text.replace(/\r/g, '').split('\n');
  const dataAt = all.findIndex((l) => l.trim().toLowerCase() === '[data]');
  const lines = dataAt >= 0 ? all.slice(dataAt + 1) : all;
  const doc: ArrangementDoc = { chords: [], slots: [] };
  const errors: string[] = [];
  const loose: string[] = [];

  lines.forEach((raw, n) => {
    const line = raw.replace(/\s#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const lineNo = (dataAt >= 0 ? dataAt + 1 : 0) + n + 1;
    const arrow = /^(.+?)\s*(?:->|=>|→)\s*(.+)$/.exec(line);
    if (arrow && !line.includes('|')) {
      doc.chords.push(arrow[1].trim());
      doc.slots.push({ ...DEFAULT_SLOT, arp: /^-+$/.test(arrow[2].trim()) ? null : arrow[2].trim() });
      return;
    }
    if (line.includes('|') && /^chord\s*:/i.test(line)) {
      const slot: Slot = { ...DEFAULT_SLOT };
      let chord = '';
      for (const part of line.split('|')) {
        const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(part);
        if (!m) continue;
        const k = m[1].toLowerCase();
        const v = m[2];
        if (k === 'chord') chord = v;
        else if (k === 'arpeggio' || k === 'arp') slot.arp = !v || /^-+$/.test(v) ? null : v;
        else if (k === 'position' || k === 'pos') {
          const p = parsePosition(v);
          if (p) slot.pos = p;
          else errors.push(`Line ${lineNo}: position "${v}" not understood (use all, neck or e.g. 5-9).`);
        } else if (k === 'length' || k === 'beats') {
          const b = parseBeats(v);
          if (b) slot.beats = b;
          else errors.push(`Line ${lineNo}: length "${v}" not understood (use beats, e.g. 4).`);
        }
      }
      if (!chord) errors.push(`Line ${lineNo}: missing "chord:".`);
      else {
        doc.chords.push(chord);
        doc.slots.push(slot);
      }
      return;
    }
    const kv = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (kv) {
      const k = kv[1].toLowerCase();
      const v = kv[2].trim();
      if (k === 'tempo') {
        const t = parseInt(v, 10);
        if (t >= 30 && t <= 300) doc.tempo = t;
        else errors.push(`Line ${lineNo}: tempo "${v}" should be 30–300.`);
      } else if (k === 'position') {
        const p = parsePosition(v);
        if (p === undefined) errors.push(`Line ${lineNo}: position "${v}" not understood.`);
        else doc.position = p === 'global' || p === 'neck' ? null : p;
      } else if (k === 'tuning') {
        const notes = v.split(/[\s,]+/).filter(Boolean).map(parseMidiName);
        if (notes.length >= 3 && notes.every((m): m is number => m !== null)) doc.tuning = notes as number[];
        else if (dataAt >= 0) errors.push(`Line ${lineNo}: tuning "${v}" not understood (use notes with octaves, e.g. E2 A2 D3 G3 B3 E4).`);
      } else if (k === 'chord') {
        doc.chords.push(v);
        doc.slots.push({ ...DEFAULT_SLOT });
      }
      // other "key: value" lines (Key:, Saved:, …) are informational
      return;
    }
    loose.push(line);
  });

  if (!doc.chords.length && loose.length) {
    // A plain progression, e.g. "Am F C G" or "Dm7 | G7 | Cmaj7"
    for (const l of loose) for (const tok of tokenizeProgression(l)) {
      doc.chords.push(tok);
      doc.slots.push({ ...DEFAULT_SLOT });
    }
  }
  return { doc, errors };
}
