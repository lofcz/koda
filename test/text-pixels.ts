import {
  createDocument,
  IDENTITY,
  parseDocument,
  type Layer,
} from '../src/model';
import {
  exportCanvas,
  fitTextLayer,
  measureTextLayer,
  paintDocument,
  renderLayer,
} from '../src/render';
import { textCaret, textSelectionRects } from '../src/textLayout';
import { graphemes, resolveTextStyle } from '../src/textModel';

export function verifyTextPixels() {
  const check = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const make = (width = 320, height = 200) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const rgba = (canvas: HTMLCanvasElement, x: number, y: number) => [
    ...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data,
  ];
  const count = (
    canvas: HTMLCanvasElement,
    predicate: (r: number, g: number, b: number, a: number) => boolean
  ) => {
    const data = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let result = 0;
    for (let i = 0; i < data.length; i += 4)
      if (predicate(data[i], data[i + 1], data[i + 2], data[i + 3])) result++;
    return result;
  };
  const base: Layer = {
    id: 'text',
    kind: 'text',
    matrix: IDENTITY,
    width: 100,
    height: 50,
    text: 'ABCD',
    textLayout: 'auto-width',
    fontFamily: 'monospace',
    fontSize: 24,
    lineHeight: 1.2,
    color: '#000000',
    fill: 'transparent',
    opacity: 1,
    strokeWidth: 0,
  };
  const tracked = measureTextLayer({ ...base, letterSpacing: 4 }),
    plain = measureTextLayer(base);
  check(
    Math.abs(tracked.contentWidth - plain.contentWidth - 16) < 0.01,
    'Canvas tracking is measured for every grapheme, including the trailing advance'
  );
  const mixed = fitTextLayer({
    ...base,
    textRuns: [
      {
        text: 'AB',
        style: {
          color: '#ff0000',
          background: '#ffff00',
          underline: true,
          fontWeight: 900,
        },
      },
      {
        text: 'CD',
        style: { color: '#0000ff', strike: true, fontWeight: 400 },
      },
    ],
  });
  const canvas = make();
  renderLayer(canvas.getContext('2d')!, mixed);
  check(
    count(canvas, (r, g, b, a) => r > 200 && g < 30 && b < 30 && a > 200) > 80,
    'First text run renders red glyphs'
  );
  check(
    count(canvas, (r, g, b, a) => b > 200 && r < 30 && g < 30 && a > 200) > 70,
    'Second text run renders blue glyphs'
  );
  check(
    rgba(canvas, 0, 0).join() === '255,255,0,255',
    'Inline highlight covers its line box'
  );
  const layout = measureTextLayer(mixed),
    left = layout.lines[0].spans[0],
    right = layout.lines[0].spans[1];
  check(
    rgba(canvas, Math.floor(right.x + 2), 0)[3] === 0,
    'Highlight stops at the run boundary'
  );
  check(
    rgba(canvas, 1, Math.floor(left.baseline + 24 * 0.1 + 1))[0] > 200,
    'Underline uses run color and baseline'
  );
  check(
    rgba(
      canvas,
      Math.floor(right.x + 1),
      Math.floor(right.baseline - 24 * 0.3 + 1)
    )[2] > 200,
    'Strike uses run color and baseline'
  );
  const light = make(),
    heavy = make();
  renderLayer(light.getContext('2d')!, { ...base, fontWeight: 400 });
  renderLayer(heavy.getContext('2d')!, { ...base, fontWeight: 900 });
  check(
    heavy.toDataURL() !== light.toDataURL(),
    'Font weights change actual output'
  );
  // Compare the actual browser editing layout with canvas wrapping, including
  // trailing spaces at a full line and unbreakable emoji clusters.
  for (const text of ['hello world', 'one two three four', 'A👨‍👩‍👧‍👦B C']) {
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      padding: '0',
      border: '0',
      fontFamily: base.fontFamily,
      fontSize: '24px',
      lineHeight: '1.2',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      width: `${measureTextLayer({ ...base, text: 'hello' }).contentWidth + 0.1}px`,
    });
    const node = document.createTextNode(text);
    box.append(node);
    document.body.append(box);
    try {
      const domLines: string[] = [];
      let previousY = -Infinity;
      for (const cluster of graphemes(text)) {
        if (/^\s+$/.test(cluster.text)) continue;
        const range = document.createRange();
        range.setStart(node, cluster.start);
        range.setEnd(node, cluster.end);
        const bounds = range.getBoundingClientRect();
        if (Math.abs(bounds.y - previousY) > 1) {
          domLines.push('');
          previousY = bounds.y;
        }
        domLines[domLines.length - 1] += cluster.text;
      }
      const measured = measureTextLayer({
        ...base,
        text,
        width: parseFloat(box.style.width),
        textLayout: 'auto-height',
      });
      check(
        JSON.stringify(
          measured.lines.map((line) =>
            line.spans
              .map((span) => span.text)
              .join('')
              .replace(/\s/g, '')
          )
        ) === JSON.stringify(domLines),
        `Canvas wrapping matches the editing DOM for ${text}`
      );
    } finally {
      box.remove();
    }
  }
  const baselineBox = document.createElement('div');
  Object.assign(baselineBox.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    fontFamily: 'monospace',
    fontSize: '24px',
    lineHeight: '1.2',
    whiteSpace: 'pre',
    width: '300px',
  });
  const baselineText = {
    ...base,
    textRuns: [{ text: 'AB' }, { text: 'CD', style: { fontSize: 40 } }],
  };
  for (const run of baselineText.textRuns) {
    const span = document.createElement('span'),
      style = resolveTextStyle(baselineText, run.style);
    span.style.fontSize = `${style.fontSize}px`;
    span.textContent = run.text;
    baselineBox.append(span);
  }
  const marker = document.createElement('span');
  Object.assign(marker.style, {
    display: 'inline-block',
    height: '0',
    width: '0',
    verticalAlign: 'baseline',
  });
  baselineBox.append(marker);
  document.body.append(baselineBox);
  try {
    const baseline =
      marker.getBoundingClientRect().top -
      baselineBox.getBoundingClientRect().top;
    check(
      Math.abs(measureTextLayer(baselineText).lines[0].baseline - baseline) < 1,
      'Mixed-size text shares the editing DOM baseline'
    );
  } finally {
    baselineBox.remove();
  }
  const wrapped = fitTextLayer({
    ...base,
    text: 'one two three four',
    textLayout: 'auto-height',
    width: 90,
  });
  const wrappedLayout = measureTextLayer(wrapped);
  check(
    wrappedLayout.lines.length >= 3 &&
      wrapped.height === wrappedLayout.contentHeight,
    'Width-constrained text reflows and grows vertically'
  );
  check(
    wrappedLayout.lines.every((line) => line.width <= wrapped.width),
    'Wrapped lines fit the owned width'
  );
  check(
    wrapped.fontSize === 24 && wrapped.matrix === IDENTITY,
    'Reflow does not scale fonts or transforms'
  );
  const fixed = {
      ...wrapped,
      textLayout: 'fixed' as const,
      height: 18,
      fill: '#00ff00',
    },
    clipped = make();
  renderLayer(clipped.getContext('2d')!, fixed);
  check(
    rgba(clipped, 4, 17)[3] > 0 && rgba(clipped, 4, 18)[3] === 0,
    'Fixed height clips background and glyph output'
  );
  check(
    count(clipped, (_r, _g, _b, a) => a > 0) <= fixed.width * fixed.height,
    'Fixed box paints no pixels outside its bounds'
  );
  const narrow = fitTextLayer({
    ...base,
    text: '👨‍👩‍👧‍👦A\u0301Z',
    textLayout: 'auto-height',
    width: 1,
  });
  check(
    measureTextLayer(narrow)
      .lines.map((line) => line.spans.map((span) => span.text).join(''))
      .join('|') === '👨‍👩‍👧‍👦|A\u0301|Z',
    'Oversize graphemes wrap as indivisible units'
  );
  const selectable = fitTextLayer({
    ...base,
    text: 'A👨‍👩‍👧‍👦BC',
    textLayout: 'auto-width',
  });
  const selection = measureTextLayer(selectable),
    caret = textCaret(selection, 3),
    rectangles = textSelectionRects(selection, 3, 12);
  check(
    caret.x === textCaret(selection, 1).x && rectangles.length === 1,
    'Selection offsets snap to whole graphemes'
  );
  const transformed = { ...mixed, matrix: [1, 0.15, 0.2, 1, 35, 20] as const },
    savedDocument = parseDocument({
      ...createDocument(320, 200),
      layers: [transformed],
    });
  const source = make(),
    exported = exportCanvas(savedDocument, source),
    preview = make();
  paintDocument(preview.getContext('2d')!, savedDocument, source);
  check(
    preview.toDataURL() === exported.toDataURL(),
    'Mixed rich text with affine transform previews exactly as exported'
  );
  check(
    exportCanvas(
      parseDocument(JSON.stringify(savedDocument)),
      source
    ).toDataURL() === exported.toDataURL(),
    'Saved rich text renders identical pixels after validation/reopen'
  );
  return {
    richTextPixels: true,
    trackingAndWeights: true,
    textWrappingAndClipping: true,
    graphemeSelection: true,
    richTextRoundTrip: true,
    textDomMetrics: true,
  };
}
