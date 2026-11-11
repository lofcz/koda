import { describe, expect, it } from 'vitest';
import {
  formatRichText,
  equalRichText,
  htmlToRichText,
  normalizeRichText,
  replaceRichText,
  readRichText,
  richTextToHtml,
  selectedTextStyle,
} from '../src/richText';
import { resizeTextBox } from '../src/interactions';
import { transform, type Layer } from '../src/model';

describe('rich text selection and paste ownership', () => {
  it('distinguishes an empty editor caret placeholder from a pasted line break', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<br>';
    expect(readRichText(editor, true)).toEqual({ text: '', runs: [] });
    expect(htmlToRichText('<br>').text).toBe('\n');
  });
  it('resolves omitted default flags before comparing host editor echoes', () => {
    expect(
      equalRichText(
        { text: 'Text' },
        {
          text: 'Text',
          runs: [
            {
              text: 'Text',
              style: {
                fontWeight: 400,
                italic: false,
                underline: false,
                strike: false,
                background: 'transparent',
                letterSpacing: 0,
              },
            },
          ],
        },
        { fontSize: 40, fontFamily: 'sans-serif', color: '#f00' }
      )
    ).toBe(true);
  });
  it('treats materialized defaults and browser CSS spellings as the same content', () => {
    expect(
      equalRichText(
        { text: 'Text' },
        {
          text: 'Text',
          runs: [
            {
              text: 'Text',
              style: { color: 'rgb(32, 42, 56)', fontWeight: 400 },
            },
          ],
        },
        { color: '#202a38', fontWeight: 400 }
      )
    ).toBe(true);
    expect(
      equalRichText(
        { text: 'Text' },
        { text: 'Text', runs: [{ text: 'Text', style: { underline: false } }] },
        { underline: true }
      )
    ).toBe(false);
  });
  it('formats only selected UTF16 text and preserves adjacent styles', () => {
    const value = {
      text: 'Alpha Beta',
      runs: [
        { text: 'Alpha ', style: { italic: true } },
        { text: 'Beta', style: { color: '#123456' } },
      ],
    };
    const next = formatRichText(
      value,
      { anchor: 8, focus: 6 },
      { fontWeight: 700 }
    );
    expect(next.runs).toEqual([
      { text: 'Alpha ', style: { italic: true } },
      { text: 'Be', style: { fontWeight: 700, color: '#123456' } },
      { text: 'ta', style: { color: '#123456' } },
    ]);
    expect(value.runs[1]).toEqual({
      text: 'Beta',
      style: { color: '#123456' },
    });
    expect(
      selectedTextStyle(
        next,
        { anchor: 0, focus: 10 },
        { fontWeight: 400, italic: false }
      ).fontWeight
    ).toBeNull();
    expect(
      selectedTextStyle(next, { anchor: 6, focus: 8 }, { fontWeight: 400 })
        .fontWeight
    ).toBe(700);
  });
  it('inserts rich content without splitting surrogate pairs or combining graphemes', () => {
    const value = { text: 'A👩‍🏫éZ' };
    const next = replaceRichText(
      value,
      { anchor: 3, focus: 6 },
      {
        text: 'Teacher',
        runs: [{ text: 'Teacher', style: { underline: true } }],
      }
    );
    expect(next.text).toBe('ATeacheréZ');
    expect(next.runs?.[1]).toEqual({
      text: 'Teacher',
      style: { underline: true },
    });
    expect(normalizeRichText({ text: 'stale', runs: [] }).text).toBe('');
  });
  it('preserves paragraphs, literal markup, inline marks and repeat spaces through safe HTML', () => {
    const pasted = htmlToRichText(
      '<p><strong>A  &lt;B&gt;</strong> <em>italic</em></p><p><span style="color:rgb(1, 2, 3);background-color:yellow;text-decoration:underline line-through;font-size:28px;letter-spacing:2px">last</span></p>'
    );
    expect(pasted.text).toBe('A  <B> italic\nlast');
    expect(pasted.runs?.at(-1)?.style).toMatchObject({
      color: 'rgb(1, 2, 3)',
      background: 'yellow',
      underline: true,
      strike: true,
      fontSize: 28,
      letterSpacing: 2,
    });
    expect(htmlToRichText(richTextToHtml(pasted))).toEqual(pasted);
  });
  it('drops executable markup, linked resources and unsupported attributes', () => {
    const value = htmlToRichText(
      '<script>evil()</script><img src="https://tracker.test/a" onerror="evil()"><a href="javascript:evil()">Safe</a><iframe>evil()</iframe><span style="background-image:url(https://tracker.test/b);font-size:20px" onclick="evil()"> text</span>'
    );
    expect(value.text).toBe('Safe text');
    const html = richTextToHtml(value);
    expect(html).not.toMatch(/href|src|onclick|tracker|evil|background-image/);
    expect(html).toContain('font-size:20px');
  });
  it('keeps empty and trailing paragraphs as authored line breaks', () => {
    expect(htmlToRichText('<p>a</p><p></p><p>b</p>').text).toBe('a\n\nb');
    expect(htmlToRichText('<p>a</p><p></p>').text).toBe('a\n');
    expect(htmlToRichText('<p>a</p><p><br></p><p>b</p>').text).toBe('a\n\nb');
    expect(htmlToRichText('<p></p><p></p>').text).toBe('\n');
  });
});

describe('text layout handles', () => {
  const layer: Layer = {
    id: 'text',
    kind: 'text',
    text: 'A paragraph',
    textLayout: 'auto-width',
    fontSize: 24,
    width: 200,
    height: 40,
    matrix: [1.7, 0.4, -0.3, 0.8, 80, 90],
    color: '#000',
    fill: 'transparent',
    strokeWidth: 0,
    opacity: 1,
  };
  const fit = (item: Layer) => ({
    ...item,
    height:
      item.textLayout === 'fixed'
        ? item.height
        : Math.ceil(200 / item.width) * 40,
  });
  it('resizes width and wraps without distorting an existing affine glyph transform', () => {
    const next = resizeTextBox(
      layer,
      5,
      transform(layer.matrix, { x: 80, y: 20 }),
      fit
    );
    expect(next.width).toBeCloseTo(80);
    expect(next.height).toBe(120);
    expect(next.textLayout).toBe('auto-height');
    expect(next.matrix).toEqual(layer.matrix);
    expect(next.fontSize).toBe(24);
  });
  it('anchors the opposite text-box corner after reflow, including reflected text', () => {
    const reflected = {
      ...layer,
      matrix: [-1.3, 0.4, 0.2, 0.9, 400, 80] as const,
    };
    const opposite = transform(reflected.matrix, { x: 200, y: 40 });
    const next = resizeTextBox(
      reflected,
      0,
      transform(reflected.matrix, { x: 110, y: 30 }),
      fit
    );
    expect(next.matrix.slice(0, 4)).toEqual(reflected.matrix.slice(0, 4));
    const anchor = transform(next.matrix, { x: next.width, y: next.height });
    expect(anchor.x).toBeCloseTo(opposite.x);
    expect(anchor.y).toBeCloseTo(opposite.y);
  });
  it('keeps fixed boxes fixed while their width and height change independently', () => {
    const fixed = { ...layer, textLayout: 'fixed' as const };
    const next = resizeTextBox(
      fixed,
      2,
      transform(fixed.matrix, { x: 120, y: 70 }),
      fit
    );
    expect(next.width).toBeCloseTo(120);
    expect(next.height).toBeCloseTo(70);
    expect(next.matrix).toEqual(layer.matrix);
    expect(next.textLayout).toBe('fixed');
  });
});
