import { ImageDocument, Layer, Matrix, Point } from './model';

function apply(ctx: CanvasRenderingContext2D, m: Matrix) {
  ctx.transform(...m);
}
export function renderLayer(ctx: CanvasRenderingContext2D, layer: Layer) {
  ctx.save();
  apply(ctx, layer.matrix);
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.erase
    ? 'destination-out'
    : 'source-over';
  ctx.lineWidth = layer.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.fill;
  if (layer.kind === 'text') {
    const size = layer.fontSize ?? 40;
    ctx.font = `${layer.italic ? 'italic ' : ''}${layer.bold ? 'bold ' : ''}${size}px ${layer.fontFamily ?? 'sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = layer.color;
    (layer.text ?? '')
      .split('\n')
      .forEach((line, i) => ctx.fillText(line, 0, i * size * 1.2));
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
      ctx.rect(0, 0, layer.width, layer.height);
    else if (layer.kind === 'triangle') {
      ctx.moveTo(layer.width / 2, 0);
      ctx.lineTo(layer.width, layer.height);
      ctx.lineTo(0, layer.height);
      ctx.closePath();
    } else {
      ctx.moveTo(0, 0);
      ctx.lineTo(layer.width, layer.height);
      if (layer.kind === 'arrow') {
        const angle = Math.atan2(layer.height, layer.width),
          head = Math.max(12, layer.strokeWidth * 4);
        ctx.moveTo(
          layer.width - head * Math.cos(angle - 0.45),
          layer.height - head * Math.sin(angle - 0.45)
        );
        ctx.lineTo(layer.width, layer.height);
        ctx.lineTo(
          layer.width - head * Math.cos(angle + 0.45),
          layer.height - head * Math.sin(angle + 0.45)
        );
      }
    }
    if (
      layer.fill !== 'transparent' &&
      !['path', 'line', 'arrow'].includes(layer.kind)
    )
      ctx.fill();
    if (layer.strokeWidth > 0) ctx.stroke();
  }
  ctx.restore();
}

/** Pixel effects are deterministic across browsers, and never change alpha. */
export function filterPixels(
  data: Uint8ClampedArray,
  effects: ImageDocument['effects']
) {
  const contrast = Math.pow((100 + effects.contrast) / 100, 2),
    saturation = 1 + effects.saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (effects.preset === 'grayscale')
      r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (effects.preset === 'sepia' || effects.preset === 'vintage') {
      const rr = 0.393 * r + 0.769 * g + 0.189 * b,
        gg = 0.349 * r + 0.686 * g + 0.168 * b,
        bb = 0.272 * r + 0.534 * g + 0.131 * b;
      const mix = effects.preset === 'vintage' ? 0.55 : 1;
      r = r * (1 - mix) + rr * mix;
      g = g * (1 - mix) + gg * mix;
      b = b * (1 - mix) + bb * mix;
    }
    if (effects.preset === 'invert') {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] =
      (l + (r - l) * saturation - 127.5) * contrast +
      127.5 +
      effects.brightness * 2.55;
    data[i + 1] =
      (l + (g - l) * saturation - 127.5) * contrast +
      127.5 +
      effects.brightness * 2.55;
    data[i + 2] =
      (l + (b - l) * saturation - 127.5) * contrast +
      127.5 +
      effects.brightness * 2.55;
  }
}
export function paintDocument(
  ctx: CanvasRenderingContext2D,
  doc: ImageDocument,
  image: CanvasImageSource,
  view: Matrix = [1, 0, 0, 1, 0, 0]
) {
  ctx.save();
  apply(ctx, view);
  ctx.beginPath();
  ctx.rect(0, 0, doc.width, doc.height);
  ctx.clip();
  ctx.save();
  apply(ctx, doc.imageMatrix);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
  doc.layers.forEach((layer) => renderLayer(ctx, layer));
  ctx.restore();
  const e = doc.effects;
  if (e.preset !== 'none' || e.brightness || e.contrast || e.saturation) {
    const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    filterPixels(pixels.data, e);
    ctx.putImageData(pixels, 0, 0);
  }
}
export function exportCanvas(
  doc: ImageDocument,
  image: CanvasImageSource
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D is unavailable');
  paintDocument(ctx, doc, image);
  return canvas;
}
export function textSize(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold = false,
  italic = false
) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Canvas2D is unavailable');
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  return {
    width: Math.max(
      fontSize,
      ...text.split('\n').map((line) => ctx.measureText(line).width)
    ),
    height: Math.max(1, text.split('\n').length) * fontSize * 1.2,
  };
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
