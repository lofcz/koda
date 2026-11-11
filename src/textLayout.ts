import type { Layer, Point, Rect } from './model';
import {
  graphemes,
  normalizeTextRuns,
  resolveTextStyle,
  sameTextStyle,
} from './textModel';
import type { ResolvedTextStyle } from './textModel';

export type TextMeasure = (
  text: string,
  style: ResolvedTextStyle
) => {
  width: number;
  ascent?: number;
  descent?: number;
};
export type TextSpan = {
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  baseline: number;
  style: ResolvedTextStyle;
};
export type TextLine = {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  spans: TextSpan[];
};
export type TextLayout = {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  lines: TextLine[];
  /** The same measurer is used for wrapping, glyph paint and caret geometry. */
  measure: TextMeasure;
};
type Atom = {
  text: string;
  start: number;
  end: number;
  style: ResolvedTextStyle;
};

function spansFor(atoms: readonly Atom[], measure: TextMeasure): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const atom of atoms) {
    const previous = spans[spans.length - 1];
    if (previous && sameTextStyle(previous.style, atom.style)) {
      previous.text += atom.text;
      previous.end = atom.end;
    } else spans.push({ ...atom, x: 0, y: 0, width: 0, baseline: 0 });
  }
  let x = 0;
  for (const span of spans) {
    span.x = x;
    span.width = Math.max(0, measure(span.text, span.style).width);
    x += span.width;
  }
  return spans;
}
const spansWidth = (spans: readonly TextSpan[]) =>
  spans.reduce((n, span) => n + span.width, 0);
const breakAfter = (atom: Atom) =>
  /[\t \u200b-]$|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(
    atom.text
  );
function withoutTrailingSpaces(atoms: readonly Atom[]) {
  let end = atoms.length;
  while (end && /^[\t \u200b]+$/.test(atoms[end - 1].text)) end--;
  return atoms.slice(0, end);
}

/** Text dimensions are local pixels; transforms never alter wrapping or the saved font size. */
export function layoutText(layer: Layer, measure: TextMeasure): TextLayout {
  const defaults = resolveTextStyle(layer),
    runs = normalizeTextRuns(layer.textRuns ?? [{ text: layer.text ?? '' }]);
  const atoms: Atom[] = [];
  let offset = 0;
  for (const run of runs) {
    const style = resolveTextStyle(layer, run.style);
    for (const cluster of graphemes(run.text))
      atoms.push({
        ...cluster,
        start: cluster.start + offset,
        end: cluster.end + offset,
        style,
      });
    offset += run.text.length;
  }
  const mode = layer.textLayout ?? 'auto-width',
    wrap = mode !== 'auto-width';
  const maxWidth = Math.max(0.001, layer.width),
    factor = layer.lineHeight ?? 1.2;
  const lines: TextLine[] = [];
  let y = 0;
  const addLine = (
    content: readonly Atom[],
    emptyOffset: number,
    emptyStyle = defaults
  ) => {
    const spans = spansFor(content, measure);
    const styles = spans.length
      ? spans.map((span) => span.style)
      : [emptyStyle];
    let ascent = 0,
      descent = 0,
      size = 0;
    for (const style of styles) {
      const metrics = measure('Mg', style);
      ascent = Math.max(ascent, metrics.ascent ?? style.fontSize * 0.8);
      descent = Math.max(descent, metrics.descent ?? style.fontSize * 0.2);
      size = Math.max(size, style.fontSize);
    }
    const height = size * factor,
      baseline = y + (height - ascent - descent) / 2 + ascent;
    spans.forEach((span) => {
      span.y = y;
      span.baseline = baseline;
    });
    lines.push({
      start: content[0]?.start ?? emptyOffset,
      end: content[content.length - 1]?.end ?? emptyOffset,
      x: 0,
      y,
      // CSS pre-wrap preserves trailing spaces but hangs them outside the
      // alignment/wrapping width, so a full word does not gain a blank line.
      width: wrap
        ? spansWidth(spansFor(withoutTrailingSpaces(content), measure))
        : spansWidth(spans),
      height,
      baseline,
      spans,
    });
    y += height;
  };
  const addParagraph = (
    paragraph: readonly Atom[],
    start: number,
    emptyStyle: ResolvedTextStyle
  ) => {
    if (!wrap || !paragraph.length) {
      addLine(paragraph, start, emptyStyle);
      return;
    }
    let line: Atom[] = [],
      token: Atom[] = [];
    const width = (items: readonly Atom[]) =>
      spansWidth(spansFor(withoutTrailingSpaces(items), measure));
    const appendToken = () => {
      if (!token.length) return;
      if (line.length && width([...line, ...token]) > maxWidth) {
        addLine(line, start);
        line = [];
      }
      if (width(token) > maxWidth) {
        let consumed = 0;
        while (consumed < token.length) {
          // Exponential search bounds work by the visible line length rather
          // than repeatedly measuring the entire remainder of a long word.
          const remaining = token.length - consumed;
          let low = 1,
            high = Math.min(2, remaining);
          while (
            high < remaining &&
            width(token.slice(consumed, consumed + high)) <= maxWidth
          ) {
            low = high;
            high = Math.min(remaining, high * 2);
          }
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (width(token.slice(consumed, consumed + middle)) <= maxWidth)
              low = middle;
            else high = middle - 1;
          }
          const part = token.slice(consumed, consumed + low);
          consumed += low;
          // A single grapheme can exceed the box, but is never split or dropped.
          if (consumed < token.length || width(part) > maxWidth)
            addLine(part, part[0].start);
          else line = line.concat(part);
        }
      } else {
        line = line.concat(token);
      }
      token = [];
    };
    for (const atom of paragraph) {
      token.push(atom);
      if (breakAfter(atom)) appendToken();
    }
    appendToken();
    if (line.length) addLine(line, start);
  };
  let paragraph: Atom[] = [],
    start = 0,
    emptyStyle = defaults;
  for (const atom of atoms) {
    if (/^(?:\r\n|\r|\n)$/.test(atom.text)) {
      addParagraph(paragraph, start, emptyStyle);
      paragraph = [];
      start = atom.end;
      emptyStyle = atom.style;
    } else paragraph.push(atom);
  }
  addParagraph(paragraph, start, emptyStyle);
  const contentWidth = lines.reduce((n, line) => Math.max(n, line.width), 0);
  // Legacy state keeps its saved alignment box until the first measured edit.
  const width =
    wrap || layer.textLayout === undefined
      ? maxWidth
      : Math.max(defaults.fontSize, contentWidth);
  const height = mode === 'fixed' ? layer.height : y;
  for (const line of lines) {
    const x =
      layer.textAlign === 'right'
        ? width - line.width
        : layer.textAlign === 'center'
          ? (width - line.width) / 2
          : 0;
    line.x = x;
    line.spans.forEach((span) => {
      span.x += x;
    });
  }
  return { width, height, contentWidth, contentHeight: y, lines, measure };
}

function boundary(text: string, index: number, end = false): number {
  const i = Math.max(0, Math.min(text.length, index));
  for (const cluster of graphemes(text))
    if (i > cluster.start && i < cluster.end)
      return end ? cluster.end : cluster.start;
  return i;
}
function spanPosition(
  layout: TextLayout,
  span: TextSpan,
  index: number,
  end = false
) {
  const offset = boundary(span.text, index - span.start, end);
  return (
    span.x +
    (offset === span.text.length
      ? span.width
      : Math.max(
          0,
          layout.measure(span.text.slice(0, offset), span.style).width
        ))
  );
}
/** Caret location on the downstream line at a soft wrap, in text-local coordinates. */
export function textCaret(layout: TextLayout, index: number): Rect {
  const line =
    [...layout.lines].reverse().find((item) => index >= item.start) ??
    layout.lines[0];
  const span =
    line.spans.find((item) => index < item.end) ??
    line.spans[line.spans.length - 1];
  const x = span ? spanPosition(layout, span, index) : line.x;
  return { x, y: line.y, width: 0, height: line.height };
}
export function textSelectionRects(
  layout: TextLayout,
  start: number,
  end: number
): Rect[] {
  const left = Math.min(start, end),
    right = Math.max(start, end);
  if (left === right) return [];
  const result: Rect[] = [];
  for (const line of layout.lines) {
    if (right <= line.start || left >= line.end) continue;
    const first = line.spans.find((span) => left < span.end),
      last = [...line.spans].reverse().find((span) => right > span.start);
    if (!first || !last) continue;
    const x = spanPosition(layout, first, left),
      endX = spanPosition(layout, last, right, true);
    result.push({
      x,
      y: line.y,
      width: Math.max(0, endX - x),
      height: line.height,
    });
  }
  return result;
}
/** Hit-test a caret without materializing quadratic prefix measurements for every layout. */
export function textIndexAt(layout: TextLayout, point: Point): number {
  const line =
    layout.lines.find((item) => point.y < item.y + item.height) ??
    layout.lines[layout.lines.length - 1];
  const span =
    line.spans.find((item) => point.x <= item.x + item.width) ??
    line.spans[line.spans.length - 1];
  if (!span) return line.start;
  let previousX = span.x;
  for (const cluster of graphemes(span.text)) {
    const x = spanPosition(layout, span, span.start + cluster.end);
    if (point.x <= (previousX + x) / 2) return span.start + cluster.start;
    previousX = x;
  }
  return span.end;
}
