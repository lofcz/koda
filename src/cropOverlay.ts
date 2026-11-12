import { cropBleedInsets, cropOutputSize, parseCropBleed } from './crop';
import type { CropOptions, CropSize } from './crop';
import type { Rect } from './model';

/**
 * Viewport-only crop chrome for the interaction canvas. Nothing here touches the document, so
 * the profile circle and print guides can never reach exported pixels.
 */
type Context = CanvasRenderingContext2D;

const ellipse = (ui: Context, rect: Rect) =>
  ui.ellipse(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.width / 2,
    rect.height / 2,
    0,
    0,
    Math.PI * 2
  );

/** Dim everything outside the crop, or outside its inscribed ellipse for the profile overlay. */
export function paintCropMask(
  ui: Context,
  viewport: CropSize,
  rect: Rect,
  options: CropOptions
) {
  ui.fillStyle = `rgba(5,12,20,${options.maskOpacity ?? 0.75})`;
  ui.beginPath();
  ui.rect(0, 0, viewport.width, viewport.height);
  if (options.overlay === 'circle') ellipse(ui, rect);
  else ui.rect(rect.x, rect.y, rect.width, rect.height);
  ui.fill('evenodd');
}

/** Restrict following guide strokes to the visible profile area. Pair with `ui.restore()`. */
export function clipCropGuides(ui: Context, rect: Rect, options: CropOptions) {
  ui.save();
  if (options.overlay !== 'circle') return;
  ui.beginPath();
  ellipse(ui, rect);
  ui.clip();
}

/** Profile outline plus bleed band, trim line and dashed safe-area line. */
export function paintCropOverlay(
  ui: Context,
  rect: Rect,
  crop: Rect,
  options: CropOptions,
  output?: CropSize
) {
  ui.save();
  if (options.overlay === 'circle') {
    ui.beginPath();
    ellipse(ui, rect);
    ui.strokeStyle = 'rgba(15,23,42,.45)';
    ui.lineWidth = 3;
    ui.stroke();
    ui.strokeStyle = '#fff';
    ui.lineWidth = 1.5;
    ui.stroke();
  }
  const bleed = parseCropBleed(options.bleed);
  if (bleed && (bleed.bleed > 0 || bleed.safe > 0)) {
    const insets = cropBleedInsets(
        crop,
        output ?? cropOutputSize(crop, options),
        bleed
      ),
      zoom = { x: rect.width / crop.width, y: rect.height / crop.height };
    const inset = (point: { x: number; y: number }): Rect => ({
      x: rect.x + point.x * zoom.x,
      y: rect.y + point.y * zoom.y,
      width: Math.max(0, rect.width - 2 * point.x * zoom.x),
      height: Math.max(0, rect.height - 2 * point.y * zoom.y),
    });
    const line = (target: Rect, color: string, dash: number[]) => {
      ui.setLineDash([]);
      ui.strokeStyle = 'rgba(15,23,42,.5)';
      ui.lineWidth = 3;
      ui.strokeRect(target.x, target.y, target.width, target.height);
      ui.setLineDash(dash);
      ui.strokeStyle = color;
      ui.lineWidth = 1.5;
      ui.strokeRect(target.x, target.y, target.width, target.height);
    };
    if (bleed.bleed > 0) {
      const trim = inset(insets.bleed);
      ui.fillStyle = 'rgba(225,29,72,.32)';
      ui.beginPath();
      ui.rect(rect.x, rect.y, rect.width, rect.height);
      ui.rect(trim.x, trim.y, trim.width, trim.height);
      ui.fill('evenodd');
      line(trim, '#fb7185', []);
    }
    if (bleed.safe > 0) line(inset(insets.safe), '#fff', [6, 4]);
  }
  ui.restore();
}
