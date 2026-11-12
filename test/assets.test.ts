import { vi } from 'vitest';
import {
  applyFrame,
  createDocument,
  DocumentHistory,
  ImageDocument,
  parseDocument,
  resizeDocument,
} from '../src/model';
import {
  backgroundPlacement,
  parseBackgroundCatalog,
  parseBackgroundImage,
} from '../src/backgrounds';
import {
  frameImageInsets,
  frameMargins,
  nineSlice,
  parseFrameCatalog,
  parseFrameImage,
  sliceScale,
  validSlice,
} from '../src/frames';
import type { FrameImage } from '../src/frames';
import {
  catalogFonts,
  DEFAULT_FONTS,
  documentFamilies,
  fontRegistry,
  nearestWeight,
  parseFontCatalog,
  primaryFamily,
  waitForFonts,
} from '../src/fonts';
import { CanvasEngine, documentAssetSources } from '../src/engine';
import { parseDocument as parseServerDocument } from '../src/document';

const PNG = 'data:image/png;base64,AAAA';
const frameImage = (patch: Partial<FrameImage> = {}): FrameImage => ({
  source: PNG,
  sourceWidth: 30,
  sourceHeight: 30,
  slice: { top: 10, right: 10, bottom: 10, left: 10 },
  repeat: 'stretch',
  ...patch,
});
const withFrame = (
  doc: ImageDocument,
  frame: Partial<ImageDocument['frame']>
) => ({ ...doc, frame: { ...doc.frame, ...frame } }) as ImageDocument;

describe('document schema', () => {
  it('older documents parse without gaining background or frame keys', () => {
    const old = JSON.parse(JSON.stringify(createDocument(200, 100)));
    const parsed = parseDocument(old);
    expect(parsed).toEqual(createDocument(200, 100));
    expect('backgroundImage' in parsed).toBe(false);
    expect(parsed.frame).toEqual({
      style: 'none',
      color: '#ffffff',
      width: 16,
    });
  });
  it('background images fill defaults, round trip and reject bad values', () => {
    const doc = {
      ...createDocument(200, 100),
      backgroundImage: { source: PNG },
    };
    const parsed = parseDocument(doc);
    expect(parsed.backgroundImage).toEqual({
      source: PNG,
      fit: 'cover',
      position: { x: 0.5, y: 0.5 },
      scale: 1,
      opacity: 1,
    });
    expect(parseDocument(JSON.stringify(parsed))).toEqual(parsed);
    expect(parseServerDocument(JSON.stringify(parsed))).toEqual(parsed);
    for (const backgroundImage of [
      { source: 'javascript:alert(1)' },
      { source: PNG, fit: 'tile' },
      { source: PNG, position: { x: 2, y: 0 } },
      { source: PNG, position: null },
      { source: PNG, scale: 0 },
      { source: PNG, opacity: 1.5 },
      'data:image/png;base64,AAAA',
    ])
      expect(() => parseDocument({ ...doc, backgroundImage })).toThrow();
  });
  it('image frames require valid pixels and slice insets', () => {
    const doc = withFrame(createDocument(200, 100), {
      style: 'image',
      width: 20,
      placement: 'outside',
      image: frameImage({ id: 'tiles', repeat: 'round' }),
    });
    const parsed = parseDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.frame).toEqual(doc.frame);
    expect(parseServerDocument(doc).frame).toEqual(doc.frame);
    const bad = (frame: Partial<ImageDocument['frame']>) =>
      expect(() => parseDocument(withFrame(doc, frame))).toThrow();
    bad({ image: undefined });
    bad({ placement: 'beside' as 'inside' });
    bad({
      image: frameImage({ slice: { top: 0, right: 0, bottom: 0, left: 0 } }),
    });
    bad({
      image: frameImage({
        slice: { top: 10, right: 20, bottom: 10, left: 11 },
      }),
    });
    bad({
      image: frameImage({ slice: { top: 16, right: 1, bottom: 15, left: 1 } }),
    });
    bad({
      image: frameImage({ slice: { top: -1, right: 1, bottom: 1, left: 1 } }),
    });
    bad({ image: frameImage({ sourceWidth: 30.5 }) });
    bad({ image: frameImage({ source: 'file:///etc/passwd' }) });
    bad({ image: frameImage({ repeat: 'mirror' as 'repeat' }) });
    // A uniform number is accepted as shorthand and stored expanded.
    expect(parseFrameImage({ ...frameImage(), slice: 5 }).slice).toEqual({
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    });
    // Vector frames may keep an unused image; restoring them still works.
    expect(parseDocument(withFrame(doc, { style: 'solid' })).frame.style).toBe(
      'solid'
    );
  });
  it('resizing scales frame width and background tiles with the document', () => {
    const doc = {
      ...withFrame(createDocument(200, 100), {
        style: 'image',
        width: 20,
        image: frameImage(),
      }),
      backgroundImage: parseBackgroundImage({
        source: PNG,
        fit: 'repeat',
        scale: 2,
      }),
    };
    const resized = resizeDocument(doc, 100, 50);
    expect(resized.frame.width).toBe(10);
    expect(resized.backgroundImage!.scale).toBe(1);
    expect(resized.frame.image).toBe(doc.frame.image);
  });
});

describe('background geometry', () => {
  const area = { width: 300, height: 200 },
    image = { width: 40, height: 20 };
  const place = (patch: object) =>
    backgroundPlacement(
      { fit: 'cover', position: { x: 0.5, y: 0.5 }, scale: 1, ...patch },
      image,
      area
    );
  it('cover, contain and stretch follow CSS sizing and percentage anchors', () => {
    expect(place({})).toEqual({
      mode: 'single',
      x: -50,
      y: 0,
      width: 400,
      height: 200,
    });
    expect(place({ position: { x: 0, y: 0 } }).x + 0).toBe(0);
    expect(place({ position: { x: 1, y: 1 } }).x).toBe(-100);
    expect(place({ fit: 'contain' })).toEqual({
      mode: 'single',
      x: 0,
      y: 25,
      width: 300,
      height: 150,
    });
    expect(place({ fit: 'stretch' })).toEqual({
      mode: 'single',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });
  it('tiles start inside one tile of the origin and scale with the image', () => {
    expect(place({ fit: 'repeat', position: { x: 0, y: 0 } })).toEqual({
      mode: 'tile',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
    });
    // (300 - 80) / 2 = 110 → 110 mod 80 = 30 → -50; (200 - 40) / 2 = 80 → 0.
    expect(place({ fit: 'repeat', scale: 2 })).toEqual({
      mode: 'tile',
      x: -50,
      y: 0,
      width: 80,
      height: 40,
    });
  });
});

describe('9-slice frames', () => {
  const natural = { width: 30, height: 30 };
  const corners = (area: { width: number; height: number }) =>
    nineSlice(frameImage(), natural, 20, area).slice(0, 4);
  it('corners keep their size and aspect at any canvas size', () => {
    const small = corners({ width: 180, height: 120 }),
      large = corners({ width: 900, height: 300 });
    expect(
      small.map((piece) => [piece.target.width, piece.target.height])
    ).toEqual([
      [20, 20],
      [20, 20],
      [20, 20],
      [20, 20],
    ]);
    expect(large.map((piece) => piece.target.width)).toEqual([20, 20, 20, 20]);
    expect(large[2].target).toEqual({ x: 880, y: 280, width: 20, height: 20 });
    expect(small[2].source).toEqual({ x: 20, y: 20, width: 10, height: 10 });
  });
  it('edges stretch, repeat whole tiles or repeat centered and clipped', () => {
    const area = { width: 300, height: 200 };
    const top = (repeat: FrameImage['repeat']) =>
      nineSlice(frameImage({ repeat }), natural, 20, area).filter(
        (piece) => piece.target.y === 0 && piece.source.x === 10
      );
    expect(top('stretch').map((piece) => piece.target)).toEqual([
      { x: 20, y: 0, width: 260, height: 20 },
    ]);
    const round = top('round');
    expect(round).toHaveLength(13);
    expect(round.every((piece) => piece.target.width === 20)).toBe(true);
    const repeat = top('repeat');
    // 260 / 20 = 13 tiles, centered: the first starts exactly at the corner.
    expect(repeat[0].target.x).toBe(20);
    expect(repeat.every((piece) => piece.clip)).toBe(true);
    const odd = nineSlice(frameImage({ repeat: 'repeat' }), natural, 20, {
      width: 310,
      height: 200,
    }).filter((piece) => piece.target.y === 0 && piece.source.x === 10);
    // 270 px edge: the middle tile is centered at 155, ends are clipped.
    expect(odd).toHaveLength(15);
    expect(odd[7].target.x + 10).toBe(155);
    expect(odd[0].target.x).toBe(5);
    expect(odd[0].clip).toEqual({ x: 20, y: 0, width: 270, height: 20 });
    expect(odd.at(-1)!.target.x + 20).toBe(305);
  });
  it('the center stays empty and small canvases shrink every slice uniformly', () => {
    const pieces = nineSlice(frameImage(), natural, 20, {
      width: 30,
      height: 200,
    });
    expect(
      pieces.some((piece) => piece.source.x === 10 && piece.source.y === 10)
    ).toBe(false);
    expect(sliceScale(frameImage(), 20, { width: 30, height: 200 })).toBe(1.5);
    expect(pieces[0].target).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });
  it('insets follow a resized source file proportionally', () => {
    const pieces = nineSlice(frameImage(), { width: 60, height: 60 }, 20, {
      width: 300,
      height: 200,
    });
    expect(pieces[0].source).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(pieces[0].target.width).toBe(20);
  });
  it('validates insets and scales the widest side to the frame width', () => {
    expect(validSlice({ top: 0, right: 0, bottom: 0, left: 0 }, 9, 9)).toBe(
      false
    );
    expect(validSlice({ top: 4, right: 5, bottom: 5, left: 4 }, 9, 9)).toBe(
      true
    );
    expect(
      frameImageInsets(
        frameImage({ slice: { top: 4, right: 8, bottom: 4, left: 8 } }),
        16
      )
    ).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
  });
});

describe('frame placement', () => {
  const base = createDocument(200, 100);
  it('outside frames grow the canvas and removing them restores it', () => {
    const solid = applyFrame(base, {
      style: 'solid',
      color: '#000',
      width: 10,
      placement: 'outside',
    });
    expect([solid.width, solid.height]).toEqual([220, 120]);
    expect(solid.imageMatrix).toEqual([1, 0, 0, 1, 10, 10]);
    const polaroid = applyFrame(solid, { ...solid.frame, style: 'polaroid' });
    expect([polaroid.width, polaroid.height]).toEqual([220, 140]);
    const wider = applyFrame(polaroid, { ...polaroid.frame, width: 20 });
    expect([wider.width, wider.height]).toEqual([240, 180]);
    const image = applyFrame(wider, {
      ...wider.frame,
      style: 'image',
      width: 12,
      image: frameImage({ slice: { top: 6, right: 3, bottom: 6, left: 3 } }),
    });
    expect([image.width, image.height]).toEqual([212, 124]);
    expect(frameMargins(image.frame)).toEqual({
      top: 12,
      right: 6,
      bottom: 12,
      left: 6,
    });
    const inside = applyFrame(image, { ...image.frame, placement: 'inside' });
    expect([inside.width, inside.height]).toEqual([200, 100]);
    expect(inside.imageMatrix).toEqual(base.imageMatrix);
    const none = applyFrame(image, {
      style: 'none',
      color: '#fff',
      width: 16,
    });
    expect([none.width, none.height]).toEqual([200, 100]);
  });
  it('inside frames never change geometry', () => {
    const framed = applyFrame(base, { style: 'mat', color: '#000', width: 30 });
    expect(framed.imageMatrix).toBe(base.imageMatrix);
    expect([framed.width, framed.height]).toEqual([200, 100]);
  });
});

describe('fonts', () => {
  it('defaults equal the previous fixed list', () => {
    expect(DEFAULT_FONTS.map((font) => [font.label, font.family])).toEqual([
      ['Sans serif', 'sans-serif'],
      ['Serif', 'serif'],
      ['Monospace', 'monospace'],
      ['Arial', 'Arial, sans-serif'],
      ['Georgia', 'Georgia, serif'],
      ['Verdana', 'Verdana, sans-serif'],
      ['Trebuchet MS', '"Trebuchet MS", sans-serif'],
    ]);
    expect(parseFontCatalog(DEFAULT_FONTS)).toEqual(DEFAULT_FONTS);
  });
  it('validates host catalogs', () => {
    const catalog = parseFontCatalog([
      {
        id: 'inter',
        label: 'Inter',
        family: '"Inter", sans-serif',
        group: 'Brand',
        weights: [400, 700],
        styles: ['normal', 'italic'],
        source: [
          { url: ['/inter.woff2', '/inter.woff'], weight: '100 900' },
          {
            url: '/inter-italic.woff2',
            style: 'italic',
            unicodeRange: 'U+0-FF',
          },
        ],
      },
      { id: 'host', label: 'Host', family: 'Host Sans', source: 'host' },
    ]);
    expect(catalog[0].source).toEqual([
      { url: ['/inter.woff2', '/inter.woff'], weight: '100 900' },
      { url: ['/inter-italic.woff2'], style: 'italic', unicodeRange: 'U+0-FF' },
    ]);
    const bad = (font: object) =>
      expect(() =>
        parseFontCatalog([{ id: 'x', label: 'X', family: 'X', ...font }])
      ).toThrow();
    bad({ family: 'X; color: red' });
    bad({ family: 'url(x)' });
    bad({ family: '' });
    bad({ weights: [] });
    bad({ weights: [1200] });
    bad({ styles: ['oblique'] });
    bad({ source: [] });
    bad({ source: [{ url: [] }] });
    bad({ source: [{ url: '/a', weight: 'bold' }] });
    bad({ source: 'cdn' });
    expect(() =>
      parseFontCatalog([
        { id: 'a', label: 'A', family: 'A' },
        { id: 'a', label: 'B', family: 'B' },
      ])
    ).toThrow(/Duplicate/);
    expect(() => parseFontCatalog({})).toThrow();
  });
  it('maps document families to catalog entries without dropping unknown ones', () => {
    expect(primaryFamily('"Trebuchet MS", sans-serif')).toBe('Trebuchet MS');
    expect(primaryFamily("'Inter' , serif")).toBe('Inter');
    expect(primaryFamily('  Georgia, serif')).toBe('Georgia');
    const doc = parseDocument({
      ...createDocument(100, 100),
      layers: [
        {
          id: 't',
          kind: 'text',
          matrix: [1, 0, 0, 1, 0, 0],
          width: 10,
          height: 10,
          text: 'ab',
          fontFamily: 'inter, sans-serif',
          textRuns: [
            { text: 'a' },
            { text: 'b', style: { fontFamily: '"Unknown", cursive' } },
          ],
        },
      ],
    });
    expect(documentFamilies(doc)).toEqual([
      'inter, sans-serif',
      '"Unknown", cursive',
    ]);
    const catalog = parseFontCatalog([
      { id: 'inter', label: 'Inter', family: '"Inter", sans-serif' },
      { id: 'mono', label: 'Mono', family: 'monospace' },
    ]);
    expect(
      catalogFonts(documentFamilies(doc), catalog).map((f) => f.id)
    ).toEqual(['inter']);
    expect(doc.layers[0].textRuns![1].style!.fontFamily).toBe(
      '"Unknown", cursive'
    );
  });
  it('snaps weights to the nearest provided weight', () => {
    const font = { id: 'f', label: 'F', family: 'F', weights: [300, 500, 900] };
    expect(nearestWeight(font, 400)).toBe(500);
    expect(nearestWeight(font, 700)).toBe(900);
    expect(nearestWeight(font, 320)).toBe(300);
    expect(nearestWeight({ ...font, weights: undefined }, 650)).toBe(650);
  });
  it('waits with a deadline and reports unfinished fonts as failed', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    const load = vi.fn(() => new Promise<FontFace[]>(() => {}));
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });
    try {
      const pending = {
        id: 'pending',
        label: 'Pending',
        family: '"Pending Test"',
        source: 'host' as const,
      };
      const system = { id: 'system', label: 'S', family: 'serif' };
      const started = Date.now();
      const result = await waitForFonts([pending, system], 30);
      expect(result).toEqual({ loaded: ['system'], failed: ['pending'] });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(fontRegistry.status(pending)).toBe('loading');
      expect(load).toHaveBeenCalledWith('normal 400 16px "Pending Test"');
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original);
      else delete (document as { fonts?: unknown }).fonts;
    }
  });
});

describe('catalog options', () => {
  it('validates frame and background catalogs', () => {
    expect(
      parseFrameCatalog([{ id: 'a', label: 'A', url: '/a.png', slice: 8 }])
    ).toEqual([
      {
        id: 'a',
        label: 'A',
        url: '/a.png',
        slice: { top: 8, right: 8, bottom: 8, left: 8 },
        repeat: 'stretch',
      },
    ]);
    for (const frame of [
      { slice: 0 },
      { slice: { top: 1 } },
      { repeat: 'mirror' },
      { width: 0 },
      { url: '' },
    ])
      expect(() =>
        parseFrameCatalog([
          { id: 'a', label: 'A', url: '/a.png', slice: 8, ...frame },
        ])
      ).toThrow();
    expect(
      parseBackgroundCatalog([
        { id: 'b', label: 'B', url: '/b.png', fit: 'repeat', scale: 0.5 },
      ])[0]
    ).toEqual({
      id: 'b',
      label: 'B',
      url: '/b.png',
      fit: 'repeat',
      scale: 0.5,
    });
    for (const background of [{ fit: 'tile' }, { scale: 0 }, { id: '' }])
      expect(() =>
        parseBackgroundCatalog([
          { id: 'b', label: 'B', url: '/b.png', ...background },
        ])
      ).toThrow();
  });
});

describe('engine assets', () => {
  it('lists every decoded source a document needs', () => {
    const doc = {
      ...withFrame(createDocument(100, 100), {
        style: 'image',
        image: frameImage({ source: 'https://cdn.test/frame.png' }),
      }),
      backgroundImage: parseBackgroundImage({ source: 'blob:bg' }),
      layers: [
        {
          id: 'i',
          kind: 'image' as const,
          imageSource: PNG,
          matrix: [1, 0, 0, 1, 0, 0] as const,
          width: 1,
          height: 1,
          color: '#000',
          fill: 'transparent',
          strokeWidth: 0,
          opacity: 1,
        },
      ],
    };
    expect(documentAssetSources(doc)).toEqual([
      PNG,
      'blob:bg',
      'https://cdn.test/frame.png',
    ]);
    expect(
      documentAssetSources(withFrame(doc, { style: 'solid' })).includes(
        'https://cdn.test/frame.png'
      )
    ).toBe(false);
  });
  it('restores background and frame pixels through the image loader', async () => {
    const loaded: string[] = [];
    const engine = new CanvasEngine(async (url) => {
      loaded.push(url);
      return { source: {} as CanvasImageSource, width: 30, height: 30 };
    });
    await engine.reset('source');
    await engine.restoreDocument({
      ...withFrame(createDocument(30, 30), {
        style: 'image',
        image: frameImage({ source: 'https://cdn.test/frame.png' }),
      }),
      backgroundImage: parseBackgroundImage({
        source: 'https://cdn.test/bg.png',
      }),
    });
    expect(loaded).toEqual([
      'source',
      'https://cdn.test/bg.png',
      'https://cdn.test/frame.png',
    ]);
    expect(engine.assets.has('https://cdn.test/frame.png')).toBe(true);
    expect(engine.getDocument()!.frame.image!.source).toBe(
      'https://cdn.test/frame.png'
    );
  });
  it('rejects invalid catalogs and reports no fonts for documents without text', async () => {
    const engine = new CanvasEngine(async () => ({
      source: {} as CanvasImageSource,
      width: 10,
      height: 10,
    }));
    await engine.reset('source');
    expect(() =>
      engine.updateOptions({ fonts: [{ id: '', label: 'x', family: 'x' }] })
    ).toThrow();
    expect(() =>
      engine.updateOptions({
        frames: [{ id: 'f', label: 'F', url: '/f.png', slice: -1 }],
      })
    ).toThrow();
    expect(() =>
      engine.updateOptions({
        backgrounds: [{ id: 'b', label: 'B', url: '' }],
      })
    ).toThrow();
    engine.updateOptions({ fonts: DEFAULT_FONTS, fontLoadTimeout: 10 });
    await expect(engine.fontsReady()).resolves.toEqual({
      loaded: [],
      failed: [],
    });
  });
});

describe('history', () => {
  it('derived replacements add no undo step and keep an untouched document unchanged', () => {
    const doc = createDocument(10, 10),
      history = new DocumentHistory(doc);
    const measured = { ...doc };
    history.replace(measured);
    expect(history.changed).toBe(false);
    expect(history.past).toHaveLength(0);
    const edited = { ...doc, cornerRadius: 2 };
    history.commit(edited);
    history.replace({ ...edited });
    expect(history.changed).toBe(true);
    expect(history.past).toHaveLength(1);
    history.undo();
    expect(history.current).toBe(measured);
  });
});
