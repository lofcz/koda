// @vitest-environment node
import {
  createDocument,
  parseDocument,
  MAX_DIMENSION,
  MAX_PIXELS,
  layoutText,
  normalizeTextRuns,
  textContent,
} from '../src/document';
import type { ImageDocument } from '../src/document';

it('validates serialized documents in a Node environment without browser globals', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  const doc: ImageDocument = createDocument(640, 480);
  expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  expect(() => parseDocument({ ...doc, width: MAX_DIMENSION + 1 })).toThrow();
  expect(MAX_PIXELS).toBeGreaterThan(MAX_DIMENSION);
});

it('validates and lays out structured text on the server with an explicit font measurer', () => {
  const document = parseDocument({
    ...createDocument(200, 100),
    layers: [
      {
        id: 'rich',
        kind: 'text',
        matrix: [1, 0, 0, 1, 0, 0],
        width: 24,
        height: 20,
        fontSize: 12,
        lineHeight: 1,
        textLayout: 'auto-height',
        textRuns: normalizeTextRuns([
          { text: 'A👨‍👩‍👧‍👦' },
          { text: 'BC', style: { fontWeight: 900, background: '#ff0' } },
        ]),
      },
    ],
  });
  const layer = document.layers[0];
  expect(textContent(layer)).toBe('A👨‍👩‍👧‍👦BC');
  const layout = layoutText(layer, (text) => ({
    width:
      [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          text
        ),
      ].length * 12,
  }));
  expect(
    layout.lines.map((line) => line.spans.map((span) => span.text).join(''))
  ).toEqual(['A👨‍👩‍👧‍👦', 'BC']);
  expect(layout.height).toBe(24);
  expect(typeof window).toBe('undefined');
});
