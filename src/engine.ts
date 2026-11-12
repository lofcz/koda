import {
  createDocument,
  dimensions,
  DocumentHistory,
  ImageDocument,
  Layer,
  parseDocument,
  translate,
} from './model';
import {
  defaultRights,
  parseLayerRights,
  parseLayerRightsDefaults,
  rightsResolver,
  type LayerRights,
  type ResolvedLayerRights,
  type RightsResolver,
} from './rights';
import { exportCanvas } from './render';
import { parseExportOptions } from './exportOptions';
import { parseCropOptions } from './crop';
import {
  addJpegExif,
  addJpegExifToDataUrl,
  readJpegExif,
} from './jpegMetadata';
import type {
  ImageEditorChange,
  ImageEditorInstance,
  ImageEditorOptions,
  MountOptions,
  ImageExportOptions,
  ImageEditorLoadedImage,
  ImageEditorImageLoader,
} from './types';
export type LoadedImage = ImageEditorLoadedImage;
export type ImageLoader = ImageEditorImageLoader;
export type EngineState = {
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'destroyed';
  document: ImageDocument | null;
  options: ImageEditorOptions;
  error: Error | null;
  selected: string | null;
  selectedIds: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  imageRevision: number;
};
export const abortError = () =>
  new DOMException('Image loading was superseded', 'AbortError');
export const isAbort = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';
function decodeImage(url: string, signal: AbortSignal): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const clean = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      clean();
      image.src = '';
      reject(abortError());
    };
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      clean();
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('Image has no pixels'));
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas2D is unavailable');
        ctx.drawImage(image, 0, 0, 1, 1);
        ctx.getImageData(0, 0, 1, 1);
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      clean();
      reject(
        new Error('Unable to load the image. Check the URL and CORS access.')
      );
    };
    image.src = url;
  });
}
export async function loadImage(
  url: string,
  signal: AbortSignal
): Promise<LoadedImage> {
  if (signal.aborted) throw abortError();
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok)
    throw new Error('Unable to load the image. Check the URL and CORS access.');
  const sourceBlob = await response.blob();
  if (signal.aborted) throw abortError();
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await decodeImage(objectUrl, signal);
    return { ...image, sourceBlob };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
/** Owns document/history and image lifetimes. No DOM/UI dependency until load/export. */
export class CanvasEngine implements ImageEditorInstance {
  private state: EngineState = {
    phase: 'idle',
    document: null,
    options: {},
    error: null,
    selected: null,
    selectedIds: [],
    canUndo: false,
    canRedo: false,
    revision: 0,
    imageRevision: 0,
  };
  private listeners = new Set<() => void>();
  private changes = new Set<(change: ImageEditorChange) => void>();
  private imageKey = 0;
  private generation = 0;
  /** Tracks document ownership separately from render and no-op lifecycle notifications. */
  private documentRevision = 0;
  private controller: AbortController | null = null;
  private url = '';
  private loadedUrl = '';
  private exportFinalizer: (() => void) | null = null;
  private history: DocumentHistory | null = null;
  private sourceExif: Uint8Array | null = null;
  private restoreGeneration = 0;
  private assetControllers = new Set<AbortController>();
  /** Decoded image layers are owned by the engine; documents only contain serializable sources. */
  assets = new Map<string, CanvasImageSource>();
  image: LoadedImage | null = null;
  /** Effective layer rights under the current `layerRights` option. Identity changes with the option. */
  rights: RightsResolver = defaultRights;
  constructor(private loader: ImageLoader = loadImage) {}
  getSnapshot = () => this.state;
  /** UI drafts share history transaction ownership, including no-op undo/restore. */
  get inTransaction() {
    return this.history?.inTransaction ?? false;
  }
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  subscribeChanges = (callback: (change: ImageEditorChange) => void) => {
    this.changes.add(callback);
    return () => {
      this.changes.delete(callback);
    };
  };
  private changed() {
    const doc = this.history?.current;
    if (doc) {
      const change = {
        width: doc.width,
        height: doc.height,
        hasChanges: this.hasChanges(),
        geometryKey: JSON.stringify([
          this.imageKey,
          doc.width,
          doc.height,
          doc.imageMatrix,
        ]),
      };
      this.changes.forEach((listener) => listener(change));
    }
  }
  private emit(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  activate() {
    if (this.state.phase === 'destroyed')
      this.emit({ phase: 'idle', error: null });
  }
  destroy() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.assetControllers.forEach((controller) => controller.abort());
    this.assetControllers.clear();
    this.assets = new Map();
    this.exportFinalizer = null;
    this.image = null;
    this.sourceExif = null;
    this.history = null;
    this.emit({
      phase: 'destroyed',
      document: null,
      selected: null,
      selectedIds: [],
      canUndo: false,
      canRedo: false,
    });
  }
  beforeExport(callback: (() => void) | null) {
    this.exportFinalizer = callback;
    return () => {
      if (this.exportFinalizer === callback) this.exportFinalizer = null;
    };
  }
  private flush() {
    const finalize = this.exportFinalizer;
    this.exportFinalizer = null;
    finalize?.();
    this.end();
  }
  async reset(url = this.url): Promise<void> {
    if (this.state.phase === 'destroyed')
      throw new Error('Editor was destroyed');
    const previousUrl = this.loadedUrl,
      previousSelection = this.state.selected,
      previousSelectedIds = this.state.selectedIds;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.url = url;
    this.emit({ phase: 'loading', error: null });
    try {
      const image = await (this.state.options.imageLoader ?? this.loader)(
        url,
        controller.signal
      );
      let sourceExif: Uint8Array | null = null;
      if (image.sourceBlob) {
        const signature = new Uint8Array(
          await image.sourceBlob.slice(0, 2).arrayBuffer()
        );
        if (signature[0] === 0xff && signature[1] === 0xd8)
          sourceExif = readJpegExif(
            new Uint8Array(await image.sourceBlob.arrayBuffer())
          );
      }
      if (generation !== this.generation || controller.signal.aborted)
        throw abortError();
      const doc = createDocument(image.width, image.height);
      this.image = image;
      this.sourceExif = sourceExif;
      this.assetControllers.forEach((pending) => pending.abort());
      this.assetControllers.clear();
      this.assets = new Map();
      this.loadedUrl = url;
      this.imageKey++;
      this.exportFinalizer = null;
      this.history = new DocumentHistory(doc);
      this.emit({
        phase: 'ready',
        document: doc,
        error: null,
        selected: null,
        selectedIds: [],
        canUndo: false,
        canRedo: false,
        revision: this.state.revision + 1,
        imageRevision: this.imageKey,
      });
      this.changed();
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) {
        this.url = previousUrl;
        this.emit({
          phase: this.history ? 'ready' : 'error',
          selected: previousSelection,
          selectedIds: previousSelectedIds,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
      throw error;
    }
  }
  updateOptions(options: Partial<MountOptions>) {
    if (this.state.phase === 'destroyed') return;
    const {
      image: url,
      container: _container,
      onSave: _onSave,
      onCancel: _onCancel,
      onLoadError: _onLoadError,
      ...presentation
    } = options;
    if (presentation.crop !== undefined)
      presentation.crop = parseCropOptions(presentation.crop);
    if (
      'layerRights' in presentation &&
      presentation.layerRights !== this.state.options.layerRights
    ) {
      presentation.layerRights = parseLayerRightsDefaults(
        presentation.layerRights
      );
      this.rights = presentation.layerRights
        ? rightsResolver(presentation.layerRights)
        : defaultRights;
    }
    this.emit({ options: { ...this.state.options, ...presentation } });
    // Newly denied selection drops out of the current selection.
    if ('layerRights' in presentation) this.selectMany(this.state.selectedIds);
    if (url !== undefined && url !== this.url)
      void this.reset(url).catch(() => {
        /* Failure is exposed in state and the component callback. */
      });
  }
  private outputOptions(options: ImageExportOptions = {}): ImageExportOptions {
    return parseExportOptions({
      ...this.state.options.export,
      ...options,
      type: options.type ?? this.state.options.export?.type ?? 'image/png',
    });
  }
  getExportOptions() {
    return this.outputOptions();
  }
  getImage(options?: ImageExportOptions) {
    if (this.state.phase !== 'ready') return null;
    this.outputOptions(options);
    this.flush();
    const output = this.outputOptions(options);
    if (!this.history || !this.image) return null;
    const canvas = exportCanvas(
        this.history.current,
        this.image.source,
        output,
        this.assets,
        this.rights
      ),
      dataUrl = canvas.toDataURL(output.type, output.quality);
    return output.metadata === 'strip'
      ? dataUrl
      : addJpegExifToDataUrl(
          dataUrl,
          this.sourceExif,
          canvas.width,
          canvas.height
        );
  }
  async getBlob(options?: ImageExportOptions): Promise<Blob> {
    if (this.state.phase !== 'ready' || !this.history || !this.image)
      throw new Error('Editor is not ready');
    this.outputOptions(options);
    this.flush();
    const output = this.outputOptions(options);
    const canvas = exportCanvas(
      this.history.current,
      this.image.source,
      output,
      this.assets,
      this.rights
    );
    const exif = this.sourceExif;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Image export failed')),
        output.type,
        output.quality
      )
    );
    if (output.metadata === 'strip' || blob.type !== 'image/jpeg' || !exif)
      return blob;
    const bytes = addJpegExif(
      new Uint8Array(await blob.arrayBuffer()),
      exif,
      canvas.width,
      canvas.height
    );
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: blob.type });
  }
  getSource() {
    return this.image?.source ?? null;
  }
  async getSourceBlob(): Promise<Blob> {
    const image = this.image;
    if (!image) throw new Error('Editor is not ready');
    if (image.sourceBlob) return image.sourceBlob;
    const canvas = exportCanvas(
      createDocument(image.width, image.height),
      image.source
    );
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Source image export failed')),
        'image/png'
      )
    );
  }
  getDocument() {
    if (this.state.phase !== 'ready' || !this.history) return null;
    this.flush();
    return parseDocument(this.history.current);
  }
  async restoreDocument(input: ImageDocument | string): Promise<void> {
    if (this.state.phase !== 'ready' || !this.history)
      throw new Error('Editor is not ready');
    const doc = parseDocument(input),
      generation = this.generation,
      restoreGeneration = ++this.restoreGeneration,
      documentRevision = this.documentRevision,
      controller = new AbortController(),
      sources = [
        ...new Set(
          doc.layers
            .filter((layer) => layer.kind === 'image')
            .map((layer) => layer.imageSource!)
        ),
      ],
      assets = new Map(this.assets);
    this.assetControllers.add(controller);
    try {
      await Promise.all(
        sources.map(async (source) => {
          if (assets.has(source)) return;
          const image = await (this.state.options.imageLoader ?? this.loader)(
            source,
            controller.signal
          );
          dimensions(image.width, image.height);
          assets.set(source, image.source);
        })
      );
      if (
        generation !== this.generation ||
        restoreGeneration !== this.restoreGeneration ||
        documentRevision !== this.documentRevision ||
        controller.signal.aborted ||
        this.state.phase !== 'ready'
      )
        throw abortError();
      this.exportFinalizer = null;
      this.history.cancel();
      this.assets = assets;
      this.commit(doc);
      this.select(null);
    } finally {
      controller.abort();
      this.assetControllers.delete(controller);
    }
  }
  async addImage(url: string): Promise<void> {
    if (this.state.phase !== 'ready' || !this.history)
      throw new Error('Editor is not ready');
    const generation = this.generation,
      controller = new AbortController();
    this.assetControllers.add(controller);
    try {
      const image = await (this.state.options.imageLoader ?? this.loader)(
          url,
          controller.signal
        ),
        size = dimensions(image.width, image.height);
      if (
        generation !== this.generation ||
        controller.signal.aborted ||
        this.state.phase !== 'ready'
      )
        throw abortError();
      // Embed a raster snapshot so saved documents never depend on revoked blob URLs.
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas2D is unavailable');
      ctx.drawImage(image.source, 0, 0, size.width, size.height);
      const imageSource = canvas.toDataURL('image/png'),
        doc = this.history.current,
        factor = Math.min(
          1,
          (doc.width * 0.6) / size.width,
          (doc.height * 0.6) / size.height
        ),
        width = size.width * factor,
        height = size.height * factor,
        id = crypto.randomUUID();
      this.assets.set(imageSource, canvas);
      this.commit({
        ...doc,
        layers: [
          ...doc.layers,
          {
            id,
            kind: 'image',
            imageSource,
            matrix: translate(
              (doc.width - width) / 2,
              (doc.height - height) / 2
            ),
            width,
            height,
            color: '#000000',
            fill: 'transparent',
            strokeWidth: 0,
            opacity: 1,
          },
        ],
      });
      this.select(id);
    } finally {
      controller.abort();
      this.assetControllers.delete(controller);
    }
  }
  revert() {
    if (this.state.phase !== 'ready' || !this.history) return;
    this.exportFinalizer = null;
    this.history.cancel();
    this.commit(this.history.baseline);
    this.select(null);
  }
  hasChanges() {
    return this.history?.changed ?? false;
  }
  select(selected: string | null) {
    this.selectMany(selected ? [selected] : []);
  }
  selectMany(ids: readonly string[]) {
    const selectedIds = [...new Set(ids)].filter((id) =>
      this.state.document?.layers.some(
        (layer) => layer.id === id && this.selectable(layer)
      )
    );
    this.emit({ selectedIds, selected: selectedIds.at(-1) ?? null });
  }
  toggleSelection(id: string) {
    this.selectMany(
      this.state.selectedIds.includes(id)
        ? this.state.selectedIds.filter((selected) => selected !== id)
        : [...this.state.selectedIds, id]
    );
  }
  private publish(committed = false) {
    if (!this.history) return;
    if (this.history.current !== this.state.document) this.documentRevision++;
    const selectedIds = this.state.selectedIds.filter((id) =>
        this.history!.current.layers.some(
          (layer) => layer.id === id && this.selectable(layer)
        )
      ),
      selected = selectedIds.at(-1) ?? null;
    this.emit({
      document: this.history.current,
      selected,
      selectedIds,
      canUndo: this.history.past.length > 0,
      canRedo: this.history.future.length > 0,
      revision: this.state.revision + 1,
    });
    if (committed) this.changed();
  }
  commit(document: ImageDocument) {
    if (this.state.phase !== 'ready' || !this.history) return;
    const changed = this.history.commit(document);
    this.publish(changed);
  }
  begin() {
    if (this.state.phase === 'ready') this.history?.begin();
  }
  preview(document: ImageDocument) {
    if (this.state.phase !== 'ready' || !this.history) return;
    this.history.preview(document);
    this.publish();
  }
  end() {
    if (!this.history) return;
    const changed = this.history.commit();
    this.publish(changed);
  }
  cancel() {
    this.history?.cancel();
    this.publish();
  }
  undo() {
    if (this.state.phase !== 'ready') return;
    const before = this.history?.current;
    this.history?.undo();
    this.publish(before !== this.history?.current);
  }
  redo() {
    if (this.state.phase !== 'ready') return;
    const before = this.history?.current;
    this.history?.redo();
    this.publish(before !== this.history?.current);
  }
  /** Removes the selected layers that allow deletion; protected members stay. */
  removeSelected() {
    const doc = this.state.document;
    if (doc && this.state.selectedIds.length)
      this.commit({
        ...doc,
        layers: doc.layers.filter(
          (layer) =>
            !this.state.selectedIds.includes(layer.id) ||
            !this.rights(layer).delete
        ),
      });
  }
  private selectable(layer: Layer) {
    return !layer.hidden && this.rights(layer).select;
  }
  /** Effective rights of a layer in the current document, or null when it does not exist. */
  getLayerRights(id: string): ResolvedLayerRights | null {
    const layer = this.history?.current.layers.find((item) => item.id === id);
    return layer ? this.rights(layer) : null;
  }
  /**
   * Replace a layer's own rights (`null` clears them). Rights are policy, not an edit:
   * every undo/redo snapshot is updated too, so history cannot restore earlier rights.
   */
  setLayerRights(id: string, rights: LayerRights | null) {
    if (this.state.phase !== 'ready' || !this.history) return;
    const parsed = parseLayerRights(rights ?? undefined);
    this.history.rewrite((doc) =>
      doc.layers.some((layer) => layer.id === id)
        ? {
            ...doc,
            layers: doc.layers.map((layer) => {
              if (layer.id !== id) return layer;
              const { rights: _previous, ...rest } = layer;
              return parsed ? { ...rest, rights: parsed } : rest;
            }),
          }
        : doc
    );
    this.publish(true);
  }
}
