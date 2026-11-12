import { describe, expect, it, vi } from 'vitest';
import {
  allowsPatch,
  allowsTextEdit,
  deniedRights,
  groupTransformRights,
  handleRights,
  LAYER_RIGHTS,
  matrixRights,
  movableIds,
  parseLayerRights,
  parseLayerRightsDefaults,
  patchRights,
  resolveLayerRights,
  rightsResolver,
  SELECTION_RIGHTS,
} from '../src/rights';
import {
  createDocument,
  duplicateLayer,
  flipLayer,
  hitDocument,
  Layer,
  multiply,
  parseDocument,
  resizeLayer,
  rotateLayer,
  scale,
  translate,
} from '../src/model';
import {
  alignLayers,
  distributeLayers,
  duplicateLayers,
  snapMove,
} from '../src/interactions';
import { CanvasEngine } from '../src/engine';
import * as documentModule from '../src/document';

vi.mock('../src/render', () => ({
  exportCanvas: vi.fn(() => ({ toDataURL: () => 'data:,' })),
}));

const box = (id: string, x = 0, rights?: Layer['rights']): Layer => ({
  id,
  kind: 'rectangle',
  matrix: translate(x, 10),
  width: 50,
  height: 40,
  color: '#000000',
  fill: '#ffffff',
  strokeWidth: 2,
  opacity: 1,
  ...(rights ? { rights } : {}),
});
const text = (rights?: Layer['rights'], extra: Partial<Layer> = {}): Layer => ({
  id: 'text',
  kind: 'text',
  matrix: translate(20, 20),
  width: 120,
  height: 48,
  color: '#202a38',
  fill: 'transparent',
  strokeWidth: 0,
  opacity: 1,
  text: 'Hello',
  fontSize: 40,
  fontFamily: 'sans-serif',
  ...(rights ? { rights } : {}),
  ...extra,
});
const all = (value: boolean) =>
  Object.fromEntries(LAYER_RIGHTS.map((right) => [right, value]));

describe('rights validation and back-compat', () => {
  it('accepts partial boolean rights and drops empty objects', () => {
    expect(parseLayerRights({ move: false, editText: true })).toEqual({
      move: false,
      editText: true,
    });
    expect(parseLayerRights({})).toBeUndefined();
    expect(parseLayerRights(undefined)).toBeUndefined();
    expect(parseLayerRights({ move: undefined })).toBeUndefined();
  });
  it('rejects unknown rights, non-boolean values and non-objects', () => {
    expect(() => parseLayerRights({ teleport: false })).toThrow(
      'Invalid layer right'
    );
    expect(() => parseLayerRights({ move: 'no' })).toThrow();
    expect(() => parseLayerRights({ move: 0 })).toThrow();
    expect(() => parseLayerRights([false])).toThrow('Invalid layer rights');
    expect(() => parseLayerRights(null)).toThrow('Invalid layer rights');
    expect(() => parseLayerRightsDefaults({ widget: { move: false } })).toThrow(
      'Invalid layer rights defaults'
    );
    expect(() => parseLayerRightsDefaults('text')).toThrow();
    expect(
      parseLayerRightsDefaults({ all: { delete: false }, text: {} })
    ).toEqual({ all: { delete: false } });
  });
  it('round trips rights through the document and keeps old documents unchanged', () => {
    const doc = {
      ...createDocument(200, 100),
      layers: [
        box('a', 0, { move: false, delete: false }),
        box('b', 60),
        { ...box('c', 120), rights: {} },
      ],
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.layers[0].rights).toEqual({ move: false, delete: false });
    expect('rights' in parsed.layers[1]).toBe(false);
    expect('rights' in parsed.layers[2]).toBe(false);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    // A document saved before rights existed parses to the same JSON as before.
    const legacy = { ...createDocument(200, 100), layers: [box('a')] };
    expect(JSON.stringify(parseDocument(legacy))).toBe(JSON.stringify(legacy));
    expect(() =>
      parseDocument({ ...doc, layers: [box('a', 0, { fly: false } as never)] })
    ).toThrow('Invalid layer right');
    expect(() =>
      parseDocument({
        ...doc,
        layers: [{ ...box('a'), rights: { move: 'false' } }],
      })
    ).toThrow();
  });
  it('the server-safe document entry validates and resolves rights', () => {
    expect(documentModule.LAYER_RIGHTS).toEqual(LAYER_RIGHTS);
    expect(documentModule.parseLayerRights({ select: false })).toEqual({
      select: false,
    });
    expect(
      documentModule.resolveLayerRights({ kind: 'text', rights: {} }).editText
    ).toBe(true);
  });
});

describe('rights resolution', () => {
  it('absent rights allow everything, matching today', () => {
    expect(resolveLayerRights(box('a'))).toEqual(all(true));
  });
  it('locked denies every selection right but keeps erase, snap, lock and visibility', () => {
    const rights = resolveLayerRights({ ...box('a'), locked: true });
    for (const right of SELECTION_RIGHTS) expect(rights[right]).toBe(false);
    expect(rights).toMatchObject({
      erase: true,
      snap: true,
      lock: true,
      visibility: true,
    });
    // A layer cannot be unlocked into rights its author denied.
    expect(
      resolveLayerRights({ ...box('a', 0, { lock: false }), locked: true }).lock
    ).toBe(false);
  });
  it('select:false denies every operation that needs a selection', () => {
    const rights = resolveLayerRights(
      box('a', 0, { select: false, move: true })
    );
    expect(rights.move).toBe(false);
    expect(rights.delete).toBe(false);
    expect(rights.erase).toBe(true);
  });
  it('new lines need text editing', () => {
    expect(
      resolveLayerRights(text({ editText: false, textNewlines: true }))
        .textNewlines
    ).toBe(false);
  });
  it('applies all, then kind defaults, then the layer’s own rights', () => {
    const defaults = parseLayerRightsDefaults({
      all: { delete: false, style: false },
      text: { style: true, move: false },
    });
    const resolve = rightsResolver(defaults);
    expect(resolve(box('a'))).toMatchObject({
      delete: false,
      style: false,
      move: true,
    });
    expect(resolve(text())).toMatchObject({
      delete: false,
      style: true,
      move: false,
    });
    expect(resolve(text({ move: true, delete: true }))).toMatchObject({
      move: true,
      delete: true,
    });
  });
  it('lists only rights a user can notice for the layer kind', () => {
    expect(deniedRights(text({ pathPoints: false, move: false }))).toEqual([
      'move',
    ]);
    expect(deniedRights(text({ editText: false }))).toEqual([
      'editText',
      'textNewlines',
    ]);
    expect(deniedRights(box('a', 0, { select: false, move: false }))).toEqual([
      'select',
    ]);
    expect(deniedRights({ ...box('a'), locked: true })).toEqual([]);
    expect(deniedRights(box('a', 0, { snap: false }))).toEqual([]);
  });
});

describe('operation classification', () => {
  const layer = { ...box('a'), matrix: [2, 0.5, -0.3, 1.5, 30, 40] as const };
  it('classifies affine changes by intent', () => {
    expect(
      matrixRights(layer.matrix, multiply(translate(4, 5), layer.matrix))
    ).toEqual(['move']);
    expect(matrixRights(layer.matrix, rotateLayer(layer, 30).matrix)).toEqual([
      'rotate',
    ]);
    expect(matrixRights(layer.matrix, flipLayer(layer, true).matrix)).toEqual([
      'flip',
    ]);
    expect(
      matrixRights(
        layer.matrix,
        resizeLayer(layer, 2, { x: 200, y: 200 }).matrix
      )
    ).toEqual(['resize']);
    expect(
      matrixRights(layer.matrix, multiply(layer.matrix, scale(1.5, 1)))
    ).toEqual(['resize']);
    expect(matrixRights(layer.matrix, layer.matrix)).toEqual([]);
  });
  it('maps patches to rights and ignores unchanged values', () => {
    const rect = box('a');
    expect([...patchRights(rect, { color: '#ff0000' })]).toEqual(['style']);
    expect([...patchRights(rect, { color: rect.color })]).toEqual([]);
    expect([...patchRights(rect, { ...rect })]).toEqual([]);
    expect([...patchRights(rect, { opacity: 0.5, feather: 3 })]).toEqual([
      'style',
    ]);
    expect([...patchRights(rect, { locked: true })]).toEqual(['lock']);
    expect([...patchRights(rect, { hidden: true })]).toEqual(['visibility']);
    expect([...patchRights(rect, { points: [] })]).toEqual(['pathPoints']);
    expect([...patchRights(rect, { pathClosed: true })]).toEqual([
      'pathPoints',
    ]);
    expect([...patchRights(rect, flipLayer(rect, false))]).toEqual(['flip']);
    expect([...patchRights(text(), { width: 300 })].sort()).toEqual([
      'resize',
      'textLayout',
    ]);
    expect([...patchRights(text(), { textLayout: 'fixed' })]).toEqual([
      'textLayout',
    ]);
    expect([...patchRights(rect, { rights: { move: true } })]).toContain(
      'lock'
    );
  });
  it('gates text content, new lines and inline style separately', () => {
    const editOnly = resolveLayerRights(
      text({ textNewlines: false, style: false })
    );
    const layer = text();
    // Typing inherits the resolved style, including a browser rgb() echo of the hex color.
    expect(
      allowsTextEdit(
        layer,
        {
          text: 'Hello there',
          runs: [
            {
              text: 'Hello there',
              style: {
                color: 'rgb(32, 42, 56)',
                fontSize: 40,
                fontFamily: '"sans-serif"',
                fontWeight: 400,
              },
            },
          ],
        },
        editOnly
      )
    ).toBe(true);
    expect(allowsTextEdit(layer, { text: 'Hello\nthere' }, editOnly)).toBe(
      false
    );
    expect(
      allowsTextEdit(
        layer,
        {
          text: 'Hello',
          runs: [{ text: 'Hello', style: { fontWeight: 700 } }],
        },
        editOnly
      )
    ).toBe(false);
    // Existing line breaks may stay; only new ones are denied.
    const twoLines = text(undefined, { text: 'a\nb' });
    expect(allowsTextEdit(twoLines, { text: 'a\nbc' }, editOnly)).toBe(true);
    expect(allowsTextEdit(twoLines, { text: 'ab' }, editOnly)).toBe(true);
    const styleOnly = resolveLayerRights(text({ editText: false }));
    expect(allowsTextEdit(layer, { text: 'Hello!' }, styleOnly)).toBe(false);
    expect(
      allowsTextEdit(
        layer,
        {
          text: 'Hello',
          runs: [{ text: 'He', style: { fontWeight: 700 } }, { text: 'llo' }],
        },
        styleOnly
      )
    ).toBe(true);
    // A mark that already exists in the runs can be reused while style is fixed.
    const styled = text(undefined, {
      textRuns: [{ text: 'He', style: { italic: true } }, { text: 'llo' }],
    });
    expect(
      allowsTextEdit(
        styled,
        {
          text: 'Hello',
          runs: [{ text: 'Hell', style: { italic: true } }, { text: 'o' }],
        },
        editOnly
      )
    ).toBe(true);
    expect(
      allowsPatch(layer, { textAlign: 'center' }, editOnly) ||
        allowsPatch(layer, { fontSize: 50 }, editOnly)
    ).toBe(false);
  });
});

describe('selection and group rules', () => {
  const resolve = rightsResolver();
  const fixed = box('fixed', 0, { move: false, rotate: false });
  const free = box('free', 100);
  it('group handles need every member to allow the transform and moving', () => {
    expect(groupTransformRights([free, box('b', 200)], resolve)).toEqual({
      resize: true,
      rotate: true,
      endpoint: true,
    });
    expect(groupTransformRights([free, fixed], resolve)).toEqual({
      resize: false,
      rotate: false,
      endpoint: false,
    });
    expect(handleRights(fixed, null, resolve)).toEqual({
      resize: true,
      rotate: false,
      endpoint: false,
    });
    expect(
      handleRights(text({ textLayout: false }), null, resolve).resize
    ).toBe(false);
    expect(movableIds([fixed, free], resolve)).toEqual(['free']);
  });
  it('translation commands skip members that cannot move', () => {
    const doc = {
      ...createDocument(400, 200),
      layers: [fixed, free, box('third', 250)],
    };
    const canMove = (layer: Layer) => resolve(layer).move;
    const aligned = alignLayers(doc, ['fixed', 'free'], 'left', canMove);
    expect(aligned.layers[0].matrix).toEqual(fixed.matrix);
    // The fixed member still defines the bounds the others align to.
    expect(aligned.layers[1].matrix[4]).toBe(0);
    expect(alignLayers(doc, ['fixed'], 'right', canMove)).toBe(doc);
    expect(
      distributeLayers(doc, ['fixed', 'free', 'third'], 'horizontal', canMove)
    ).toBe(doc);
    const copies = duplicateLayers(
      { ...doc, layers: [box('a', 0, { duplicate: false }), free] },
      ['a', 'free'],
      (layer) => resolve(layer).duplicate
    );
    expect(copies.ids).toHaveLength(1);
    expect(copies.document.layers).toHaveLength(3);
    expect(copies.document.layers[2].matrix[4]).toBe(112);
  });
  it('snapping ignores layers that deny being a snap target', () => {
    const target = box('target', 103, { snap: false });
    const doc = { ...createDocument(1000, 1000), layers: [box('m'), target] };
    const moving = doc.layers[0];
    expect(
      snapMove(doc, moving, { x: 52, y: 0 }, 5, undefined, ['m']).delta.x
    ).toBe(53);
    expect(
      snapMove(
        doc,
        moving,
        { x: 52, y: 0 },
        5,
        undefined,
        ['m'],
        (layer) => resolve(layer).snap
      ).delta.x
    ).toBe(52);
  });
  it('unselectable layers never catch a click', () => {
    const doc = {
      ...createDocument(200, 200),
      layers: [box('under', 0), box('over', 0, { select: false })],
    };
    expect(hitDocument(doc, { x: 10, y: 20 })?.id).toBe('under');
    expect(
      hitDocument(doc, { x: 10, y: 20 }, 4, (layer) => layer.id !== 'under')
    ).toBeUndefined();
  });
  it('duplicates keep the author’s rights', () => {
    const doc = {
      ...createDocument(200, 200),
      layers: [box('a', 0, { move: false })],
    };
    expect(duplicateLayer(doc, 'a').layers[1].rights).toEqual({ move: false });
  });
});

describe('engine enforcement', () => {
  const ready = async () => {
    const engine = new CanvasEngine(async () => ({
      source: {} as CanvasImageSource,
      width: 300,
      height: 200,
    }));
    await engine.reset('image');
    return engine;
  };
  it('selection, deletion and option defaults follow the rights model', async () => {
    const engine = await ready(),
      doc = engine.getSnapshot().document!;
    engine.commit({
      ...doc,
      layers: [
        box('kept', 0, { delete: false }),
        box('gone', 60),
        box('ghost', 120, { select: false }),
      ],
    });
    engine.selectMany(['kept', 'gone', 'ghost']);
    expect(engine.getSnapshot().selectedIds).toEqual(['kept', 'gone']);
    engine.removeSelected();
    expect(engine.getSnapshot().document!.layers.map((l) => l.id)).toEqual([
      'kept',
      'ghost',
    ]);
    expect(engine.getSnapshot().selectedIds).toEqual(['kept']);
    expect(engine.getLayerRights('kept')).toMatchObject({
      delete: false,
      move: true,
    });
    expect(engine.getLayerRights('missing')).toBeNull();
    engine.updateOptions({ layerRights: { rectangle: { select: false } } });
    expect(engine.getSnapshot().selectedIds).toEqual([]);
    expect(engine.getLayerRights('kept')!.select).toBe(false);
    engine.selectMany(['kept']);
    expect(engine.getSnapshot().selectedIds).toEqual([]);
    const resolver = engine.rights;
    engine.updateOptions({ theme: 'dark' });
    expect(engine.rights).toBe(resolver);
    engine.updateOptions({ layerRights: undefined });
    engine.select('kept');
    expect(engine.getSnapshot().selectedIds).toEqual(['kept']);
    expect(() =>
      engine.updateOptions({ layerRights: { all: { warp: false } } as never })
    ).toThrow();
  });
  it('setLayerRights is policy: undo and redo never bring back earlier rights', async () => {
    const engine = await ready(),
      doc = engine.getSnapshot().document!;
    engine.commit({ ...doc, layers: [box('a')] });
    engine.commit({
      ...engine.getSnapshot().document!,
      layers: [box('a', 40)],
    });
    const changes: boolean[] = [];
    engine.subscribeChanges((change) => changes.push(change.hasChanges));
    engine.setLayerRights('a', { move: false, delete: false });
    expect(changes).toEqual([true]);
    expect(engine.getDocument()!.layers[0].rights).toEqual({
      move: false,
      delete: false,
    });
    engine.undo();
    expect(engine.getSnapshot().document!.layers[0].matrix[4]).toBe(0);
    expect(engine.getSnapshot().document!.layers[0].rights).toEqual({
      move: false,
      delete: false,
    });
    engine.redo();
    expect(engine.getSnapshot().document!.layers[0].rights).toEqual({
      move: false,
      delete: false,
    });
    engine.setLayerRights('a', null);
    expect('rights' in engine.getSnapshot().document!.layers[0]).toBe(false);
    engine.undo();
    expect('rights' in engine.getSnapshot().document!.layers[0]).toBe(false);
    expect(() => engine.setLayerRights('a', { move: 1 } as never)).toThrow();
  });
  it('setLayerRights keeps a clean draft clean and ignores missing layers', async () => {
    const engine = await ready();
    engine.setLayerRights('missing', { move: false });
    expect(engine.hasChanges()).toBe(false);
    const destroyed = await ready();
    destroyed.destroy();
    expect(() => destroyed.setLayerRights('a', { move: false })).not.toThrow();
  });
});
