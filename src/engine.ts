import {
  createDocument,
  dimensions,
  DocumentHistory,
  ImageDocument,
  parseDocument,
  translate,
} from './model';
import { exportCanvas } from './render';
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
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  imageRevision: number;
};
export const abortError = () =>
  new DOMException('Image loading was superseded', 'AbortError');
export const isAbort = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';
export function loadImage(
  url: string,
  signal: AbortSignal
): Promise<LoadedImage> {
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
/** Owns document/history and image lifetimes. No DOM/UI dependency until load/export. */
export class CanvasEngine implements ImageEditorInstance {
  private state: EngineState = {
    phase: 'idle',
    document: null,
    options: {},
    error: null,
    selected: null,
    canUndo: false,
    canRedo: false,
    revision: 0,
    imageRevision: 0,
  };
  private listeners = new Set<() => void>();
  private changes = new Set<(change: ImageEditorChange) => void>();
  private imageKey = 0;
  private generation = 0;
  private controller: AbortController | null = null;
  private url = '';
  private loadedUrl = '';
  private exportFinalizer: (() => void) | null = null;
  private history: DocumentHistory | null = null;
  private restoreGeneration = 0;
  private assetControllers = new Set<AbortController>();
  /** Decoded image layers are owned by the engine; documents only contain serializable sources. */
  assets = new Map<string, CanvasImageSource>();
  image: LoadedImage | null = null;
  constructor(private loader: ImageLoader = loadImage) {}
  getSnapshot = () => this.state;
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
    this.history = null;
    this.emit({
      phase: 'destroyed',
      document: null,
      selected: null,
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
      previousSelection = this.state.selected;
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
      if (generation !== this.generation || controller.signal.aborted)
        throw abortError();
      const doc = createDocument(image.width, image.height);
      this.image = image;
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
    this.emit({ options: { ...this.state.options, ...presentation } });
    if (url !== undefined && url !== this.url)
      void this.reset(url).catch(() => {
        /* Failure is exposed in state and the component callback. */
      });
  }
  private outputOptions(options: ImageExportOptions = {}): ImageExportOptions {
    const output = {
      ...this.state.options.export,
      ...options,
      type: options.type ?? this.state.options.export?.type ?? 'image/png',
    };
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.type))
      throw new Error('Unsupported image format');
    if (
      output.quality !== undefined &&
      (!Number.isFinite(output.quality) ||
        output.quality < 0 ||
        output.quality > 1)
    )
      throw new Error('Invalid image quality');
    // Validate supplied dimensions before an export can finalize pending UI edits.
    dimensions(output.width ?? 1, output.height ?? 1);
    return output;
  }
  getImage(options?: ImageExportOptions) {
    if (this.state.phase !== 'ready') return null;
    const output = this.outputOptions(options);
    this.flush();
    return this.history && this.image
      ? exportCanvas(
          this.history.current,
          this.image.source,
          output,
          this.assets
        ).toDataURL(output.type, output.quality)
      : null;
  }
  async getBlob(options?: ImageExportOptions): Promise<Blob> {
    if (this.state.phase !== 'ready' || !this.history || !this.image)
      throw new Error('Editor is not ready');
    const output = this.outputOptions(options);
    this.flush();
    const canvas = exportCanvas(
      this.history.current,
      this.image.source,
      output,
      this.assets
    );
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Image export failed')),
        output.type,
        output.quality
      )
    );
  }
  getSource() {
    return this.image?.source ?? null;
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
      revision = this.state.revision,
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
        revision !== this.state.revision ||
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
    this.emit({
      selected:
        selected &&
        this.state.document?.layers.some(
          (layer) => layer.id === selected && !layer.locked && !layer.hidden
        )
          ? selected
          : null,
    });
  }
  private publish(committed = false) {
    if (!this.history) return;
    const selected = this.history.current.layers.some(
      (layer) =>
        layer.id === this.state.selected && !layer.locked && !layer.hidden
    )
      ? this.state.selected
      : null;
    this.emit({
      document: this.history.current,
      selected,
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
  removeSelected() {
    const doc = this.state.document;
    if (
      doc &&
      this.state.selected &&
      doc.layers.some(
        (layer) => layer.id === this.state.selected && !layer.locked
      )
    )
      this.commit({
        ...doc,
        layers: doc.layers.filter((layer) => layer.id !== this.state.selected),
      });
  }
}
