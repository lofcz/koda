import type { TextRun, TextStyle } from './model';
import { graphemes, normalizeTextRuns, resolveTextStyle } from './textModel';

export type RichTextValue = { text: string; runs?: readonly TextRun[] };
/** UTF-16 offsets, matching DOM selections and JavaScript strings. */
export type TextSelection = { anchor: number; focus: number };
export type TextStyleState = { [K in keyof TextStyle]?: TextStyle[K] | null };

const styleKeys = [
  'italic',
  'underline',
  'strike',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'color',
  'background',
  'letterSpacing',
] as const;

export function normalizeRichText(value: RichTextValue): RichTextValue {
  const source = value.runs ?? [{ text: value.text }];
  const runs = normalizeTextRuns(
    source.map((run) => ({ ...run, text: run.text.replace(/\r\n?/g, '\n') }))
  );
  return { text: runs.map((run) => run.text).join(''), runs };
}

/** Browser CSS canonicalization keeps an unchanged hex/color/font echo from creating an edit. */
export function equalRichText(
  a: RichTextValue,
  b: RichTextValue,
  defaults: TextStyle = {}
): boolean {
  const resolvedDefaults = resolveTextStyle({}, defaults);
  const css =
    typeof document === 'undefined'
      ? null
      : document.createElement('span').style;
  const resolved = (value: RichTextValue) =>
    normalizeRichText({
      text: value.text,
      runs: (value.runs ?? [{ text: value.text }]).map((run) => {
        const style = { ...resolvedDefaults, ...run.style };
        if (css) {
          for (const key of ['color', 'background', 'fontFamily'] as const) {
            if (!style[key]) continue;
            const property = key === 'background' ? 'backgroundColor' : key;
            css[property] = '';
            css[property] = style[key];
            if (css[property]) style[key] = css[property];
          }
        }
        return { text: run.text, style };
      }),
    });
  return JSON.stringify(resolved(a)) === JSON.stringify(resolved(b));
}

export function clampTextSelection(
  value: RichTextValue,
  range: TextSelection
): TextSelection {
  const clusters = graphemes(value.text);
  const clamp = (n: number) => {
    const index = Math.max(0, Math.min(value.text.length, n));
    const cluster = clusters.find(
      (item) => item.start < index && item.end > index
    );
    return cluster ? cluster.start : index;
  };
  return { anchor: clamp(range.anchor), focus: clamp(range.focus) };
}

function sliceRuns(value: RichTextValue, from: number, to: number): TextRun[] {
  const result: TextRun[] = [];
  let index = 0;
  for (const run of normalizeRichText(value).runs ?? []) {
    const end = index + run.text.length;
    if (from < end && to > index)
      result.push({
        ...run,
        text: run.text.slice(
          Math.max(0, from - index),
          Math.min(run.text.length, to - index)
        ),
      });
    index = end;
  }
  return result;
}

export function replaceRichText(
  value: RichTextValue,
  selection: TextSelection,
  inserted: RichTextValue
): RichTextValue {
  const range = clampTextSelection(value, selection);
  const from = Math.min(range.anchor, range.focus),
    to = Math.max(range.anchor, range.focus);
  return normalizeRichText({
    text: '',
    runs: [
      ...sliceRuns(value, 0, from),
      ...(normalizeRichText(inserted).runs ?? []),
      ...sliceRuns(value, to, value.text.length),
    ],
  });
}

export function formatRichText(
  value: RichTextValue,
  selection: TextSelection,
  patch: Partial<TextStyle>
): RichTextValue {
  const range = clampTextSelection(value, selection);
  const from = Math.min(range.anchor, range.focus),
    to = Math.max(range.anchor, range.focus);
  if (from === to) return value;
  return normalizeRichText({
    text: '',
    runs: [
      ...sliceRuns(value, 0, from),
      ...sliceRuns(value, from, to).map((run) => ({
        ...run,
        style: { ...run.style, ...patch },
      })),
      ...sliceRuns(value, to, value.text.length),
    ],
  });
}

export function selectedTextStyle(
  value: RichTextValue,
  selection: TextSelection,
  defaults: TextStyle = {}
): TextStyleState {
  const range = clampTextSelection(value, selection);
  const from = Math.min(range.anchor, range.focus),
    to = Math.max(range.anchor, range.focus);
  const runs = sliceRuns(
    value,
    from === to ? Math.max(0, from - 1) : from,
    from === to ? Math.max(1, to) : to
  );
  const styles = (runs.length ? runs : [{ text: '' }]).map((run) => ({
    ...defaults,
    ...run.style,
  }));
  const result: TextStyleState = {};
  for (const key of styleKeys) {
    const value = styles[0][key];
    Object.assign(result, {
      [key]: styles.every((style) => style[key] === value) ? value : null,
    });
  }
  return result;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
const safeCss = (value: string) =>
  !/[<>;{}\\]|url\s*\(|expression\s*\(/i.test(value);

/** Only supported text styles are serialized. No user-authored markup is mounted. */
export function richTextToHtml(
  value: RichTextValue,
  defaults: TextStyle = {}
): string {
  return (normalizeRichText(value).runs ?? [])
    .map(({ text, style }) => {
      const run = { ...defaults, ...style };
      const css: string[] = [];
      if (run.fontWeight !== undefined)
        css.push(`font-weight:${run.fontWeight}`);
      if (run.italic !== undefined)
        css.push(`font-style:${run.italic ? 'italic' : 'normal'}`);
      if (run.underline !== undefined || run.strike !== undefined)
        css.push(
          `text-decoration:${[run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`
        );
      if (run.fontSize !== undefined) css.push(`font-size:${run.fontSize}px`);
      if (run.letterSpacing !== undefined)
        css.push(`letter-spacing:${run.letterSpacing}px`);
      if (run.fontFamily && safeCss(run.fontFamily))
        css.push(`font-family:${run.fontFamily}`);
      if (run.color && safeCss(run.color)) css.push(`color:${run.color}`);
      if (run.background && safeCss(run.background))
        css.push(`background-color:${run.background}`);
      return `<span${css.length ? ` style="${escapeHtml(css.join(';'))}"` : ''}>${escapeHtml(text)}</span>`;
    })
    .join('');
}

const blockTags = new Set([
  'P',
  'DIV',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
]);
const ignoredTags = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'IMG',
  'VIDEO',
  'AUDIO',
  'TEMPLATE',
]);

/** Read formatting and paragraphs without preserving links, resources or executable HTML. */
export function readRichText(
  root: Node,
  emptyCaretPlaceholder = false
): RichTextValue {
  if (
    emptyCaretPlaceholder &&
    root.childNodes.length === 1 &&
    root.firstChild instanceof Element &&
    root.firstChild.tagName === 'BR'
  )
    return { text: '', runs: [] };
  const runs: TextRun[] = [];
  const append = (text: string, style: TextStyle) => {
    if (text) runs.push({ style, text });
  };
  const children = (parent: Node, style: TextStyle) => {
    let previous: Node | null = null;
    for (const child of parent.childNodes) {
      if (child.nodeType === 1 && ignoredTags.has((child as Element).tagName))
        continue;
      const block = (node: Node) =>
        node.nodeType === 1 && blockTags.has((node as Element).tagName);
      if (previous && (block(previous) || block(child))) append('\n', style);
      walk(child, style);
      previous = child;
    }
  };
  const walk = (node: Node, inherited: TextStyle) => {
    if (node.nodeType === 3) {
      append(node.textContent ?? '', inherited);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const element = node.nodeType === 1 ? (node as HTMLElement) : null;
    if (element && ignoredTags.has(element.tagName)) return;
    if (element?.tagName === 'BR') {
      append('\n', inherited);
      return;
    }
    const style = { ...inherited };
    if (element) {
      if (element.tagName === 'B' || element.tagName === 'STRONG')
        style.fontWeight = 700;
      if (element.tagName === 'I' || element.tagName === 'EM')
        style.italic = true;
      if (element.tagName === 'U') style.underline = true;
      if (
        element.tagName === 'S' ||
        element.tagName === 'STRIKE' ||
        element.tagName === 'DEL'
      )
        style.strike = true;
      const css = element.style;
      if (css.fontWeight) {
        const weight =
          css.fontWeight === 'bold'
            ? 700
            : css.fontWeight === 'normal'
              ? 400
              : Number(css.fontWeight);
        if (Number.isFinite(weight) && weight >= 1 && weight <= 1000)
          style.fontWeight = weight;
      }
      if (css.fontStyle)
        style.italic =
          css.fontStyle === 'italic' || css.fontStyle === 'oblique';
      if (css.textDecoration || css.textDecorationLine) {
        style.underline = (
          css.textDecorationLine || css.textDecoration
        ).includes('underline');
        style.strike = (css.textDecorationLine || css.textDecoration).includes(
          'line-through'
        );
      }
      const size = parseFloat(css.fontSize),
        spacing = parseFloat(css.letterSpacing);
      if (
        css.fontSize.endsWith('px') &&
        Number.isFinite(size) &&
        size >= 1 &&
        size <= 8192
      )
        style.fontSize = size;
      if (
        css.letterSpacing.endsWith('px') &&
        Number.isFinite(spacing) &&
        Math.abs(spacing) <= 512
      )
        style.letterSpacing = spacing;
      if (css.fontFamily && safeCss(css.fontFamily))
        style.fontFamily = css.fontFamily;
      if (css.color && safeCss(css.color)) style.color = css.color;
      if (css.backgroundColor && safeCss(css.backgroundColor))
        style.background = css.backgroundColor;
    }
    // Browsers use a sole BR as the caret placeholder in an empty paragraph.
    if (
      element &&
      blockTags.has(element.tagName) &&
      element.childNodes.length === 1 &&
      element.firstChild instanceof Element &&
      element.firstChild.tagName === 'BR'
    )
      return;
    children(node, style);
  };
  children(root, {});
  return normalizeRichText({ text: '', runs });
}

export function htmlToRichText(html: string): RichTextValue {
  return readRichText(new DOMParser().parseFromString(html, 'text/html').body);
}
