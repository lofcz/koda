import { vi } from 'vitest';
import { CanvasEngine, LoadedImage } from '../src/engine';
import {
  cropDocument,
  DEFAULT_EFFECTS,
  DocumentHistory,
  ImageDocument,
  pathLayer,
} from '../src/model';
import type { ImageEditorChange } from '../src/types';

vi.mock('../src/render', () => ({
  exportCanvas: vi.fn((doc: { width: number; height: number }) => ({
    width: doc.width,
    height: doc.height,
    toDataURL: () => JSON.stringify(doc),
    toBlob: (callback: (blob: Blob) => void) =>
      callback(new Blob([JSON.stringify(doc)], { type: 'image/png' })),
  })),
}));
const image = (width = 100, height = 60, label = 'source'): LoadedImage => ({
  source: { label } as unknown as CanvasImageSource,
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
/** A loaded draft with an exposure tweak, a 90° crop and one editable stroke. */
async function draft(loader = vi.fn()) {
  const original = image(100, 60, 'original');
  loader.mockResolvedValueOnce(original);
  const engine = new CanvasEngine(loader);
  await engine.reset('original');
  const doc = cropDocument(engine.getSnapshot().document!, {
      x: 10,
      y: 0,
      width: 80,
      height: 60,
    }),
    layer = pathLayer([
      { x: 5, y: 5 },
      { x: 30, y: 20 },
    ]);
  engine.commit({
    ...doc,
    effects: { ...DEFAULT_EFFECTS, exposure: 20 },
    background: '#ff0000',
    frame: { style: 'solid', color: '#00ff00', width: 4 },
    cornerRadius: 6,
  });
  engine.commit({
    ...engine.getSnapshot().document!,
    layers: [layer],
  });
  engine.select(layer.id);
  return { engine, original, layer, loader };
}

it('exports the base at document size without layers or document decoration', async () => {
  const { engine } = await draft(),
    doc = engine.getSnapshot().document!,
    base = JSON.parse(engine.getBaseImage()!) as ImageDocument;
  expect(base).toMatchObject({
    width: 80,
    height: 60,
    imageMatrix: doc.imageMatrix,
    effects: doc.effects,
    layers: [],
    background: 'transparent',
    frame: { style: 'none' },
    cornerRadius: 0,
  });
  // Ordinary export is unchanged and still contains the layer.
  expect((JSON.parse(engine.getImage()!) as ImageDocument).layers).toHaveLength(
    1
  );
  expect(engine.getDocument()!.layers).toHaveLength(1);
});

it('applies visible redactions to the base so hidden content never leaves', async () => {
  const { engine, layer } = await draft(),
    doc = engine.getSnapshot().document!,
    redaction = {
      ...pathLayer([{ x: 0, y: 0 }]),
      kind: 'redaction' as const,
      width: 20,
      height: 20,
    },
    hidden = { ...redaction, id: 'hidden', hidden: true };
  engine.commit({ ...doc, layers: [redaction, layer, hidden] });
  const base = JSON.parse(engine.getBaseImage()!) as ImageDocument;
  expect(base.layers).toEqual([redaction]);
  await engine.replaceBase(image(80, 60, 'ai'));
  expect(engine.getSnapshot().document!.layers).toEqual([
    redaction,
    layer,
    hidden,
  ]);
});

it('replaces the base as one undoable edit and keeps layers editable', async () => {
  const { engine, original, layer, loader } = await draft(),
    changes: ImageEditorChange[] = [];
  engine.subscribeChanges((change) => changes.push(change));
  const before = engine.getSnapshot(),
    edited = image(160, 120, 'ai');
  loader.mockResolvedValueOnce(edited);
  await engine.replaceBase('ai-result');
  const after = engine.getSnapshot();
  expect(loader).toHaveBeenLastCalledWith('ai-result', expect.any(AbortSignal));
  expect(engine.getSource()).toBe(edited.source);
  expect(engine.image).toBe(edited);
  expect(after.document).toMatchObject({
    width: 80,
    height: 60,
    imageMatrix: [0.5, 0, 0, 0.5, 0, 0],
    effects: DEFAULT_EFFECTS,
    background: '#ff0000',
    frame: { style: 'solid', color: '#00ff00', width: 4 },
    cornerRadius: 6,
  });
  expect(after.document!.layers).toEqual([layer]);
  expect(after.selected).toBe(layer.id);
  expect(after.canUndo).toBe(true);
  expect(after.canRedo).toBe(false);
  expect(after.sourceRevision).not.toBe(before.sourceRevision);
  expect(after.imageRevision).toBe(before.imageRevision);
  expect(engine.hasChanges()).toBe(true);
  expect(changes).toHaveLength(1);
  expect(changes[0].geometryKey).not.toBe(
    JSON.stringify([
      before.sourceRevision,
      80,
      60,
      before.document!.imageMatrix,
    ])
  );

  engine.undo();
  const undone = engine.getSnapshot();
  expect(undone.document).toBe(before.document);
  expect(engine.getSource()).toBe(original.source);
  expect(engine.image).toBe(original);
  expect(undone.sourceRevision).toBe(before.sourceRevision);
  expect(undone.canRedo).toBe(true);
  expect(changes.at(-1)!.geometryKey).toBe(
    JSON.stringify([
      before.sourceRevision,
      80,
      60,
      before.document!.imageMatrix,
    ])
  );
  // The step before the AI edit is still reachable.
  engine.undo();
  expect(engine.getSnapshot().document!.layers).toHaveLength(0);
  expect(engine.getSource()).toBe(original.source);

  engine.redo();
  engine.redo();
  expect(engine.getSnapshot().document).toBe(after.document);
  expect(engine.getSource()).toBe(edited.source);
  expect(engine.getSnapshot().sourceRevision).toBe(after.sourceRevision);

  // A layer edit after the replacement keeps the new source.
  engine.commit({
    ...engine.getSnapshot().document!,
    layers: [{ ...layer, color: '#0000ff' }],
  });
  expect(engine.getSource()).toBe(edited.source);
  engine.undo();
  expect(engine.getSource()).toBe(edited.source);
  expect(engine.getSnapshot().document).toBe(after.document);
});

it('a replacement over an identical document is still a history entry', async () => {
  const loader = vi.fn().mockResolvedValueOnce(image(100, 60, 'a'));
  const engine = new CanvasEngine(loader);
  await engine.reset('a');
  const replacement = image(100, 60, 'b');
  await engine.replaceBase(replacement);
  expect(engine.getSnapshot().canUndo).toBe(true);
  expect(engine.getSource()).toBe(replacement.source);
  expect(engine.hasChanges()).toBe(true);
  engine.undo();
  expect(engine.hasChanges()).toBe(false);
  expect(engine.getSnapshot().canUndo).toBe(false);
});

it('the latest replacement wins even when an older loader ignores abort', async () => {
  const { engine, loader } = await draft(),
    first = deferred<LoadedImage>(),
    second = deferred<LoadedImage>();
  loader.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = engine.replaceBase('first').catch((error) => error),
    b = engine.replaceBase('second'),
    winner = image(80, 60, 'second');
  expect((loader.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
  second.resolve(winner);
  await b;
  first.resolve(image(80, 60, 'first'));
  expect((await a).name).toBe('AbortError');
  expect(engine.getSource()).toBe(winner.source);
  engine.undo();
  expect(engine.getSnapshot().canUndo).toBe(true);
  expect(engine.getSnapshot().document!.layers).toHaveLength(1);
});

it('a failed load leaves the draft, selection and history untouched', async () => {
  const { engine, original, layer, loader } = await draft(),
    before = engine.getSnapshot();
  loader.mockRejectedValueOnce(new Error('unreachable'));
  await expect(engine.replaceBase('broken')).rejects.toThrow('unreachable');
  expect(engine.getSnapshot()).toMatchObject({
    phase: 'ready',
    document: before.document,
    selected: layer.id,
    canUndo: true,
    canRedo: false,
    sourceRevision: before.sourceRevision,
    error: null,
  });
  expect(engine.getSource()).toBe(original.source);
  loader.mockResolvedValueOnce(image(100000, 10));
  await expect(engine.replaceBase('huge')).rejects.toThrow('dimensions');
  expect(engine.getSnapshot().document).toBe(before.document);
});

it('a base changed while loading rejects, while layer edits are kept', async () => {
  const { engine, loader, layer } = await draft(),
    pending = deferred<LoadedImage>();
  loader.mockReturnValueOnce(pending.promise);
  const cropped = engine.replaceBase('slow').catch((error) => error);
  const doc = engine.getSnapshot().document!;
  engine.commit(cropDocument(doc, { x: 0, y: 0, width: 40, height: 40 }));
  pending.resolve(image(80, 60, 'late'));
  expect((await cropped).name).toBe('AbortError');
  expect(engine.getSnapshot().document!.width).toBe(40);

  engine.undo();
  const layered = deferred<LoadedImage>();
  loader.mockReturnValueOnce(layered.promise);
  const applied = engine.replaceBase('slow');
  const extra = pathLayer([{ x: 50, y: 50 }]);
  engine.commit({
    ...engine.getSnapshot().document!,
    layers: [...engine.getSnapshot().document!.layers, extra],
  });
  const replacement = image(80, 60, 'layered');
  layered.resolve(replacement);
  await applied;
  expect(engine.getSource()).toBe(replacement.source);
  expect(engine.getSnapshot().document!.layers).toEqual([layer, extra]);
});

it('reset and destroy supersede a pending replacement', async () => {
  const { engine, loader } = await draft(),
    pending = deferred<LoadedImage>();
  loader.mockReturnValueOnce(pending.promise);
  const replaced = engine.replaceBase('slow').catch((error) => error);
  const fresh = image(30, 20, 'fresh');
  loader.mockResolvedValueOnce(fresh);
  await engine.reset('fresh');
  pending.resolve(image(80, 60, 'late'));
  expect((await replaced).name).toBe('AbortError');
  expect(engine.getSource()).toBe(fresh.source);
  expect(engine.getSnapshot().canUndo).toBe(false);

  const late = deferred<LoadedImage>();
  loader.mockReturnValueOnce(late.promise);
  const destroyed = engine.replaceBase('slow').catch((error) => error);
  engine.destroy();
  late.resolve(image(30, 20, 'late'));
  expect((await destroyed).name).toBe('AbortError');
  expect(engine.getSnapshot().phase).toBe('destroyed');
  await expect(engine.replaceBase(image())).rejects.toThrow('not ready');
});

it('commits a pending text edit before replacing, inside its own history step', async () => {
  const { engine, loader, layer, original } = await draft();
  engine.beforeExport(() => {
    engine.commit({
      ...engine.getSnapshot().document!,
      layers: [{ ...layer, color: '#123456' }],
    });
  });
  loader.mockResolvedValueOnce(image(80, 60, 'ai'));
  await engine.replaceBase('ai');
  expect(engine.getSnapshot().document!.layers[0].color).toBe('#123456');
  engine.undo();
  expect(engine.getSnapshot().document!.layers[0].color).toBe('#123456');
  expect(engine.getSource()).toBe(original.source);
});

it('revert restores the original source and document as one undoable edit', async () => {
  const { engine, original, loader } = await draft(),
    edited = image(80, 60, 'ai');
  loader.mockResolvedValueOnce(edited);
  await engine.replaceBase('ai');
  const replaced = engine.getSnapshot().document;
  engine.revert();
  expect(engine.getSource()).toBe(original.source);
  expect(engine.hasChanges()).toBe(false);
  expect(engine.getSnapshot().document!.layers).toHaveLength(0);
  engine.undo();
  expect(engine.getSource()).toBe(edited.source);
  expect(engine.getSnapshot().document).toBe(replaced);
});

it('persists the replaced source and a document that restores over it', async () => {
  const { engine, loader, layer } = await draft(),
    blob = new Blob(['ai-bytes'], { type: 'image/png' });
  loader.mockResolvedValueOnce({ ...image(160, 120, 'ai'), sourceBlob: blob });
  await engine.replaceBase('ai');
  expect(await engine.getSourceBlob()).toBe(blob);
  const saved = engine.getDocument()!;
  // Reopen: the saved source becomes the baseline and the document restores over it.
  const reopened = new CanvasEngine(async () => image(160, 120, 'ai'));
  await reopened.reset('saved-source');
  await reopened.restoreDocument(JSON.stringify(saved));
  expect(reopened.getSnapshot().document).toEqual(saved);
  expect(reopened.getSnapshot().document!.layers).toEqual([layer]);
});

it('history entries keep sources only while they are reachable', () => {
  const doc = {
    width: 1,
    height: 1,
    imageMatrix: [1, 0, 0, 1, 0, 0],
    layers: [],
    effects: DEFAULT_EFFECTS,
    background: 'transparent',
    frame: { style: 'none', color: '#fff', width: 0 },
    cornerRadius: 0,
  } as ImageDocument;
  const history = new DocumentHistory<string>(doc, 2, 'a');
  history.commit(doc, 'b');
  history.commit(doc, 'c');
  history.commit(doc, 'd');
  expect(history.past).toHaveLength(2);
  history.undo();
  history.undo();
  expect(history.source).toBe('b');
  history.undo();
  expect(history.source).toBe('b');
  expect(history.changed).toBe(true);
  history.redo();
  expect(history.source).toBe('c');
  expect(history.commit(doc, 'c')).toBe(false);
  history.begin();
  history.preview({ ...doc, width: 2 });
  history.cancel();
  expect(history.current).toBe(doc);
  expect(history.source).toBe('c');
});
