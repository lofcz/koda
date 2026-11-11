import {
  createDocument,
  DocumentHistory,
  IDENTITY,
  parseDocument,
  resizeDocument,
  type Layer,
} from '../src/model';
import {
  graphemes,
  normalizeTextRuns,
  resolveTextStyle,
  textContent,
} from '../src/textModel';
import {
  layoutText,
  textCaret,
  textIndexAt,
  textSelectionRects,
  type TextMeasure,
} from '../src/textLayout';

const layer: Layer = {
  id: 'text',
  kind: 'text',
  matrix: IDENTITY,
  width: 45,
  height: 15,
  color: '#123456',
  fill: 'transparent',
  strokeWidth: 0,
  opacity: 1,
  text: 'hello world',
  fontSize: 10,
  fontFamily: 'monospace',
  lineHeight: 1.2,
};
const measure: TextMeasure = (text, style) => ({
  width: graphemes(text).length * (style.fontSize / 2 + style.letterSpacing),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2,
});
const contents = (value: ReturnType<typeof layoutText>) =>
  value.lines.map((line) => line.spans.map((span) => span.text).join(''));

it('normalizes styles and cross-run graphemes without losing content or inherited false values', () => {
  const original = [
    { text: 'A', style: { fontWeight: 700 } },
    { text: '\u0301', style: { fontWeight: 400 } },
    {
      text: 'B',
      style: {
        italic: false,
        underline: false,
        strike: true,
        background: '#ff0',
      },
    },
    {
      text: 'C',
      style: {
        strike: true,
        background: '#ff0',
        italic: false,
        underline: false,
      },
    },
    { text: '' },
  ];
  const runs = normalizeTextRuns(original);
  expect(runs).toEqual([
    { text: 'A\u0301', style: { fontWeight: 700 } },
    {
      text: 'BC',
      style: {
        italic: false,
        underline: false,
        strike: true,
        background: '#ff0',
      },
    },
  ]);
  expect(original[0].text).toBe('A');
  expect(runs[0].style).not.toBe(original[0].style);
  expect(
    resolveTextStyle(
      { ...layer, bold: true, underline: true, italic: true },
      runs[1].style
    )
  ).toMatchObject({
    fontWeight: 700,
    italic: false,
    underline: false,
    strike: true,
    background: '#ff0',
  });
  expect(
    resolveTextStyle({ ...layer, bold: true, fontWeight: 500 }).fontWeight
  ).toBe(500);
  expect(
    normalizeTextRuns([
      { text: '<img src=x onerror=alert(1)>', html: '<script>' },
    ])
  ).toEqual([{ text: '<img src=x onerror=alert(1)>' }]);
});

it.each([
  null,
  {},
  [null],
  [{ text: 12 }],
  [{ text: 'a', style: [] }],
  [{ text: 'a', style: { fontSize: 0 } }],
  [{ text: 'a', style: { fontWeight: 1001 } }],
  [{ text: 'a', style: { letterSpacing: Infinity } }],
  [{ text: 'a', style: { italic: 'yes' } }],
  [{ text: 'a', style: { color: 123 } }],
  [{ text: 'a', style: { fontFamily: 'x'.repeat(513) } }],
  [{ text: 'x'.repeat(1000001) }],
  Array.from({ length: 20001 }, () => ({ text: '' })),
])('rejects malformed or unbounded rich text: %#', (input) => {
  expect(() => normalizeTextRuns(input)).toThrow();
});

it('round-trips rich text as independent plain JSON and keeps old documents compatible', () => {
  const text = {
    ...layer,
    text: 'stale mirror',
    fontWeight: 550,
    letterSpacing: 2,
    textLayout: 'fixed' as const,
    strike: true,
    textBackground: '#ffeebb',
    textRuns: [
      {
        text: 'A\nB',
        style: {
          color: '#f00',
          fontSize: 24,
          fontFamily: 'serif',
          fontWeight: 900,
          letterSpacing: -2,
        },
      },
    ],
  };
  const parsed = parseDocument({ ...createDocument(100, 100), layers: [text] })
    .layers[0];
  expect(parsed).toMatchObject({ ...text, text: 'A\nB' });
  expect(parsed.textRuns).not.toBe(text.textRuns);
  expect(parsed.textRuns![0].style).not.toBe(text.textRuns[0].style);
  expect(textContent(parsed)).toBe('A\nB');
  expect(
    parseDocument({ ...createDocument(100, 100), layers: [layer] }).layers[0]
  ).toMatchObject(layer);
  for (const patch of [
    { textLayout: 'html' },
    { fontWeight: 0 },
    { letterSpacing: -513 },
    { textBackground: 1 },
    { strike: 'yes' },
  ])
    expect(() =>
      parseDocument({
        ...createDocument(100, 100),
        layers: [{ ...layer, ...patch }],
      })
    ).toThrow();
});

it('measures auto-width, wraps auto-height at words, and preserves fixed box dimensions', () => {
  const auto = layoutText({ ...layer, textLayout: 'auto-width' }, measure);
  expect([auto.width, auto.height]).toEqual([55, 12]);
  const wrapped = layoutText({ ...layer, textLayout: 'auto-height' }, measure);
  expect(contents(wrapped)).toEqual(['hello ', 'world']);
  expect([wrapped.width, wrapped.height]).toEqual([45, 24]);
  const fixed = layoutText({ ...layer, textLayout: 'fixed' }, measure);
  expect([fixed.width, fixed.height, fixed.contentHeight]).toEqual([
    45, 15, 24,
  ]);
  expect(contents(fixed)).toEqual(contents(wrapped));
  expect(
    contents(
      layoutText({ ...layer, width: 25, textLayout: 'auto-height' }, measure)
    )
  ).toEqual(['hello ', 'world']);
  expect(
    layoutText({ ...layer, text: '', textLayout: 'auto-width' }, measure)
  ).toMatchObject({ width: 10, height: 12 });
});

it('preserves hard breaks and empty lines, and cannot split emoji/combining clusters when wrapping', () => {
  const value = 'A\u0301👨‍👩‍👧‍👦🇨🇿B';
  const clusters = graphemes(value);
  expect(clusters.map((item) => item.text)).toEqual([
    'A\u0301',
    '👨‍👩‍👧‍👦',
    '🇨🇿',
    'B',
  ]);
  const wrapped = layoutText(
    { ...layer, text: value, width: 6, textLayout: 'auto-height' },
    measure
  );
  expect(contents(wrapped)).toEqual(clusters.map((item) => item.text));
  expect(wrapped.lines.map((line) => [line.start, line.end])).toEqual(
    clusters.map(({ start, end }) => [start, end])
  );
  expect(
    contents(
      layoutText(
        { ...layer, text: 'A\r\n\nB\n', textLayout: 'auto-width' },
        measure
      )
    )
  ).toEqual(['A', '', 'B', '']);
  expect(
    contents(
      layoutText(
        { ...layer, text: '漢字漢字', width: 11, textLayout: 'auto-height' },
        measure
      )
    )
  ).toEqual(['漢字', '漢字']);
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  Object.defineProperty(Intl, 'Segmenter', {
    value: undefined,
    configurable: true,
  });
  try {
    expect(graphemes(value)).toEqual(clusters);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', descriptor);
  }
});

it('aligns mixed sizes on one baseline and uses inherited styles with explicit tracking and font weights', () => {
  const mixed = layoutText(
    {
      ...layer,
      textAlign: 'right',
      textLayout: 'auto-height',
      width: 100,
      textRuns: [
        { text: 'A' },
        {
          text: 'B',
          style: { fontSize: 30, letterSpacing: 2, fontWeight: 600 },
        },
        { text: '\nC' },
      ],
    },
    measure
  );
  expect(mixed.lines.map((line) => line.height)).toEqual([36, 12]);
  expect(mixed.lines[0].x).toBe(78);
  expect(mixed.lines[0].spans.map((span) => span.baseline)).toEqual([27, 27]);
  expect(mixed.lines[0].spans[1].style).toMatchObject({
    color: '#123456',
    fontWeight: 600,
    letterSpacing: 2,
  });
  const center = layoutText(
    {
      ...layer,
      text: 'abc',
      width: 100,
      textAlign: 'center',
      textLayout: 'fixed',
    },
    measure
  );
  expect(center.lines[0].x).toBe(42.5);
  const legacy = layoutText(
    { ...layer, text: 'abc', width: 100, textAlign: 'right' },
    measure
  );
  expect(legacy.lines[0].x).toBe(85);
});

it('uses grapheme-safe UTF16 caret geometry across style boundaries, hard breaks and soft wraps', () => {
  const value = layoutText(
    { ...layer, text: 'A👨‍👩‍👧‍👦B\nC', textLayout: 'auto-height', width: 10 },
    measure
  );
  expect(contents(value)).toEqual(['A👨‍👩‍👧‍👦', 'B', 'C']);
  expect(textCaret(value, 3)).toMatchObject({ x: 5, y: 0 });
  expect(textCaret(value, 12)).toMatchObject({ x: 0, y: 12 });
  expect(textCaret(value, 100)).toMatchObject({ x: 5, y: 24 });
  expect(textIndexAt(value, { x: 6, y: 3 })).toBe(1);
  expect(textIndexAt(value, { x: 9, y: 3 })).toBe(12);
  expect(textIndexAt(value, { x: -50, y: 14 })).toBe(12);
  expect(textSelectionRects(value, 3, 13)).toEqual([
    { x: 5, y: 0, width: 5, height: 12 },
    { x: 0, y: 12, width: 5, height: 12 },
  ]);
  expect(textSelectionRects(value, 1, 1)).toEqual([]);
  const empty = layoutText(
    { ...layer, text: '', textLayout: 'auto-width' },
    measure
  );
  expect(textIndexAt(empty, { x: 1, y: 1 })).toBe(0);
  expect(textCaret(empty, 0)).toEqual({ x: 0, y: 0, width: 0, height: 12 });
});

it('keeps text local geometry immutable through image transformations and undo', () => {
  const original = {
    ...createDocument(100, 100),
    layers: [
      {
        ...layer,
        textLayout: 'auto-height' as const,
        textRuns: [{ text: 'Hello', style: { fontWeight: 900 } }],
      },
    ],
  };
  const history = new DocumentHistory(original);
  history.commit(resizeDocument(original, 200, 50));
  expect(history.current.layers[0]).toMatchObject({
    width: 45,
    fontSize: 10,
    textRuns: original.layers[0].textRuns,
    matrix: [2, 0, 0, 0.5, 0, 0],
  });
  history.undo();
  expect(history.current).toBe(original);
  history.redo();
  expect(layoutText(history.current.layers[0], measure).lines).toEqual(
    layoutText(original.layers[0], measure).lines
  );
});
