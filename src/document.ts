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
} from './model';
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
