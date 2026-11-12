import {
  clamp,
  dimensions,
  ImageDocument,
  Layer,
  LineEnd,
  Matrix,
  Point,
  Rect,
  multiply,
  scale,
  translate,
  transformDocument,
  MAX_DIMENSION,
  MAX_PIXELS,
} from './model';
import type { ImageExportOptions } from './types';
import { resolveExportSize } from './exportOptions';
import { cropOutputSize } from './crop';
import type { CropOptions } from './crop';
import { layoutText } from './textLayout';
import type { TextMeasure } from './textLayout';
import { graphemes, textContent } from './textModel';
import type { ResolvedTextStyle } from './textModel';
import { defaultRights, type RightsResolver } from './rights';

export type ImageAssets = ReadonlyMap<string, CanvasImageSource>;
const EMPTY_ASSETS: ImageAssets = new Map();

function setTextFont(ctx: CanvasRenderingContext2D, style: ResolvedTextStyle) {
  ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  if (typeof ctx.letterSpacing === 'string')
    ctx.letterSpacing = `${style.letterSpacing}px`;
}

function canvasTextMeasure(ctx: CanvasRenderingContext2D): TextMeasure {
  return (text, style) => {
    setTextFont(ctx, style);
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(text);
    let width = metrics.width;
    if (typeof ctx.letterSpacing !== 'string' && style.letterSpacing)
      width = graphemes(text).reduce(
        (n, cluster) =>
          n + ctx.measureText(cluster.text).width + style.letterSpacing,
        0
      );
    return {
      width,
      ascent: metrics.fontBoundingBoxAscent ?? style.fontSize * 0.8,
      descent: metrics.fontBoundingBoxDescent ?? style.fontSize * 0.2,
    };
  };
}
function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  style: ResolvedTextStyle,
  outline = false
) {
  const paint = (value: string, left: number) =>
    outline
      ? ctx.strokeText(value, left, baseline)
      : ctx.fillText(value, left, baseline);
  if (typeof ctx.letterSpacing === 'string' || !style.letterSpacing) {
    paint(text, x);
    return;
  }
  for (const cluster of graphemes(text)) {
    paint(cluster.text, x);
    x += ctx.measureText(cluster.text).width + style.letterSpacing;
  }
}

let textContext: CanvasRenderingContext2D | null = null;
/** Shared by the inspector, canvas editor and renderer; fonts must be loaded before measuring. */
export function measureTextLayer(layer: Layer) {
  textContext ??= document.createElement('canvas').getContext('2d');
  if (!textContext) throw new Error('Canvas2D is unavailable');
  return layoutText(layer, canvasTextMeasure(textContext));
}
/** Reflow a text edit without changing its local transform or fixed box ownership. */
export function fitTextLayer(layer: Layer): Layer {
  const measured = measureTextLayer({
    ...layer,
    textLayout: layer.textLayout ?? 'auto-width',
  });
  return {
    ...layer,
    text: textContent(layer),
    width: measured.width,
    height: measured.height,
  };
}

function apply(ctx: CanvasRenderingContext2D, m: Matrix) {
  ctx.transform(...m);
}
function lineEnd(
  ctx: CanvasRenderingContext2D,
  end: LineEnd,
  x: number,
  y: number,
  angle: number,
  size: number
) {
  if (end === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  if (end === 'arrow') {
    ctx.moveTo(-size * Math.cos(0.45), -size * Math.sin(0.45));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size * Math.cos(0.45), size * Math.sin(0.45));
    ctx.stroke();
  } else {
    if (end === 'circle') ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    else ctx.rect(-size * 0.3, -size * 0.3, size * 0.6, size * 0.6);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
  ctx.restore();
}

function surface(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D is unavailable');
  return { canvas, ctx };
}

/** A redaction samples the already composed pixels beneath it, including older markup. */
function redact(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  backdrop?: CanvasImageSource
) {
  const mode = layer.redactionMode ?? 'pixelate';
  if (mode === 'solid') {
    ctx.fillStyle = layer.color;
    ctx.fillRect(0, 0, layer.width, layer.height);
    return;
  }
  const block = clamp(layer.redactionSize ?? 16, 1, 512),
    // Bound imported local coordinates without changing the transformed region.
    factor = Math.min(
      mode === 'pixelate' ? 1 / block : 1,
      4096 / Math.max(layer.width, layer.height)
    ),
    sample = surface(layer.width * factor, layer.height * factor),
    transform = ctx.getTransform().inverse();
  sample.ctx.scale(
    sample.canvas.width / layer.width,
    sample.canvas.height / layer.height
  );
  sample.ctx.transform(
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f
  );
  if (backdrop) sample.ctx.drawImage(backdrop, 0, 0);
  sample.ctx.drawImage(ctx.canvas, 0, 0);
  if (mode === 'blur') {
    const pixels = sample.ctx.getImageData(
      0,
      0,
      sample.canvas.width,
      sample.canvas.height
    );
    blurPixels(
      pixels.data,
      sample.canvas.width,
      sample.canvas.height,
      Math.max(1, Math.round((block * factor) / 2))
    );
    sample.ctx.putImageData(pixels, 0, 0);
  }
  ctx.beginPath();
  ctx.rect(0, 0, layer.width, layer.height);
  ctx.clip();
  // Interpolate in premultiplied alpha. At full strength this completely replaces
  // the original detail; lower layer opacity blends without doubling image alpha.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, layer.width, layer.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = mode !== 'pixelate';
  ctx.drawImage(sample.canvas, 0, 0, layer.width, layer.height);
}

export function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  assets: ImageAssets = EMPTY_ASSETS,
  backdrop?: CanvasImageSource
) {
  if (layer.hidden || layer.opacity <= 0) return;
  ctx.save();
  apply(ctx, layer.matrix);
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.erase
    ? 'destination-out'
    : 'source-over';
  ctx.lineWidth = layer.strokeWidth;
  ctx.lineCap = layer.strokeCap ?? 'round';
  ctx.lineJoin = layer.strokeJoin ?? 'round';
  ctx.setLineDash([...(layer.strokeDash ?? [])]);
  if (layer.feather) ctx.filter = `blur(${layer.feather}px)`;
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.fill;
  if (layer.kind === 'image') {
    const image = layer.imageSource && assets.get(layer.imageSource);
    if (image) ctx.drawImage(image, 0, 0, layer.width, layer.height);
  } else if (layer.kind === 'redaction') {
    redact(ctx, layer, backdrop);
  } else if (layer.kind === 'text') {
    const layout = layoutText(layer, canvasTextMeasure(ctx));
    if (layer.textLayout === 'fixed' || layer.textLayout === 'auto-height') {
      ctx.beginPath();
      ctx.rect(0, 0, layout.width, layout.height);
      ctx.clip();
    }
    if (layer.fill !== 'transparent')
      ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (const line of layout.lines) {
      for (const span of line.spans) {
        if (span.style.background !== 'transparent') {
          ctx.fillStyle = span.style.background;
          ctx.fillRect(span.x, line.y, span.width, line.height);
        }
      }
      for (const span of line.spans) {
        const { style, text, x, baseline } = span;
        setTextFont(ctx, style);
        ctx.fillStyle = style.color;
        const shadow = layer.textShadow;
        if (shadow) {
          ctx.shadowColor = shadow.color;
          ctx.shadowBlur =
            shadow.blur *
            Math.sqrt(
              Math.abs(
                layer.matrix[0] * layer.matrix[3] -
                  layer.matrix[1] * layer.matrix[2]
              )
            );
          ctx.shadowOffsetX =
            layer.matrix[0] * shadow.offsetX + layer.matrix[2] * shadow.offsetY;
          ctx.shadowOffsetY =
            layer.matrix[1] * shadow.offsetX + layer.matrix[3] * shadow.offsetY;
        }
        if (layer.textOutline?.width) {
          ctx.lineWidth = layer.textOutline.width * 2;
          ctx.strokeStyle = layer.textOutline.color;
          paintText(ctx, text, x, baseline, style, true);
          ctx.shadowColor = 'transparent';
        }
        paintText(ctx, text, x, baseline, style);
        ctx.shadowColor = 'transparent';
        const thickness = Math.max(1, style.fontSize / 16);
        if (style.underline)
          ctx.fillRect(
            x,
            baseline + style.fontSize * 0.1,
            span.width,
            thickness
          );
        if (style.strike)
          ctx.fillRect(
            x,
            baseline - style.fontSize * 0.3,
            span.width,
            thickness
          );
      }
    }
  } else {
    ctx.beginPath();
    if (layer.kind === 'path') {
      const points = layer.points ?? [];
      points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)
      );
      if (points.length === 1) {
        ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
      }
      if (layer.pathClosed) ctx.closePath();
    } else if (layer.kind === 'ellipse')
      ctx.ellipse(
        layer.width / 2,
        layer.height / 2,
        layer.width / 2,
        layer.height / 2,
        0,
        0,
        Math.PI * 2
      );
    else if (layer.kind === 'rectangle')
      roundedRect(
        ctx,
        0,
        0,
        layer.width,
        layer.height,
        layer.cornerRadius ?? 0
      );
    else if (layer.kind === 'triangle') {
      ctx.moveTo(layer.width / 2, 0);
      ctx.lineTo(layer.width, layer.height);
      ctx.lineTo(0, layer.height);
      ctx.closePath();
    } else {
      ctx.moveTo(0, 0);
      ctx.lineTo(layer.width, layer.height);
    }
    if (
      layer.fill !== 'transparent' &&
      (!['path', 'line', 'arrow'].includes(layer.kind) ||
        (layer.kind === 'path' && layer.pathClosed))
    )
      ctx.fill();
    if (layer.strokeWidth > 0) ctx.stroke();
    if (layer.kind === 'line' || layer.kind === 'arrow') {
      const angle = Math.atan2(layer.height, layer.width),
        head = Math.min(
          Math.hypot(layer.width, layer.height) * 0.45,
          Math.max(12, layer.strokeWidth * 4)
        );
      lineEnd(ctx, layer.arrowStart ?? 'none', 0, 0, angle + Math.PI, head);
      lineEnd(
        ctx,
        layer.arrowEnd ?? (layer.kind === 'arrow' ? 'arrow' : 'none'),
        layer.width,
        layer.height,
        angle,
        head
      );
    }
  }
  ctx.restore();
}

/** Pixel effects are deterministic across browsers, and never change alpha. */
export function filterPixels(
  data: Uint8ClampedArray,
  effects: ImageDocument['effects'],
  width = data.length / 4,
  height = 1
) {
  const contrast = Math.pow((100 + effects.contrast) / 100, 2),
    saturation = 1 + effects.saturation / 100,
    exposure = Math.pow(2, (effects.exposure ?? 0) / 50),
    gamma = Math.pow(2, -(effects.gamma ?? 0) / 100),
    temperature = (effects.temperature ?? 0) * 0.35,
    vignette = (effects.vignette ?? 0) / 100,
    lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.pow(i / 255, gamma) * 255;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (
      effects.preset === 'grayscale' ||
      effects.preset === 'noir' ||
      effects.preset === 'stark' ||
      effects.preset === 'wash'
    )
      r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (effects.preset === 'noir') r = g = b = (r - 127.5) * 1.55 + 120;
    if (effects.preset === 'stark') r = g = b = (r - 127.5) * 2.3 + 127.5;
    if (effects.preset === 'wash') r = g = b = r * 0.72 + 44;
    if (
      effects.preset === 'sepia' ||
      effects.preset === 'vintage' ||
      effects.preset === 'sepiaColor' ||
      effects.preset === 'sepiaRust'
    ) {
      const rr = 0.393 * r + 0.769 * g + 0.189 * b,
        gg = 0.349 * r + 0.686 * g + 0.168 * b,
        bb = 0.272 * r + 0.534 * g + 0.131 * b;
      const mix =
        effects.preset === 'vintage'
          ? 0.55
          : effects.preset === 'sepiaColor'
            ? 0.4
            : 1;
      r = r * (1 - mix) + rr * mix;
      g = g * (1 - mix) + gg * mix;
      b = b * (1 - mix) + bb * mix;
      if (effects.preset === 'sepiaRust') {
        r = r * 1.12 + 8;
        g *= 0.84;
        b *= 0.68;
      }
    }
    if (effects.preset === 'sepiaBlues') {
      const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = light * 0.72 + 8;
      g = light * 0.9 + 12;
      b = light * 1.08 + 16;
    }
    if (effects.preset === 'invert') {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (effects.preset === 'warm') {
      r = r * 1.07 + 7;
      g = g * 1.02 + 2;
      b *= 0.91;
    }
    if (effects.preset === 'cool') {
      r *= 0.92;
      g = g * 1.01 + 2;
      b = b * 1.08 + 6;
    }
    if (effects.preset === 'fade') {
      r = r * 0.8 + 33;
      g = g * 0.78 + 31;
      b = b * 0.77 + 36;
    }
    if (effects.preset === 'chrome') {
      const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = (light + (r - light) * 1.2 - 128) * 1.2 + 130;
      g = (light + (g - light) * 1.2 - 128) * 1.2 + 128;
      b = (light + (b - light) * 1.2 - 128) * 1.2 + 125;
    }
    if (effects.preset === 'pastel') {
      const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = (light + (r - light) * 0.65) * 0.85 + 38;
      g = (light + (g - light) * 0.65) * 0.85 + 34;
      b = (light + (b - light) * 0.65) * 0.85 + 38;
    }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let gain = 1,
      lift = 0;
    if (vignette) {
      const x = (((i / 4) % width) + 0.5 - width / 2) / (width / 2),
        y = (Math.floor(i / 4 / width) + 0.5 - height / 2) / (height / 2);
      const amount = Math.abs(vignette) * Math.min(1, (x * x + y * y) / 2);
      gain -= amount;
      if (vignette < 0) lift = 255 * amount;
    }
    const offset = 127.5 + effects.brightness * 2.55;
    r =
      ((l + (r - l) * saturation) * exposure - 127.5) * contrast +
      offset +
      temperature;
    g = ((l + (g - l) * saturation) * exposure - 127.5) * contrast + offset;
    b =
      ((l + (b - l) * saturation) * exposure - 127.5) * contrast +
      offset -
      temperature;
    data[i] =
      (gamma === 1 ? r : lut[Math.round(clamp(r, 0, 255))]) * gain + lift;
    data[i + 1] =
      (gamma === 1 ? g : lut[Math.round(clamp(g, 0, 255))]) * gain + lift;
    data[i + 2] =
      (gamma === 1 ? b : lut[Math.round(clamp(b, 0, 255))]) * gain + lift;
  }
  const clarity = (effects.clarity ?? 0) / 100;
  if (clarity && width > 1 && height > 1) {
    const blurred = data.slice();
    blurPixels(
      blurred,
      width,
      height,
      Math.max(1, Math.round(Math.min(width, height) / 180))
    );
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++)
        data[i + channel] +=
          (data[i + channel] - blurred[i + channel]) *
          clarity *
          (clarity > 0 ? 1.5 : 1);
    }
  }
}

/** Separable alpha-weighted box blur, linear in pixel count even at large radii. */
export function blurPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
) {
  const scratch = new Uint8ClampedArray(data.length),
    r = Math.max(1, Math.round(radius));
  const pass = (
    source: Uint8ClampedArray,
    target: Uint8ClampedArray,
    horizontal: boolean
  ) => {
    const rows = horizontal ? height : width,
      length = horizontal ? width : height;
    const index = (row: number, position: number) =>
      (horizontal ? row * width + position : position * width + row) * 4;
    for (let row = 0; row < rows; row++) {
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      const add = (position: number, sign: number) => {
        const i = index(row, clamp(position, 0, length - 1)),
          a = source[i + 3] * sign;
        red += source[i] * a;
        green += source[i + 1] * a;
        blue += source[i + 2] * a;
        alpha += a;
      };
      for (let p = -r; p <= r; p++) add(p, 1);
      for (let p = 0; p < length; p++) {
        const i = index(row, p);
        target[i] = alpha ? red / alpha : 0;
        target[i + 1] = alpha ? green / alpha : 0;
        target[i + 2] = alpha ? blue / alpha : 0;
        target[i + 3] = alpha / (r * 2 + 1);
        add(p - r, -1);
        add(p + r + 1, 1);
      }
    }
  };
  pass(data, scratch, true);
  pass(scratch, data, false);
}
const filteredImages = new WeakMap<
  object,
  { key: string; canvas: HTMLCanvasElement }
>();
type Composition = {
  doc: ImageDocument;
  assets: ImageAssets;
  canvas: HTMLCanvasElement;
  base?: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  kept?: HTMLCanvasElement;
  decoration?: CompositionDecoration;
  rights: RightsResolver;
};
const compositions = new WeakMap<object, Composition>();
const cropOverflows = new WeakMap<object, Composition>();
const cropSelections = new WeakMap<object, Composition>();

type CompositionDecoration = { document: ImageDocument; matrix: Matrix };

function sourceDimensions(image: CanvasImageSource) {
  const source = image as unknown as {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
    width: number;
    height: number;
  };
  return dimensions(
    source.naturalWidth ||
      source.videoWidth ||
      source.displayWidth ||
      source.width,
    source.naturalHeight ||
      source.videoHeight ||
      source.displayHeight ||
      source.height
  );
}

function filteredSource(
  image: CanvasImageSource,
  effects: ImageDocument['effects']
): CanvasImageSource {
  if (
    effects.preset === 'none' &&
    !effects.brightness &&
    !effects.contrast &&
    !effects.saturation &&
    !effects.exposure &&
    !effects.gamma &&
    !effects.temperature &&
    !effects.clarity &&
    !effects.vignette
  )
    return image;
  const key = JSON.stringify(effects),
    cached = filteredImages.get(image);
  if (cached?.key === key) return cached.canvas;
  const size = sourceDimensions(image),
    canvas = cached?.canvas ?? surface(size.width, size.height).canvas;
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, size.width, size.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  filterPixels(pixels.data, effects, canvas.width, canvas.height);
  ctx.putImageData(pixels, 0, 0);
  // One filtered image per source, not one retained canvas per undo history entry.
  filteredImages.set(image, { key, canvas });
  return canvas;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function paintFrame(ctx: CanvasRenderingContext2D, doc: ImageDocument) {
  const frame = doc.frame;
  if (!frame || frame.style === 'none' || frame.width <= 0) return;
  const width = Math.min(frame.width, Math.min(doc.width, doc.height) / 2),
    radius = doc.cornerRadius ?? 0;
  ctx.save();
  ctx.fillStyle = frame.color;
  ctx.strokeStyle = frame.color;
  if (
    frame.style === 'solid' ||
    frame.style === 'mat' ||
    frame.style === 'polaroid'
  ) {
    const bottom =
      frame.style === 'polaroid' ? Math.min(doc.height / 2, width * 3) : width;
    // Draw the border as a single even-odd path so translucent frame colors do not double at corners.
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.rect(
      width,
      width,
      Math.max(0, doc.width - 2 * width),
      Math.max(0, doc.height - width - bottom)
    );
    ctx.fill('evenodd');
    if (frame.style === 'mat') {
      ctx.strokeStyle = 'rgba(0,0,0,0.24)';
      ctx.lineWidth = Math.max(1, width / 18);
      ctx.strokeRect(
        width,
        width,
        doc.width - 2 * width,
        doc.height - 2 * width
      );
    }
  } else if (frame.style === 'bevel') {
    ctx.fillRect(0, 0, doc.width, width);
    ctx.fillRect(0, width, width, doc.height - width);
    ctx.fillRect(doc.width - width, width, width, doc.height - width);
    ctx.fillRect(width, doc.height - width, doc.width - 2 * width, width);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(doc.width, 0);
    ctx.lineTo(doc.width - width, width);
    ctx.lineTo(width, width);
    ctx.lineTo(width, doc.height - width);
    ctx.lineTo(0, doc.height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(doc.width, 0);
    ctx.lineTo(doc.width, doc.height);
    ctx.lineTo(0, doc.height);
    ctx.lineTo(width, doc.height - width);
    ctx.lineTo(doc.width - width, doc.height - width);
    ctx.lineTo(doc.width - width, width);
    ctx.closePath();
    ctx.fill();
  } else if (
    frame.style === 'hooks' ||
    frame.style === 'cross' ||
    frame.style === 'edge'
  ) {
    ctx.lineWidth = Math.max(1, width / 5);
    ctx.lineCap = 'square';
    ctx.beginPath();
    if (frame.style === 'edge') {
      const inset = width / 2;
      ctx.moveTo(doc.width * 0.2, inset);
      ctx.lineTo(doc.width * 0.8, inset);
      ctx.moveTo(doc.width * 0.2, doc.height - inset);
      ctx.lineTo(doc.width * 0.8, doc.height - inset);
      ctx.moveTo(inset, doc.height * 0.2);
      ctx.lineTo(inset, doc.height * 0.8);
      ctx.moveTo(doc.width - inset, doc.height * 0.2);
      ctx.lineTo(doc.width - inset, doc.height * 0.8);
    } else {
      const arm = Math.min(width * 2, doc.width / 4, doc.height / 4);
      for (const [x, y, sx, sy] of [
        [width, width, 1, 1],
        [doc.width - width, width, -1, 1],
        [doc.width - width, doc.height - width, -1, -1],
        [width, doc.height - width, 1, -1],
      ]) {
        ctx.moveTo(x + sx * arm, y);
        ctx.lineTo(x - (frame.style === 'cross' ? sx * width * 0.6 : 0), y);
        ctx.moveTo(x, y + sy * arm);
        ctx.lineTo(x, y - (frame.style === 'cross' ? sy * width * 0.6 : 0));
      }
    }
    ctx.stroke();
  } else {
    const line = Math.max(1, width / (frame.style === 'double' ? 5 : 3));
    ctx.lineWidth = line;
    const stroke = (inset: number) => {
      roundedRect(
        ctx,
        inset,
        inset,
        Math.max(0, doc.width - 2 * inset),
        Math.max(0, doc.height - 2 * inset),
        Math.max(0, radius - inset)
      );
      ctx.stroke();
    };
    stroke(width);
    if (frame.style === 'double')
      stroke(Math.min(width * 1.8, Math.min(doc.width, doc.height) / 2));
  }
  ctx.restore();
}

function compose(
  doc: ImageDocument,
  image: CanvasImageSource,
  assets: ImageAssets,
  decoration?: CompositionDecoration,
  cache = compositions,
  rights: RightsResolver = defaultRights
) {
  const cached = cache.get(image);
  if (
    cached?.doc === doc &&
    cached.assets === assets &&
    cached.decoration === decoration &&
    cached.rights === rights
  )
    return cached.canvas;
  const canvas = cached?.canvas ?? surface(doc.width, doc.height).canvas;
  if (canvas.width !== doc.width || canvas.height !== doc.height) {
    canvas.width = doc.width;
    canvas.height = doc.height;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frameDoc = decoration?.document ?? doc;
  ctx.save();
  ctx.save();
  if (decoration) apply(ctx, decoration.matrix);
  roundedRect(
    ctx,
    0,
    0,
    frameDoc.width,
    frameDoc.height,
    frameDoc.cornerRadius ?? 0
  );
  ctx.restore();
  ctx.clip();
  if (frameDoc.background && frameDoc.background !== 'transparent') {
    ctx.save();
    if (decoration) apply(ctx, decoration.matrix);
    ctx.fillStyle = frameDoc.background;
    ctx.fillRect(0, 0, frameDoc.width, frameDoc.height);
    ctx.restore();
  }
  ctx.save();
  apply(ctx, doc.imageMatrix);
  ctx.drawImage(filteredSource(image, doc.effects), 0, 0);
  ctx.restore();
  let base = cached?.base,
    mask = cached?.mask,
    kept = cached?.kept;
  if (doc.layers.some((layer) => layer.erase && !layer.hidden)) {
    base ??= surface(doc.width, doc.height).canvas;
    if (base.width !== doc.width || base.height !== doc.height) {
      base.width = doc.width;
      base.height = doc.height;
    }
    const baseContext = base.getContext('2d')!;
    baseContext.clearRect(0, 0, doc.width, doc.height);
    baseContext.drawImage(canvas, 0, 0);
    mask ??= surface(doc.width, doc.height).canvas;
  }
  // A protected redaction samples the full scene beneath it. Keep what it rendered
  // there, so an eraser above restores those pixels instead of re-sampling a
  // scene that lacks the erasable markup the redaction actually covered.
  const redactions = new Map<string, HTMLCanvasElement>();
  let lastEraser = -1;
  doc.layers.forEach((layer, index) => {
    if (layer.erase && !layer.hidden) lastEraser = index;
  });
  doc.layers.forEach((layer, index) => {
    renderLayer(ctx, layer, assets);
    if (
      index < lastEraser &&
      layer.kind === 'redaction' &&
      layer.redactionMode !== 'solid' &&
      !layer.hidden &&
      !rights(layer).erase
    ) {
      const scene = surface(doc.width, doc.height).canvas;
      scene.getContext('2d')!.drawImage(canvas, 0, 0);
      redactions.set(layer.id, scene);
    }
    if (layer.erase && !layer.hidden && base && mask) {
      if (mask.width !== doc.width || mask.height !== doc.height) {
        mask.width = doc.width;
        mask.height = doc.height;
      }
      const maskContext = mask.getContext('2d')!;
      maskContext.clearRect(0, 0, doc.width, doc.height);
      renderLayer(maskContext, { ...layer, erase: false }, assets);
      maskContext.globalCompositeOperation = 'source-in';
      // Layers that deny erasing come back with the photo, in their stacking order.
      const protectedLayers = doc.layers
        .slice(0, index)
        .filter((item) => !item.erase && !item.hidden && !rights(item).erase);
      let restore: HTMLCanvasElement = base;
      if (protectedLayers.length) {
        kept ??= surface(doc.width, doc.height).canvas;
        if (kept.width !== doc.width || kept.height !== doc.height) {
          kept.width = doc.width;
          kept.height = doc.height;
        }
        const keptContext = kept.getContext('2d')!;
        keptContext.clearRect(0, 0, doc.width, doc.height);
        keptContext.drawImage(base, 0, 0);
        for (const item of protectedLayers) {
          const scene = redactions.get(item.id);
          if (!scene) {
            renderLayer(keptContext, item, assets);
            continue;
          }
          keptContext.save();
          apply(keptContext, item.matrix);
          keptContext.beginPath();
          keptContext.rect(0, 0, item.width, item.height);
          keptContext.clip();
          keptContext.clearRect(0, 0, item.width, item.height);
          keptContext.setTransform(1, 0, 0, 1, 0, 0);
          keptContext.drawImage(scene, 0, 0);
          keptContext.restore();
        }
        restore = kept;
      }
      maskContext.drawImage(restore, 0, 0);
      // Restore the original photo under the erased markup. Additive compositing
      // after destination-out also preserves semitransparent photo pixels exactly.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
  });
  ctx.save();
  if (decoration) apply(ctx, decoration.matrix);
  paintFrame(ctx, frameDoc);
  ctx.restore();
  ctx.restore();
  cache.set(image, {
    doc,
    assets,
    canvas,
    base,
    mask,
    kept,
    decoration,
    rights,
  });
  return canvas;
}

/** Show source pixels outside the crop without allocating a source-sized expanded viewport.
 * The caller owns the view transform and crop mask. Crop-bound styling is painted only inside. */
export function paintCropPreview(
  ctx: CanvasRenderingContext2D,
  doc: ImageDocument,
  image: CanvasImageSource,
  crop: Rect,
  assets: ImageAssets = EMPTY_ASSETS,
  options: CropOptions = {},
  rights: RightsResolver = defaultRights
) {
  if (
    !ctx.canvas.width ||
    !ctx.canvas.height ||
    crop.width <= 0 ||
    crop.height <= 0
  )
    return;
  // Ordinary source-space paint is identical on both sides of a crop boundary.
  // Draw it directly at display resolution; only erasing, redaction and crop-
  // bound decoration require an isolated composition buffer.
  if (
    doc.frame.style === 'none' &&
    !doc.cornerRadius &&
    (!doc.background || doc.background === 'transparent') &&
    !doc.layers.some(
      (layer) =>
        (layer.kind === 'redaction' || layer.erase) &&
        !layer.hidden &&
        layer.opacity > 0
    )
  ) {
    ctx.save();
    apply(ctx, doc.imageMatrix);
    ctx.drawImage(filteredSource(image, doc.effects), 0, 0);
    ctx.restore();
    for (const layer of doc.layers) renderLayer(ctx, layer, assets);
    return;
  }
  const matrix = ctx.getTransform(),
    view: Matrix = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  const factor = Math.min(
    1,
    MAX_DIMENSION / ctx.canvas.width,
    MAX_DIMENSION / ctx.canvas.height,
    Math.sqrt(MAX_PIXELS / (ctx.canvas.width * ctx.canvas.height))
  );
  const previewWidth = Math.max(1, Math.floor(ctx.canvas.width * factor)),
    previewHeight = Math.max(1, Math.floor(ctx.canvas.height * factor));
  const stageView = multiply(
    scale(previewWidth / ctx.canvas.width, previewHeight / ctx.canvas.height),
    view
  );
  const overflow: ImageDocument = {
    ...transformDocument(doc, stageView, previewWidth, previewHeight),
    background: 'transparent',
    frame: { ...doc.frame, style: 'none' },
    cornerRadius: 0,
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(
    compose(overflow, image, assets, undefined, cropOverflows, rights),
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );
  ctx.restore();
  const size = cropOutputSize(crop, options);
  const decoration = {
    document: { ...doc, ...size },
    matrix: multiply(
      stageView,
      multiply(
        translate(crop.x, crop.y),
        scale(crop.width / size.width, crop.height / size.height)
      )
    ),
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(crop.x, crop.y, crop.width, crop.height);
  ctx.clip();
  ctx.clearRect(crop.x, crop.y, crop.width, crop.height);
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(
    compose(overflow, image, assets, decoration, cropSelections, rights),
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );
  ctx.restore();
}

/** The preview scales the same composition used by export, including redaction samples. */
export function paintDocument(
  ctx: CanvasRenderingContext2D,
  doc: ImageDocument,
  image: CanvasImageSource,
  view: Matrix = [1, 0, 0, 1, 0, 0],
  assets: ImageAssets = EMPTY_ASSETS,
  rights: RightsResolver = defaultRights
) {
  ctx.save();
  apply(ctx, view);
  ctx.drawImage(
    compose(doc, image, assets, undefined, compositions, rights),
    0,
    0
  );
  ctx.restore();
}
export function exportCanvas(
  doc: ImageDocument,
  image: CanvasImageSource,
  options: ImageExportOptions = {},
  assets: ImageAssets = EMPTY_ASSETS,
  rights: RightsResolver = defaultRights
): HTMLCanvasElement {
  const size = resolveExportSize(doc, options),
    { canvas, ctx } = surface(size.width, size.height),
    background =
      options.background ??
      (options.type === 'image/jpeg' ? '#ffffff' : 'transparent');
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = options.resampling !== 'pixelated';
  ctx.imageSmoothingQuality = 'high';
  let source = compose(doc, image, assets, undefined, compositions, rights),
    rect = size.sourceRect;
  // Repeated halving prevents single-pass downsampling from dropping thin detail.
  if (options.resampling !== 'pixelated') {
    while (rect.width > canvas.width * 2 || rect.height > canvas.height * 2) {
      const step = surface(
        Math.min(rect.width, Math.max(canvas.width, Math.ceil(rect.width / 2))),
        Math.min(
          rect.height,
          Math.max(canvas.height, Math.ceil(rect.height / 2))
        )
      );
      step.ctx.imageSmoothingQuality = 'high';
      step.ctx.drawImage(
        source,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        step.canvas.width,
        step.canvas.height
      );
      source = step.canvas;
      rect = { x: 0, y: 0, width: source.width, height: source.height };
    }
  }
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}
export function textSize(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold = false,
  italic = false,
  lineHeight = 1.2
) {
  const measured = measureTextLayer({
    id: '',
    kind: 'text',
    matrix: [1, 0, 0, 1, 0, 0],
    width: fontSize,
    height: fontSize,
    text,
    fontSize,
    fontFamily,
    bold,
    italic,
    lineHeight,
    textLayout: 'auto-width',
    color: '#000000',
    fill: 'transparent',
    strokeWidth: 0,
    opacity: 1,
  });
  return { width: measured.width, height: measured.height };
}
export type View = { zoom: number; x: number; y: number };
export function fitView(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  width: number,
  height: number
): View {
  const zoom = Math.max(
    0.01,
    Math.min((width - 32) / doc.width, (height - 32) / doc.height, 4)
  );
  return {
    zoom,
    x: (width - doc.width * zoom) / 2,
    y: (height - doc.height * zoom) / 2,
  };
}
export function zoomAt(view: View, zoom: number, anchor: Point): View {
  const next = Math.min(32, Math.max(0.01, zoom)),
    ratio = next / view.zoom;
  return {
    zoom: next,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}
