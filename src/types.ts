import type { CSSProperties, ReactNode } from 'react';
import type { ImageDocument } from './model';
import type { ImageExportOptions } from './exportOptions';
import type { RichTextRenderer } from './RichTextInput';
import type { CropOptions } from './crop';
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
  /**
   * The photo with its crop, rotation, resize and adjustments at document size, without
   * layers, frame, background or rounded corners. Defaults to PNG without metadata.
   * Coordinates match the document, so a mask drawn over the document lines up.
   */
  getBaseImage(options?: ImageExportOptions): string | null;
  /**
   * Replace the base pixels (usually an edited getBaseImage() result) as one undoable edit.
   * The new source is stretched to fill the document; geometry and adjustments it already
   * contains are reset. Layers, frame and background stay editable. Undo restores the
   * previous source pixels, geometry and adjustments. The latest call wins; a failed or
   * superseded load, or a base changed while loading, rejects and leaves the draft untouched.
   */
  replaceBase(image: string | ImageEditorLoadedImage): Promise<void>;
  /** Independent, validated output settings, suitable for persistence alongside the document. */
  getExportOptions(): ImageExportOptions;
  /** Independent JSON-safe editable state; the host owns the original image source separately. */
  getDocument(): ImageDocument | null;
  /** Restores state against the current source image; failure preserves the draft. */
  restoreDocument(document: ImageDocument | string): Promise<void>;
  /** Import an image as an editable, embedded layer. */
  addImage(url: string): Promise<void>;
  /** Current source pixels (the loaded image, or the latest replaceBase image) for thumbnails and comparison. */
  getSource(): CanvasImageSource | null;
  /** Current encoded source, independent of crop, layers and output settings. Persist it with getDocument(). */
  getSourceBlob(): Promise<Blob>;
  /** Restore the original document and source as one undoable edit, without reloading the source. */
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
