import type { CSSProperties, ReactNode } from 'react';
export type ImageEditorLocale = 'en' | 'cs' | 'sk' | 'pl' | (string & {});
export type ImageEditorTranslations = Record<string, Record<string, string>>;
export type EditorTool =
  'select' | 'crop' | 'resize' | 'draw' | 'text' | 'shapes' | 'filter';
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
  /** PNG at document pixel dimensions, with alpha and without selection/UI chrome. */
  getImage(): string | null;
  getBlob(): Promise<Blob>;
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
