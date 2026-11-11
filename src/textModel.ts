import type { Layer } from './model';

/** Inline overrides inherit absent properties from the text layer. */
export type TextStyle = {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  /** Tracking in local image pixels. */
  letterSpacing?: number;
};
export type ResolvedTextStyle = Required<TextStyle>;
export type TextRun = { text: string; style?: TextStyle };
export type Grapheme = { text: string; start: number; end: number };

let segmenter: Intl.Segmenter | undefined;
/** Offsets use UTF-16, matching browser selections, without splitting graphemes. */
export function graphemes(text: string): Grapheme[] {
  if (typeof Intl.Segmenter === 'function') {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), ({ segment, index }) => ({
      text: segment,
      start: index,
      end: index + segment.length,
    }));
  }
  const result: Grapheme[] = [];
  let offset = 0,
    regional = 0;
  for (const character of text) {
    const previous = result[result.length - 1];
    const isRegional = /\p{Regional_Indicator}/u.test(character);
    const extend =
      previous &&
      (/[\p{Grapheme_Extend}\p{Emoji_Modifier}\u200d]/u.test(character) ||
        previous.text.endsWith('\u200d') ||
        (previous.text === '\r' && character === '\n') ||
        (isRegional && regional % 2 === 1));
    if (extend) {
      previous.text += character;
      previous.end += character.length;
    } else
      result.push({
        text: character,
        start: offset,
        end: offset + character.length,
      });
    regional = isRegional ? regional + 1 : 0;
    offset += character.length;
  }
  return result;
}

function parseStyle(value: unknown): TextStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid text style');
  const input = value as Record<string, unknown>,
    style: TextStyle = {};
  for (const key of ['fontSize', 'fontWeight', 'letterSpacing'] as const) {
    const v = input[key];
    if (v === undefined) continue;
    const min = key === 'letterSpacing' ? -512 : 1;
    const max = key === 'fontSize' ? 8192 : key === 'fontWeight' ? 1000 : 512;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      throw new Error('Invalid text style number');
    style[key] = v;
  }
  for (const key of ['italic', 'underline', 'strike'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean')
      throw new Error('Invalid text style flag');
    style[key] = input[key];
  }
  for (const key of ['color', 'background', 'fontFamily'] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > (key === 'fontFamily' ? 512 : 256))
      throw new Error('Invalid text style string');
    style[key] = v;
  }
  return style;
}

export function sameTextStyle(a: TextStyle = {}, b: TextStyle = {}): boolean {
  return (
    [
      'fontSize',
      'fontFamily',
      'fontWeight',
      'italic',
      'underline',
      'strike',
      'color',
      'background',
      'letterSpacing',
    ] as const
  ).every((key) => a[key] === b[key]);
}

/** Validate, clone and coalesce runs. A grapheme belongs to its first code unit's style. */
export function normalizeTextRuns(value: unknown): TextRun[] {
  if (!Array.isArray(value) || value.length > 20000)
    throw new Error('Invalid text runs');
  let count = 0;
  const input = value
    .map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('Invalid text run');
      const run = item as Record<string, unknown>;
      if (typeof run.text !== 'string' || (count += run.text.length) > 1000000)
        throw new Error('Invalid text run content');
      return {
        text: run.text,
        style: run.style === undefined ? {} : parseStyle(run.style),
      };
    })
    .filter((run) => run.text.length);
  const result: TextRun[] = [];
  let runIndex = 0,
    runEnd = input[0]?.text.length ?? 0;
  for (const cluster of graphemes(input.map((run) => run.text).join(''))) {
    while (cluster.start >= runEnd && runIndex < input.length - 1)
      runEnd += input[++runIndex].text.length;
    const style = input[runIndex].style,
      previous = result[result.length - 1];
    if (previous && sameTextStyle(previous.style, style))
      previous.text += cluster.text;
    else
      result.push(
        Object.keys(style).length
          ? { text: cluster.text, style: { ...style } }
          : { text: cluster.text }
      );
  }
  return result;
}

export function textContent(layer: Pick<Layer, 'text' | 'textRuns'>): string {
  return layer.textRuns
    ? layer.textRuns.map((run) => run.text).join('')
    : (layer.text ?? '');
}

export function resolveTextStyle(
  layer: Partial<Layer>,
  style: TextStyle = {}
): ResolvedTextStyle {
  return {
    fontSize: style.fontSize ?? layer.fontSize ?? 40,
    fontFamily: style.fontFamily ?? layer.fontFamily ?? 'sans-serif',
    fontWeight:
      style.fontWeight ?? layer.fontWeight ?? (layer.bold ? 700 : 400),
    italic: style.italic ?? layer.italic ?? false,
    underline: style.underline ?? layer.underline ?? false,
    strike: style.strike ?? layer.strike ?? false,
    color: style.color ?? layer.color ?? '#000000',
    background: style.background ?? layer.textBackground ?? 'transparent',
    letterSpacing: style.letterSpacing ?? layer.letterSpacing ?? 0,
  };
}
