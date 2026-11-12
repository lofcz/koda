import {
  createDocument,
  DEFAULT_EFFECTS,
  dimensions,
  DocumentHistory,
  ImageDocument,
  parseDocument,
  scale,
  translate,
  type Matrix,
} from './model';
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
  /** Changes when a new image is loaded as the baseline; the UI restarts. */
  imageRevision: number;
  /** Identifies the source pixels on screen; base replacement and undo move it. */
  sourceRevision: number;
};
/** Source pixels referenced by a history entry. */
type SourceRecord = {
  image: LoadedImage;
  exif: Uint8Array | null;
  key: number;
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
async function readSourceExif(image: LoadedImage) {
  if (!image.sourceBlob) return null;
  const signature = new Uint8Array(
    await image.sourceBlob.slice(0, 2).arrayBuffer()
  );
  return signature[0] === 0xff && signature[1] === 0xd8
    ? readJpegExif(new Uint8Array(await image.sourceBlob.arrayBuffer()))
    : null;
}
/** The pixels AI and other base edits replace: no frame, background, corners or
 * layers, except visible redactions, so hidden content never leaves the editor.
 * Redactions also stay layers above the replacement. */
function baseDocument(doc: ImageDocument): ImageDocument {
  return {
    ...doc,
    layers: doc.layers.filter(
      (layer) => layer.kind === 'redaction' && !layer.hidden
    ),
    background: 'transparent',
    frame: { ...doc.frame, style: 'none' },
    cornerRadius: 0,
  };
}
/** Largest relative aspect difference that is stretched rather than cover-fitted. */
export const BASE_STRETCH_TOLERANCE = 0.015;
/**
 * Image models return a nearby supported size. A rounding-sized aspect difference is
 * stretched invisibly, keeping masks and layers exactly aligned. A larger difference is
 * cover-fitted and centered, preserving the aspect ratio: the model rendered the same
 * scene for its own canvas. Overflowing pixels stay in the source, recoverable by crop.
 */
export function placeBase(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  image: { width: number; height: number }
): Matrix {
  const x = doc.width / image.width,
    y = doc.height / image.height;
  if (Math.max(x, y) / Math.min(x, y) - 1 <= BASE_STRETCH_TOLERANCE)
    return scale(x, y);
  const factor = Math.max(x, y);
  return [
    factor,
    0,
    0,
    factor,
    (doc.width - image.width * factor) / 2,
    (doc.height - image.height * factor) / 2,
  ];
}
const baseKey = (doc: ImageDocument) =>
  JSON.stringify([doc.width, doc.height, doc.imageMatrix, doc.effects]);
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
    sourceRevision: 0,
  };
  private listeners = new Set<() => void>();
  private changes = new Set<(change: ImageEditorChange) => void>();
  private imageKey = 0;
  private sourceKey = 0;
  private source: SourceRecord | null = null;
  private replaceController: AbortController | null = null;
  private generation = 0;
  /** Tracks document ownership separately from render and no-op lifecycle notifications. */
  private documentRevision = 0;
  private controller: AbortController | null = null;
  private url = '';
  private loadedUrl = '';
  private exportFinalizer: (() => void) | null = null;
  private history: DocumentHistory<SourceRecord> | null = null;
  private sourceExif: Uint8Array | null = null;
  private restoreGeneration = 0;
  private assetControllers = new Set<AbortController>();
  /** Decoded image layers are owned by the engine; documents only contain serializable sources. */
  assets = new Map<string, CanvasImageSource>();
  image: LoadedImage | null = null;
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
          this.source?.key ?? 0,
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
    this.source = null;
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
      const sourceExif = await readSourceExif(image);
      if (generation !== this.generation || controller.signal.aborted)
        throw abortError();
      const doc = createDocument(image.width, image.height);
      const source = { image, exif: sourceExif, key: ++this.sourceKey };
      this.source = source;
      this.image = image;
      this.sourceExif = sourceExif;
      this.assetControllers.forEach((pending) => pending.abort());
      this.assetControllers.clear();
      this.assets = new Map();
      this.loadedUrl = url;
      this.imageKey++;
      this.exportFinalizer = null;
      this.history = new DocumentHistory(doc, 100, source);
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
        sourceRevision: source.key,
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
    this.emit({ options: { ...this.state.options, ...presentation } });
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
        this.assets
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
      this.assets
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
  /** The photo at document size with its geometry and adjustments, without layers or decoration. */
  getBaseImage(options: ImageExportOptions = {}) {
    if (this.state.phase !== 'ready') return null;
    const output = parseExportOptions({ type: 'image/png', ...options });
    this.flush();
    if (!this.history || !this.image) return null;
    const canvas = exportCanvas(
        baseDocument(this.history.current),
        this.image.source,
        output
      ),
      dataUrl = canvas.toDataURL(output.type, output.quality);
    return output.metadata === 'preserve'
      ? addJpegExifToDataUrl(
          dataUrl,
          this.sourceExif,
          canvas.width,
          canvas.height
        )
      : dataUrl;
  }
  /**
   * Replace the base pixels with an edited copy of getBaseImage(), as one undoable
   * edit. The new source fills the document, so geometry and adjustments already
   * baked into it are reset; layers, frame and background stay editable. Undo
   * restores the previous source, geometry and adjustments exactly. The latest
   * replacement wins, and a failed or superseded load leaves the draft untouched.
   */
  async replaceBase(input: string | LoadedImage): Promise<void> {
    if (this.state.phase !== 'ready' || !this.history)
      throw new Error('Editor is not ready');
    const generation = this.generation,
      previous = this.history.source,
      previousBase = baseKey(this.history.current),
      controller = new AbortController();
    this.replaceController?.abort();
    this.replaceController = controller;
    this.assetControllers.add(controller);
    try {
      const image =
          typeof input === 'string'
            ? await (this.state.options.imageLoader ?? this.loader)(
                input,
                controller.signal
              )
            : input,
        exif = await readSourceExif(image);
      dimensions(image.width, image.height);
      if (
        generation !== this.generation ||
        controller.signal.aborted ||
        this.state.phase !== 'ready' ||
        !this.history ||
        this.history.source !== previous ||
        baseKey(this.history.current) !== previousBase
      )
        throw abortError();
      this.flush();
      const doc = this.history.current;
      this.history.commit(
        {
          ...doc,
          imageMatrix: placeBase(doc, image),
          effects: DEFAULT_EFFECTS,
        },
        { image, exif, key: ++this.sourceKey }
      );
      this.publish(true);
    } finally {
      controller.abort();
      this.assetControllers.delete(controller);
      if (this.replaceController === controller) this.replaceController = null;
    }
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
    this.publish(
      this.history.commit(this.history.baseline, this.history.baselineSource)
    );
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
        (layer) => layer.id === id && !layer.locked && !layer.hidden
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
    const source = this.history.source;
    if (source !== this.source) {
      this.source = source;
      this.image = source.image;
      this.sourceExif = source.exif;
    }
    const selectedIds = this.state.selectedIds.filter((id) =>
        this.history!.current.layers.some(
          (layer) => layer.id === id && !layer.locked && !layer.hidden
        )
      ),
      selected = selectedIds.at(-1) ?? null;
    this.emit({
      document: this.history.current,
      selected,
      selectedIds,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      revision: this.state.revision + 1,
      sourceRevision: source.key,
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
    if (doc && this.state.selectedIds.length)
      this.commit({
        ...doc,
        layers: doc.layers.filter(
          (layer) => !this.state.selectedIds.includes(layer.id) || layer.locked
        ),
      });
  }
}
