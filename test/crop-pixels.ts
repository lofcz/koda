import { applyCrop, constrainImageToCrop, transformImage } from '../src/crop';
import {
  createDocument,
  inverse,
  multiply,
  parseDocument,
  rotation,
  translate,
} from '../src/model';
import { exportCanvas, paintCropPreview } from '../src/render';

export function verifyCropPixels() {
  const check = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const make = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [
    ...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data,
  ];
  const source = make(128, 96),
    ctx = source.getContext('2d')!;
  ctx.fillStyle = '#0044aa';
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#ff9900';
  ctx.fillRect(0, 0, 32, 96);
  ctx.fillStyle = '#aa00ee';
  ctx.fillRect(96, 0, 32, 96);
  const size = { width: 128, height: 96 },
    original = {
      ...createDocument(128, 96),
      layers: [
        {
          id: 'annotation',
          kind: 'rectangle' as const,
          width: 8,
          height: 8,
          matrix: translate(8, 8),
          color: '#00ff00',
          fill: '#00ff00',
          strokeWidth: 0,
          opacity: 1,
        },
      ],
    },
    cropped = applyCrop(
      original,
      { x: 32, y: 24, width: 64, height: 48 },
      size
    ),
    recovered = applyCrop(
      cropped,
      { x: -32, y: -24, width: 128, height: 96 },
      size
    );
  check(
    exportCanvas(recovered, source).toDataURL() ===
      exportCanvas(original, source).toDataURL(),
    'Negative-origin recrop recovers original photo and clipped editable annotations exactly'
  );
  check(
    pixel(exportCanvas(recovered, source), 10, 10).join() === '0,255,0,255',
    'Recovered annotation remains source-space content'
  );
  const outside = applyCrop(
      original,
      { x: -10, y: -5, width: 148, height: 106 },
      size,
      { allowOutsideImage: true }
    ),
    transparent = exportCanvas(outside, source);
  check(
    pixel(transparent, 1, 1)[3] === 0 &&
      pixel(transparent, 11, 6).join() === '255,153,0,255',
    'Outside-image crop preserves transparent extension and original pixels'
  );
  check(
    pixel(
      exportCanvas({ ...outside, background: '#ffffff' }, source),
      1,
      1
    ).join() === '255,255,255,255',
    'Crop-bound fill covers outside-image extension'
  );
  const crop = { x: 0, y: 0, width: 64, height: 48 },
    candidate = multiply(
      translate(32, 24),
      multiply(rotation(33), multiply(translate(-32, -24), cropped.imageMatrix))
    ),
    constrained = constrainImageToCrop(candidate, size, crop),
    moved = transformImage(
      cropped,
      multiply(constrained, inverse(cropped.imageMatrix))
    ),
    movedCanvas = exportCanvas(moved, source);
  for (const [x, y] of [
    [1, 1],
    [62, 1],
    [1, 46],
    [62, 46],
    [32, 24],
  ])
    check(
      pixel(movedCanvas, x, y)[3] === 255,
      'Rotated constrained source covers every crop corner'
    );
  check(
    exportCanvas(parseDocument(JSON.stringify(moved)), source).toDataURL() ===
      movedCanvas.toDataURL(),
    'Image-focused crop survives document restoration'
  );
  const decorated = {
      ...cropped,
      frame: { style: 'solid' as const, color: '#ffffff', width: 3 },
      cornerRadius: 7,
    },
    preview = make(120, 90),
    previewCtx = preview.getContext('2d')!;
  previewCtx.translate(20, 12);
  paintCropPreview(previewCtx, decorated, source, crop);
  check(
    pixel(preview, 10, 22).join() === '255,153,0,255',
    'Preview reveals source beyond the old viewport'
  );
  check(
    pixel(preview, 52, 13).join() === '255,255,255,255',
    'Frame stays attached to stationary crop'
  );
  check(
    pixel(preview, 20, 12)[3] === 0,
    'Rounded crop corners clear ghost pixels inside the selected region'
  );
  const selected = make(64, 48);
  selected.getContext('2d')!.drawImage(preview, 20, 12, 64, 48, 0, 0, 64, 48);
  check(
    selected.toDataURL() === exportCanvas(decorated, source).toDataURL(),
    'At image-pixel zoom selected preview matches export exactly'
  );
  for (const doc of [
    cropped,
    {
      ...cropped,
      layers: [
        ...cropped.layers,
        {
          id: 'redaction',
          kind: 'redaction' as const,
          matrix: translate(-4, 10),
          width: 20,
          height: 16,
          color: '#000',
          fill: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          redactionMode: 'pixelate' as const,
          redactionSize: 8,
        },
      ],
    },
  ]) {
    const view = make(120, 90),
      context = view.getContext('2d')!;
    context.translate(20, 12);
    paintCropPreview(context, doc, source, crop);
    const region = make(64, 48);
    region.getContext('2d')!.drawImage(view, 20, 12, 64, 48, 0, 0, 64, 48);
    check(
      region.toDataURL() === exportCanvas(doc, source).toDataURL(),
      'Fast source preview and crop-edge redaction retain export-equivalent pixels'
    );
  }
  check(
    exportCanvas(original, source).toDataURL() ===
      exportCanvas(recovered, source).toDataURL(),
    'Crop preview does not contaminate subsequent exports'
  );
  // A large editable viewport backed by a tiny fixture proves both passes stay screen-sized.
  const large = {
      ...createDocument(8192, 4096),
      imageMatrix: [64, 0, 0, 4096 / 96, 0, 0] as const,
      effects: { ...original.effects, brightness: 12 },
      frame: { style: 'inset' as const, color: '#fff', width: 32 },
    },
    screen = make(800, 500),
    screenCtx = screen.getContext('2d')!;
  screenCtx.scale(0.09, 0.09);
  const width = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'width'
    )!,
    height = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'height'
    )!;
  let largest = 0;
  for (const [name, descriptor] of [
    ['width', width],
    ['height', height],
  ] as const)
    Object.defineProperty(HTMLCanvasElement.prototype, name, {
      ...descriptor,
      set(value: number) {
        descriptor.set!.call(this, value);
        largest = Math.max(largest, this.width * this.height);
      },
    });
  const started = performance.now();
  try {
    for (let i = 0; i < 8; i++)
      paintCropPreview(
        screenCtx,
        transformImage(large, translate(i, 0)),
        source,
        { x: 0, y: 0, width: 8192, height: 4096 }
      );
    check(
      largest <= screen.width * screen.height,
      'Crop gesture allocations are bounded by the viewport'
    );
  } finally {
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', width);
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', height);
  }
  return {
    recropOriginalPixels: true,
    outsideCropAlphaFill: true,
    rotatedCropCoverage: true,
    stationaryCropFrame: true,
    cropPreviewExportMatch: true,
    viewportBoundCropAllocation: largest,
    cropPreviewMeanMs: Math.round((performance.now() - started) / 8),
  };
}
