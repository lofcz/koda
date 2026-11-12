/** Serializable document validation and geometry, safe in browsers and servers. */
export { parseExportOptions, resolveExportSize } from './exportOptions';
export type { ImageExportOptions } from './exportOptions';
export {
  createDocument,
  parseDocument,
  DEFAULT_EFFECTS,
  DEFAULT_FRAME,
  MAX_DIMENSION,
  MAX_PIXELS,
} from './model';
export type {
  ImageDocument,
  Layer,
  Effects,
  Frame,
  Matrix,
  Point,
  Rect,
  LineEnd,
  ShapeKind,
  TextRun,
  TextStyle,
  ResolvedTextStyle,
  BackgroundImage,
  BackgroundFit,
  FrameImage,
  FrameRepeat,
  SliceInsets,
} from './model';
export {
  backgroundPlacement,
  parseBackgroundImage,
  DEFAULT_BACKGROUND_IMAGE,
} from './backgrounds';
export {
  parseFrameImage,
  nineSlice,
  sliceScale,
  frameImageInsets,
  frameMargins,
  validSlice,
} from './frames';
export { applyFrame } from './model';
export {
  LAYER_RIGHTS,
  parseLayerRights,
  parseLayerRightsDefaults,
  resolveLayerRights,
} from './rights';
export type {
  LayerRight,
  LayerRights,
  LayerRightsDefaults,
  ResolvedLayerRights,
} from './rights';
export {
  normalizeTextRuns,
  textContent,
  resolveTextStyle,
  graphemes,
} from './textModel';
export {
  layoutText,
  textCaret,
  textSelectionRects,
  textIndexAt,
} from './textLayout';
export type { TextLayout, TextLine, TextSpan, TextMeasure } from './textLayout';
export {
  parseCropOptions,
  constrainCropRect,
  constrainImageToCrop,
  applyCrop,
  transformImage,
  sourceBounds,
  sourceContainsRect,
  cropOutputSize,
  CropConstraintError,
} from './crop';
export type {
  CropOptions,
  CropPreset,
  CropGuides,
  CropSource,
  CropSize,
  CropIntent,
  ResolvedCropOptions,
} from './crop';
