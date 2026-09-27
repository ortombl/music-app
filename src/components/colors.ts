import { degreeCategory } from '../theory/intervals';

/** One colour per scale-degree family: root, 2/9, 3, 4/11, 5, 6/13, 7. */
export const DEGREE_COLORS: Record<number, string> = {
  1: '#e5484d',
  2: '#9e6bdb',
  3: '#f5a524',
  4: '#e0529c',
  5: '#3e7bfa',
  6: '#13a89e',
  7: '#35b36a',
};

export const DEGREE_NAMES: Record<number, string> = {
  1: 'Root',
  2: '2nd / 9th',
  3: '3rd',
  4: '4th / 11th',
  5: '5th',
  6: '6th / 13th',
  7: '7th',
};

export const NEUTRAL_COLOR = '#7c8aa5';

export function degreeColor(label: string | null | undefined): string {
  if (!label) return NEUTRAL_COLOR;
  try {
    return DEGREE_COLORS[degreeCategory(label)] ?? NEUTRAL_COLOR;
  } catch {
    return NEUTRAL_COLOR;
  }
}

/** Readable text colour on top of a marker colour. */
export function textOn(color: string): string {
  return color === DEGREE_COLORS[3] ? '#1b1300' : '#ffffff';
}
