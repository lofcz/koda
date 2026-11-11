import { vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { CanvasEngine, LoadedImage } from '../src/engine';
import { cropDocument, pathLayer, resizeDocument } from '../src/model';
import { exportCanvas } from '../src/render';

vi.mock('../src/render', () => ({
  exportCanvas: vi.fn((doc: { width: number; height: number }) => ({
    toDataURL: () => JSON.stringify(doc),
    toBlob: (callback: (blob: Blob) => void) =>
      callback(new Blob([JSON.stringify(doc)], { type: 'image/png' })),
  })),
}));
const image = (width = 100, height = 60): LoadedImage => ({
  source: {} as CanvasImageSource,
  width,
  height,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function ready() {
  const engine = new CanvasEngine(async () => image());
  await engine.reset('initial');
  return engine;
}

it('starts clean and uses presentation updates without losing selection or history', async () => {
  const engine = await ready(),
    doc = engine.getSnapshot().document!,
    layer = pathLayer([{ x: 1, y: 1 }]);
  engine.commit({ ...doc, layers: [layer] });
  engine.select(layer.id);
  engine.updateOptions({ theme: 'dark', locale: 'cs', showActions: false });
  expect(engine.getSnapshot()).toMatchObject({
    selected: layer.id,
    canUndo: true,
    options: { theme: 'dark', locale: 'cs', showActions: false },
  });
  expect(engine.hasChanges()).toBe(true);
  engine.undo();
  expect(engine.hasChanges()).toBe(false);
  engine.redo();
  expect(engine.hasChanges()).toBe(true);
});
it('latest requested image wins even if an older loader ignores abort', async () => {
  const first = deferred<LoadedImage>(),
    second = deferred<LoadedImage>(),
    loader = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
    engine = new CanvasEngine(loader);
  const a = engine.reset('a').catch((error) => error),
    b = engine.reset('b');
  second.resolve(image(200, 100));
  await b;
  first.resolve(image(300, 200));
  expect((await a).name).toBe('AbortError');
  expect(engine.getSnapshot().document).toMatchObject({
    width: 200,
    height: 100,
  });
  expect(engine.getSnapshot().phase).toBe('ready');
});
it('destroy cancels outstanding loads and prevents late results from resurrecting a canvas', async () => {
  const pending = deferred<LoadedImage>(),
    engine = new CanvasEngine(() => pending.promise),
    promise = engine.reset('slow').catch((error) => error);
  engine.destroy();
  pending.resolve(image());
  expect((await promise).name).toBe('AbortError');
  expect(engine.getSnapshot().phase).toBe('destroyed');
  expect(engine.getImage()).toBeNull();
  expect(engine.hasChanges()).toBe(false);
  await expect(engine.reset('other')).rejects.toThrow('destroyed');
  engine.updateOptions({ theme: 'dark' });
  expect(engine.getSnapshot().options.theme).toBeUndefined();
});
it('failed replacement preserves the dirty document, selection, baseline and history', async () => {
  const loader = vi
    .fn()
    .mockResolvedValueOnce(image())
    .mockRejectedValueOnce(new Error('replacement failed'))
    .mockResolvedValueOnce(image());
  const engine = new CanvasEngine(loader);
  await engine.reset('baseline');
  const doc = engine.getSnapshot().document!,
    layer = pathLayer([{ x: 2, y: 2 }]);
  engine.commit({ ...doc, layers: [layer] });
  engine.select(layer.id);
  const edited = engine.getSnapshot().document;
  await expect(engine.reset('broken')).rejects.toThrow('replacement failed');
  expect(engine.getSnapshot()).toMatchObject({
    phase: 'ready',
    document: edited,
    selected: layer.id,
    canUndo: true,
  });
  expect(engine.hasChanges()).toBe(true);
  expect(engine.getImage()).not.toBeNull();
  engine.undo();
  expect(engine.getSnapshot().document).toBe(doc);
  await engine.reset();
  expect(loader.mock.calls[2][0]).toBe('baseline');
});
it('initial failure exposes retryable error state and a later reset recovers', async () => {
  const engine = new CanvasEngine(
    vi
      .fn()
      .mockRejectedValueOnce(new Error('bad image'))
      .mockResolvedValueOnce(image())
  );
  await expect(engine.reset('bad')).rejects.toThrow();
  expect(engine.getSnapshot().phase).toBe('error');
  expect(engine.getImage()).toBeNull();
  await engine.reset('good');
  expect(engine.getSnapshot().phase).toBe('ready');
  expect(engine.hasChanges()).toBe(false);
});
it('StrictMode activation after cleanup starts a fresh load', async () => {
  const engine = await ready();
  engine.destroy();
  engine.activate();
  await engine.reset('again');
  expect(engine.getSnapshot().phase).toBe('ready');
});
it('invalid dimensions fail without replacing the loaded document', async () => {
  const engine = new CanvasEngine(
    vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockResolvedValueOnce(image(100000, 10))
  );
  await engine.reset('good');
  const old = engine.getSnapshot().document;
  await expect(engine.reset('huge')).rejects.toThrow();
  expect(engine.getSnapshot().document).toBe(old);
});
it('change callbacks run synchronously only at commits, and geometry ignores markup movement', async () => {
  const engine = await ready(),
    events: unknown[] = [];
  engine.subscribeChanges((event) => events.push(event));
  const doc = engine.getSnapshot().document!;
  engine.begin();
  for (let i = 0; i < 20; i++)
    engine.preview({ ...doc, layers: [pathLayer([{ x: i, y: 2 }])] });
  expect(events).toHaveLength(0);
  engine.end();
  expect(events).toHaveLength(1);
  const first = events[0] as { geometryKey: string };
  engine.undo();
  expect(events).toHaveLength(2);
  expect((events[1] as { geometryKey: string }).geometryKey).toBe(
    first.geometryKey
  );
  engine.commit(resizeDocument(engine.getSnapshot().document!, 50, 30));
  expect((events[2] as { geometryKey: string }).geometryKey).not.toBe(
    first.geometryKey
  );
});
it('public exports flush the pending crop once and notify the host before returning pixels', async () => {
  const engine = await ready(),
    order: string[] = [],
    changes = vi.fn(() => order.push('change'));
  engine.subscribeChanges(changes);
  const doc = engine.getSnapshot().document!;
  engine.beforeExport(() =>
    engine.commit(cropDocument(doc, { x: 10, y: 5, width: 40, height: 30 }))
  );
  const result = JSON.parse(engine.getImage()!);
  order.push('export');
  expect(result).toMatchObject({ width: 40, height: 30 });
  expect(order).toEqual(['change', 'export']);
  const blob = await engine.getBlob();
  expect(JSON.parse(await blob.text())).toMatchObject({
    width: 40,
    height: 30,
  });
  expect(changes).toHaveBeenCalledTimes(1);
  engine.undo();
  expect(engine.getSnapshot().document).toBe(doc);
});
it('export finalizes text transactions and cancellation keeps history intact', async () => {
  const engine = await ready(),
    doc = engine.getSnapshot().document!;
  engine.begin();
  engine.preview({ ...doc, layers: [pathLayer([{ x: 1, y: 1 }])] });
  engine.getImage();
  expect(engine.getSnapshot().canUndo).toBe(true);
  engine.undo();
  expect(engine.hasChanges()).toBe(false);
  engine.begin();
  engine.preview(resizeDocument(doc, 20, 10));
  engine.cancel();
  expect(engine.getSnapshot().document).toBe(doc);
});
it('successful reset discards the previous image crop before immediate export', async () => {
  const engine = new CanvasEngine(
    vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockResolvedValueOnce(image(250, 150))
  );
  await engine.reset('first');
  const old = engine.getSnapshot().document!;
  engine.beforeExport(() =>
    engine.commit(cropDocument(old, { x: 5, y: 5, width: 20, height: 20 }))
  );
  await engine.reset('second');
  expect(JSON.parse(engine.getImage()!)).toMatchObject({
    width: 250,
    height: 150,
  });
  expect(engine.hasChanges()).toBe(false);
});
it('failed reset retains the pending crop for export of the previous image', async () => {
  const engine = new CanvasEngine(
    vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockRejectedValueOnce(new Error('missing'))
  );
  await engine.reset('first');
  const old = engine.getSnapshot().document!;
  engine.beforeExport(() =>
    engine.commit(cropDocument(old, { x: 5, y: 5, width: 20, height: 20 }))
  );
  await expect(engine.reset('second')).rejects.toThrow();
  expect(JSON.parse(engine.getImage()!)).toMatchObject({
    width: 20,
    height: 20,
  });
  expect(engine.hasChanges()).toBe(true);
});
it('removes only the selected layer and supports clean subscriber teardown', async () => {
  const engine = await ready(),
    changed = vi.fn(),
    unsubscribe = engine.subscribe(changed),
    doc = engine.getSnapshot().document!,
    layer = pathLayer([{ x: 0, y: 0 }]);
  engine.commit({ ...doc, layers: [layer] });
  engine.select(layer.id);
  engine.removeSelected();
  expect(engine.getSnapshot().document!.layers).toEqual([]);
  expect(engine.getSnapshot().selected).toBeNull();
  unsubscribe();
  const calls = changed.mock.calls.length;
  engine.undo();
  expect(changed).toHaveBeenCalledTimes(calls);
});

it('editable snapshots finalize pending UI edits and do not expose live document references', async () => {
  const engine = await ready(),
    original = engine.getSnapshot().document!;
  engine.beforeExport(() =>
    engine.commit(cropDocument(original, { x: 2, y: 3, width: 40, height: 30 }))
  );
  const doc = engine.getDocument()!;
  expect(doc).toMatchObject({ width: 40, height: 30 });
  doc.effects.brightness = 50;
  expect(engine.getSnapshot().document!.effects.brightness).toBe(0);
  engine.undo();
  expect(engine.getSnapshot().document).toBe(original);
});

it('restoring editable state is one undoable change and invalid state preserves pending crop ownership', async () => {
  const engine = await ready(),
    original = engine.getDocument()!,
    restored = resizeDocument(original, 40, 24),
    change = vi.fn();
  engine.subscribeChanges(change);
  await engine.restoreDocument(JSON.stringify(restored));
  expect(engine.getSnapshot().document).toEqual(restored);
  expect(change).toHaveBeenCalledTimes(1);
  engine.undo();
  expect(engine.getSnapshot().document).toEqual(original);
  engine.beforeExport(() =>
    engine.commit(cropDocument(original, { x: 0, y: 0, width: 20, height: 20 }))
  );
  await expect(engine.restoreDocument('{bad')).rejects.toThrow();
  expect(engine.getDocument()).toMatchObject({ width: 20, height: 20 });
});

it('a failed restored sticker keeps the existing document, selection and history intact', async () => {
  const loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockRejectedValueOnce(new Error('sticker failed')),
    engine = new CanvasEngine(loader);
  await engine.reset('base');
  const layer = pathLayer([{ x: 1, y: 1 }]),
    doc = { ...engine.getSnapshot().document!, layers: [layer] };
  engine.commit(doc);
  engine.select(layer.id);
  await expect(
    engine.restoreDocument({
      ...doc,
      layers: [
        { ...layer, kind: 'image', imageSource: 'data:image/png;base64,AA==' },
      ],
    })
  ).rejects.toThrow('sticker failed');
  expect(engine.getSnapshot()).toMatchObject({
    document: doc,
    selected: layer.id,
    canUndo: true,
  });
  expect(engine.assets.size).toBe(0);
});

it('new image resets and later edits cannot be overwritten by delayed document restoration', async () => {
  const pending = deferred<LoadedImage>(),
    loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(image(200, 150)),
    engine = new CanvasEngine(loader);
  await engine.reset('base');
  const doc = engine.getDocument()!,
    restore = engine
      .restoreDocument({
        ...doc,
        layers: [
          {
            ...pathLayer([]),
            kind: 'image',
            imageSource: 'data:image/png;base64,AA==',
          },
        ],
      })
      .catch((error) => error);
  await engine.reset('replacement');
  pending.resolve(image(20, 10));
  expect((await restore).name).toBe('AbortError');
  expect(engine.getSnapshot().document).toMatchObject({
    width: 200,
    height: 150,
    layers: [],
  });
  expect(engine.assets.size).toBe(0);
});

it('later document restoration wins even when an earlier sticker loader ignores abort', async () => {
  const pending = deferred<LoadedImage>(),
    loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockReturnValueOnce(pending.promise),
    engine = new CanvasEngine(loader);
  await engine.reset('base');
  const doc = engine.getDocument()!,
    first = engine
      .restoreDocument({
        ...doc,
        layers: [
          {
            ...pathLayer([]),
            kind: 'image',
            imageSource: 'data:image/png;base64,AA==',
          },
        ],
      })
      .catch((error) => error);
  await engine.restoreDocument(resizeDocument(doc, 20, 12));
  pending.resolve(image(10, 10));
  expect((await first).name).toBe('AbortError');
  expect(engine.getSnapshot().document).toMatchObject({
    width: 20,
    height: 12,
  });
});

it('no-op cleanup, transaction finalization and export reads do not supersede a pending sticker restore', async () => {
  const pending = deferred<LoadedImage>(),
    loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockReturnValueOnce(pending.promise),
    engine = new CanvasEngine(loader);
  await engine.reset('base');
  const original = engine.getSnapshot().document!,
    layer = {
      ...pathLayer([]),
      kind: 'image' as const,
      imageSource: 'data:image/png;base64,AA==',
    },
    restored = { ...resizeDocument(original, 40, 24), layers: [layer] },
    restore = engine.restoreDocument(restored),
    change = vi.fn();
  engine.subscribeChanges(change);
  const revision = engine.getSnapshot().revision;
  engine.cancel();
  engine.end();
  engine.begin();
  engine.end();
  engine.getDocument();
  engine.getImage();
  await engine.getBlob();
  engine.updateOptions({ theme: 'dark' });
  expect(engine.getSnapshot().document).toBe(original);
  expect(engine.getSnapshot().revision).toBeGreaterThan(revision);
  expect(change).not.toHaveBeenCalled();
  pending.resolve(image(10, 10));
  await restore;
  expect(engine.getSnapshot().document).toMatchObject(restored);
  expect(engine.assets.has(layer.imageSource)).toBe(true);
  expect(change).toHaveBeenCalledTimes(1);
  engine.undo();
  expect(engine.getSnapshot().document).toBe(original);
});

it.each(['commit', 'preview', 'commit then undo'] as const)(
  'an actual intervening %s supersedes a pending restore',
  async (action) => {
    const pending = deferred<LoadedImage>(),
      loader = vi
        .fn()
        .mockResolvedValueOnce(image())
        .mockReturnValueOnce(pending.promise),
      engine = new CanvasEngine(loader);
    await engine.reset('base');
    const original = engine.getSnapshot().document!,
      restore = engine
        .restoreDocument({
          ...original,
          layers: [
            {
              ...pathLayer([]),
              kind: 'image',
              imageSource: 'data:image/png;base64,AA==',
            },
          ],
        })
        .catch((error) => error),
      edited = resizeDocument(original, 30, 20);
    if (action === 'preview') {
      engine.begin();
      engine.preview(edited);
    } else {
      engine.commit(edited);
      if (action === 'commit then undo') engine.undo();
    }
    const owned = engine.getSnapshot().document;
    pending.resolve(image(10, 10));
    expect((await restore).name).toBe('AbortError');
    expect(engine.getSnapshot().document).toBe(owned);
    expect(engine.assets.size).toBe(0);
  }
);

it('reverting uses the owned baseline without reloading and undo recovers the complete draft', async () => {
  const engine = await ready(),
    original = engine.getSnapshot().document!,
    edited = resizeDocument(original, 30, 20);
  engine.commit(edited);
  engine.revert();
  expect(engine.getSnapshot().document).toBe(original);
  expect(engine.hasChanges()).toBe(false);
  engine.undo();
  expect(engine.getSnapshot().document).toBe(edited);
});

it('output options are merged at export and encoded quality is validated without changing the document', async () => {
  const engine = await ready(),
    doc = engine.getSnapshot().document!;
  engine.updateOptions({ export: { type: 'image/webp', quality: 0.8 } });
  engine.getImage({ width: 50 });
  expect(exportCanvas).toHaveBeenLastCalledWith(
    doc,
    engine.getSource(),
    { type: 'image/webp', quality: 0.8, width: 50 },
    engine.assets
  );
  await engine.getBlob({ type: 'image/jpeg', background: '#fff' });
  expect(exportCanvas).toHaveBeenLastCalledWith(
    doc,
    engine.getSource(),
    { type: 'image/jpeg', quality: 0.8, background: '#fff' },
    engine.assets
  );
  expect(() => engine.getImage({ quality: 2 })).toThrow('quality');
  expect(engine.getSnapshot().document).toBe(doc);
  expect(engine.hasChanges()).toBe(false);
});

it('invalid export settings leave pending UI work untouched and undefined format retains the default', async () => {
  const engine = await ready(),
    original = engine.getSnapshot().document!,
    finalize = vi.fn(() => engine.commit(resizeDocument(original, 20, 12)));
  engine.beforeExport(finalize);
  for (const options of [
    { width: NaN },
    { height: 0 },
    { width: 8193 },
    { quality: -0.1 },
  ])
    expect(() => engine.getImage(options)).toThrow();
  expect(finalize).not.toHaveBeenCalled();
  expect(engine.getSnapshot().document).toBe(original);
  engine.getImage({ type: undefined });
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(exportCanvas).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 20, height: 12 }),
    engine.getSource(),
    { type: 'image/png' },
    engine.assets
  );
});

it('custom loaders keep abort ownership and locked or hidden layers cannot become a gesture selection', async () => {
  const engine = new CanvasEngine(),
    loader = vi.fn(async () => image());
  engine.updateOptions({ imageLoader: loader });
  await engine.reset('custom');
  expect(loader).toHaveBeenCalledWith('custom', expect.any(AbortSignal));
  const locked = { ...pathLayer([]), locked: true },
    hidden = { ...pathLayer([]), hidden: true };
  engine.commit({
    ...engine.getSnapshot().document!,
    layers: [locked, hidden],
  });
  engine.select(locked.id);
  expect(engine.getSnapshot().selected).toBeNull();
  engine.select(hidden.id);
  expect(engine.getSnapshot().selected).toBeNull();
});

it('sticker import owns an embedded raster and retains its resource across undo and redo', async () => {
  const raster = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
    getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(raster),
    toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,AA==');
  try {
    const engine = await ready(),
      original = engine.getSnapshot().document!,
      change = vi.fn();
    engine.subscribeChanges(change);
    await engine.addImage('blob:temporary');
    const layer = engine.getSnapshot().document!.layers[0];
    expect(layer).toMatchObject({
      kind: 'image',
      imageSource: 'data:image/png;base64,AA==',
      width: 60,
      height: 36,
      matrix: [1, 0, 0, 1, 20, 12],
    });
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(raster.drawImage).toHaveBeenCalledWith(
      engine.getSource(),
      0,
      0,
      100,
      60
    );
    expect(engine.getSnapshot().selected).toBe(layer.id);
    expect(engine.assets.get(layer.imageSource!)).toBeInstanceOf(
      HTMLCanvasElement
    );
    expect(change).toHaveBeenCalledTimes(1);
    engine.undo();
    expect(engine.getSnapshot().document).toBe(original);
    expect(engine.hasChanges()).toBe(false);
    engine.redo();
    expect(engine.getDocument()!.layers[0]).toMatchObject(layer);
    expect(engine.assets.size).toBe(1);
    engine.destroy();
    expect(engine.assets.size).toBe(0);
    expect(engine.getSource()).toBeNull();
  } finally {
    getContext.mockRestore();
    toDataURL.mockRestore();
  }
});

it('failed sticker loading or raster encoding never changes an existing draft', async () => {
  const loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockRejectedValueOnce(new Error('decode failed'))
      .mockResolvedValueOnce(image()),
    engine = new CanvasEngine(loader);
  await engine.reset('base');
  const layer = pathLayer([]),
    doc = { ...engine.getSnapshot().document!, layers: [layer] };
  engine.commit(doc);
  engine.select(layer.id);
  await expect(engine.addImage('broken')).rejects.toThrow('decode failed');
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(null);
  try {
    await expect(engine.addImage('missing canvas')).rejects.toThrow('Canvas2D');
    expect(engine.getSnapshot()).toMatchObject({
      document: doc,
      selected: layer.id,
      canUndo: true,
    });
    expect(engine.assets.size).toBe(0);
  } finally {
    getContext.mockRestore();
  }
});

it('an asynchronous sticker cannot land on a newer source even when its loader ignores abort', async () => {
  const pending = deferred<LoadedImage>(),
    loader = vi
      .fn()
      .mockResolvedValueOnce(image())
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(image(200, 100)),
    engine = new CanvasEngine(loader);
  await engine.reset('first');
  const imported = engine.addImage('slow sticker').catch((error) => error);
  await engine.reset('replacement');
  pending.resolve(image(10, 10));
  expect((await imported).name).toBe('AbortError');
  expect(engine.getSnapshot().document).toMatchObject({
    width: 200,
    height: 100,
    layers: [],
  });
  expect(engine.assets.size).toBe(0);
});

it('restoration reuses already owned sticker resources and exports fail cleanly before readiness', async () => {
  const loader = vi.fn(async () => image()),
    engine = new CanvasEngine(loader);
  await expect(engine.restoreDocument('{}')).rejects.toThrow('not ready');
  await expect(engine.addImage('sticker')).rejects.toThrow('not ready');
  await expect(engine.getBlob()).rejects.toThrow('not ready');
  expect(engine.getDocument()).toBeNull();
  engine.revert();
  await engine.reset('base');
  const source = 'data:image/png;base64,AA==',
    resource = {} as CanvasImageSource;
  engine.assets.set(source, resource);
  await engine.restoreDocument({
    ...engine.getDocument()!,
    layers: [{ ...pathLayer([]), kind: 'image', imageSource: source }],
  });
  expect(loader).toHaveBeenCalledTimes(1);
  expect(engine.assets.get(source)).toBe(resource);
});

it('unsupported encoders and an encoding failure preserve document history', async () => {
  const engine = await ready(),
    doc = engine.getSnapshot().document!;
  expect(() =>
    Reflect.apply(engine.getImage, engine, [{ type: 'image/gif' }])
  ).toThrow('Unsupported image format');
  vi.mocked(exportCanvas).mockReturnValueOnce({
    toBlob: (callback: BlobCallback) => callback(null),
  } as HTMLCanvasElement);
  await expect(engine.getBlob()).rejects.toThrow('Image export failed');
  expect(engine.getSnapshot().document).toBe(doc);
  expect(engine.hasChanges()).toBe(false);
});

it('source bytes and output settings remain independent of edits and failed resets', async () => {
  const sourceBlob = new NodeBlob(['original encoded source'], {
      type: 'image/png',
    }),
    loader = vi
      .fn()
      .mockResolvedValueOnce({ ...image(), sourceBlob })
      .mockRejectedValueOnce(new Error('missing')),
    engine = new CanvasEngine(loader);
  await expect(engine.getSourceBlob()).rejects.toThrow('not ready');
  await engine.reset('base');
  engine.commit(resizeDocument(engine.getSnapshot().document!, 20, 12));
  engine.updateOptions({
    export: {
      type: 'image/jpeg',
      quality: 0.7,
      fit: 'contain',
      upscale: false,
      width: 10,
    },
  });
  const settings = engine.getExportOptions();
  settings.width = 99;
  expect(engine.getExportOptions().width).toBe(10);
  expect(await engine.getSourceBlob()).toBe(sourceBlob);
  await expect(engine.reset('missing')).rejects.toThrow();
  expect(await engine.getSourceBlob()).toBe(sourceBlob);
  expect(engine.getSnapshot().document).toMatchObject({
    width: 20,
    height: 12,
  });
  const custom = await ready();
  custom.commit(resizeDocument(custom.getSnapshot().document!, 20, 12));
  custom.updateOptions({ export: { type: 'image/jpeg', width: 10 } });
  expect(JSON.parse(await (await custom.getSourceBlob()).text())).toMatchObject(
    { width: 100, height: 60, layers: [] }
  );
});

it('multi-selection deduplicates and prunes IDs while group removal is one history step', async () => {
  const engine = await ready(),
    a = pathLayer([]),
    b = pathLayer([]),
    locked = { ...pathLayer([]), locked: true },
    doc = { ...engine.getSnapshot().document!, layers: [a, b, locked] };
  engine.commit(doc);
  engine.selectMany([a.id, b.id, a.id, locked.id, 'missing']);
  expect(engine.getSnapshot()).toMatchObject({
    selectedIds: [a.id, b.id],
    selected: b.id,
  });
  engine.toggleSelection(a.id);
  expect(engine.getSnapshot().selectedIds).toEqual([b.id]);
  engine.toggleSelection(a.id);
  expect(engine.getSnapshot().selected).toBe(a.id);
  engine.removeSelected();
  expect(engine.getSnapshot()).toMatchObject({
    selected: null,
    selectedIds: [],
  });
  expect(engine.getSnapshot().document!.layers).toEqual([locked]);
  engine.undo();
  expect(engine.getSnapshot().document).toBe(doc);
  engine.selectMany([a.id, b.id]);
  engine.commit({ ...doc, layers: [a, { ...b, hidden: true }, locked] });
  expect(engine.getSnapshot()).toMatchObject({
    selectedIds: [a.id],
    selected: a.id,
  });
  engine.select(null);
  expect(engine.getSnapshot().selectedIds).toEqual([]);
});
