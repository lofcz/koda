import { vi } from 'vitest';
import { CanvasEngine, LoadedImage } from '../src/engine';
import { cropDocument, pathLayer, resizeDocument } from '../src/model';

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
