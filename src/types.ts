import type { CSSProperties, ReactNode } from 'react';
import type { ImageDocument } from './model';
import type { ImageExportOptions } from './exportOptions';
import type { RichTextRenderer } from './RichTextInput';
import type { CropOptions } from './crop';
import type {
  LayerRights,
  LayerRightsDefaults,
  ResolvedLayerRights,
} from './rights';
export type {
  LayerRight,
  LayerRights,
  LayerRightsDefaults,
  ResolvedLayerRights,
} from './rights';
export type {
  CropOptions,
  CropPreset,
  CropGuides,
  CropSource,
  CropSize,
  CropIntent,
  ResolvedCropOptions,
} from './crop';
export type { ImageExportOptions } from './exportOptions';
export type {
  ImageDocument,
  Layer,
  Effects,
  Frame,
  Matrix,
  Point,
  Rect,
  LineEnd,
  TextRun,
  TextStyle,
  ResolvedTextStyle,
} from './model';
export type ImageEditorLocale = 'en' | 'cs' | 'sk' | 'pl' | (string & {});
export type ImageEditorTranslations = Record<string, Record<string, string>>;
export type EditorTool =
  | 'select'
  | 'crop'
  | 'resize'
  | 'draw'
  | 'text'
  | 'shapes'
  | 'filter'
  | 'adjust'
  | 'stickers'
  | 'frame'
  | 'fill'
  | 'redact';
export interface ImageEditorLoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Owned original encoded bytes; optional custom loaders otherwise fall back to PNG. */
  sourceBlob?: Blob;
}
export type ImageEditorImageLoader = (
  url: string,
  signal: AbortSignal
) => Promise<ImageEditorLoadedImage>;
export interface ImageEditorSaveResult {
  dataUrl: string;
  blob: Blob;
}
export interface ImageEditorChange {
  width: number;
  height: number;
  hasChanges: boolean;
  geometryKey: string;
}
export interface ImageEditorOptions {
  theme?: 'light' | 'dark';
  locale?: ImageEditorLocale;
  translations?: ImageEditorTranslations;
  /** Hide Save/Cancel when the host owns persistence. Defaults to true. */
  showActions?: boolean;
  /** Default encoding options used by Save, getImage and getBlob. */
  export?: ImageExportOptions;
  /** Non-destructive crop behavior and shared gesture/input constraints. */
  crop?: CropOptions;
  /**
   * Default editing rights: `all` first, then per layer kind. A layer's own
   * `rights` override these; `locked` still denies every selection-based right.
   */
  layerRights?: LayerRightsDefaults;
  /** A loader must return origin-clean pixels; aborted loads may never replace the current draft. */
  imageLoader?: ImageEditorImageLoader;
  features?: {
    imageEditor?: {
      dock?: 'left' | 'right';
      tools?: Partial<
        Record<EditorTool | 'stickers' | 'frame' | 'corners', boolean>
      >;
    };
    /** @deprecated AI belongs to the host. This value has no effect. */
    ai?: unknown;
  };
  /** @deprecated Compatibility fields only. No external service or license is used. */
  projectId?: number;
  user?: unknown;
  env?: Record<string, string>;
  offline?: boolean;
  licenseUrl?: string;
  defaultPrompt?: string;
  autoSubmitPrompt?: boolean;
  aiAssistantOpenState?: 'open' | 'closed';
}
export interface MountOptions extends ImageEditorOptions {
  container: string | HTMLElement;
  image: string;
  onSave?: (result: ImageEditorSaveResult) => void;
  onCancel?: () => void;
  onLoadError?: () => void;
}
export interface ImageEditorInstance {
  destroy(): void;
  /** Exports pixels without selection/UI chrome. Pending crop and text edits are committed first. */
  getImage(options?: ImageExportOptions): string | null;
  getBlob(options?: ImageExportOptions): Promise<Blob>;
  /** Independent, validated output settings, suitable for persistence alongside the document. */
  getExportOptions(): ImageExportOptions;
  /** Independent JSON-safe editable state; the host owns the original image source separately. */
  getDocument(): ImageDocument | null;
  /** Restores state against the currently loaded original image; failure preserves the draft. */
  restoreDocument(document: ImageDocument | string): Promise<void>;
  /** Import an image as an editable, embedded layer. */
  addImage(url: string): Promise<void>;
  /** Effective rights of a layer, after editor defaults and `locked`; null if absent. */
  getLayerRights(id: string): ResolvedLayerRights | null;
  /** Replace one layer's own rights (null clears them) without an undoable edit. */
  setLayerRights(id: string, rights: LayerRights | null): void;
  /** Original loaded pixels for thumbnails and comparison. */
  getSource(): CanvasImageSource | null;
  /** Original encoded source, independent of crop, layers and output settings. */
  getSourceBlob(): Promise<Blob>;
  /** Restore the original document as one undoable edit, without reloading the source. */
  revert(): void;
  hasChanges(): boolean;
  /** Presentation changes do not reset the document or its history. */
  updateOptions(options: Partial<MountOptions>): void;
  /** Load a new baseline, clearing selection/history. Latest requested image wins. */
  reset(imageUrl?: string): Promise<void>;
}
export type ImageEditorLoadingFallback = ReactNode;
export type ImageEditorErrorFallback =
  ReactNode | ((error: Error, retry: () => void) => ReactNode);
export interface ImageEditorProps {
  image: string;
  /** Reuse a host rich editor with the same controlled content and selection contract. */
  renderTextInput?: RichTextRenderer;
  options?: ImageEditorOptions;
  editorId?: string;
  minHeight?: number | string;
  style?: CSSProperties;
  className?: string;
  wrapperStyle?: CSSProperties;
  wrapperClassName?: string;
  ariaLabel?: string;
  /** @deprecated Ignored. The editor is bundled locally and never loads scripts. */
  scriptUrl?: string;
  loadingFallback?: ImageEditorLoadingFallback;
  errorFallback?: ImageEditorErrorFallback;
  onLoad?(editor: ImageEditorInstance): void;
  onError?(error: Error): void;
  onSave?(result: ImageEditorSaveResult): void;
  /** Committed edits, undo/redo and successful image resets; never pointer previews. */
  onChange?(change: ImageEditorChange): void;
  onCancel?(): void;
  onLoadError?(): void;
}
export interface ImageEditorRef {
  editor: ImageEditorInstance | null;
}
