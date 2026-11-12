/** Browser-only harness for fonts, background images and image frames. Every asset is local. */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImageEditor, {
  DEFAULT_FONTS,
  type ImageEditorInstance,
  type ImageEditorOptions,
} from '@lofcz/react-image-editor';

const canvas = (
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void
) => {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  paint(element.getContext('2d')!);
  return element.toDataURL('image/png');
};
const params = new URLSearchParams(location.search);
// Left half opaque red, right half transparent: a cut-out photo.
const sourceUrl = canvas(300, 200, (ctx) => {
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 150, 200);
});
// 30 × 30 frame, 10 px slices: each corner, edge and the center is one color.
const frameUrl = canvas(30, 30, (ctx) => {
  const cells: [number, number, string][] = [
    [0, 0, '#ff0000'],
    [1, 0, '#00ffff'],
    [2, 0, '#00ff00'],
    [0, 1, '#000000'],
    [2, 1, 'rgba(255,0,255,0.5)'],
    [0, 2, '#ffff00'],
    [1, 2, '#ffffff'],
    [2, 2, '#0000ff'],
  ];
  for (const [x, y, color] of cells) {
    ctx.fillStyle = color;
    ctx.fillRect(x * 10, y * 10, 10, 10);
  }
});
// Ornamental frame for screenshots.
const ornamentUrl = canvas(48, 48, (ctx) => {
  ctx.fillStyle = '#7c4a1e';
  ctx.fillRect(0, 0, 48, 48);
  ctx.fillStyle = '#d9a441';
  ctx.fillRect(3, 3, 42, 42);
  ctx.fillStyle = '#7c4a1e';
  ctx.fillRect(7, 7, 34, 34);
  ctx.clearRect(14, 14, 20, 20);
  ctx.fillStyle = '#f3d27a';
  for (const [x, y] of [
    [7, 7],
    [41, 7],
    [41, 41],
    [7, 41],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
});
// 20 × 20 tile: top-left quadrant orange, the rest blue.
const tileUrl = canvas(20, 20, (ctx) => {
  ctx.fillStyle = '#0088ff';
  ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(0, 0, 10, 10);
});
// 40 × 20: left half green, right half purple.
const halvesUrl = canvas(40, 20, (ctx) => {
  ctx.fillStyle = '#00aa00';
  ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#8000ff';
  ctx.fillRect(20, 0, 20, 20);
});
const skyUrl = canvas(160, 100, (ctx) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, 100);
  gradient.addColorStop(0, '#7cc6f2');
  gradient.addColorStop(1, '#f6d8b8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 160, 100);
  ctx.fillStyle = '#ffffffcc';
  ctx.beginPath();
  ctx.ellipse(50, 35, 26, 10, 0, 0, Math.PI * 2);
  ctx.fill();
});

declare global {
  interface Window {
    localEditor: ImageEditorInstance;
    assetUrls: Record<string, string>;
    setTheme(theme: 'light' | 'dark'): void;
  }
}
window.assetUrls = {
  source: sourceUrl,
  frame: frameUrl,
  tile: tileUrl,
  halves: halvesUrl,
};
const catalogs = params.get('catalog') !== '0';
const timeout = Number(params.get('fontTimeout') ?? 5000);
const options: ImageEditorOptions = {
  locale: params.get('locale') ?? 'en',
  fontLoadTimeout: timeout,
  ...(catalogs
    ? {
        fonts: [
          ...DEFAULT_FONTS.slice(0, 2).map((font) => ({
            ...font,
            group: 'System',
          })),
          {
            id: 'block',
            label: 'RIE Block',
            family: '"RIE Block", monospace',
            group: 'Brand',
            weights: [400],
            source: [{ url: '/__rie-test/block.ttf' }],
          },
          {
            id: 'slow',
            label: 'Slow Block',
            family: '"RIE Slow", monospace',
            group: 'Brand',
            source: [{ url: '/__rie-test/slow.ttf' }],
          },
          {
            id: 'broken',
            label: 'Broken face',
            family: '"RIE Broken", serif',
            group: 'Brand',
            source: [{ url: '/__rie-test/broken.ttf' }],
          },
        ],
        frames: [
          {
            id: 'tiles',
            label: 'Test tiles',
            url: frameUrl,
            slice: 10,
            width: 20,
          },
          {
            id: 'ornament',
            label: 'Gilded',
            url: ornamentUrl,
            slice: 14,
            repeat: 'round',
          },
          { id: 'bad', label: 'Bad slices', url: tileUrl, slice: 15 },
        ],
        backgrounds: [
          { id: 'sky', label: 'Sky', url: skyUrl },
          { id: 'tile', label: 'Tiles', url: tileUrl, fit: 'repeat' },
          { id: 'halves', label: 'Halves', url: halvesUrl },
        ],
      }
    : {}),
};
function Harness() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    window.setTheme = setTheme;
  }, []);
  return (
    <div className="fixture">
      <ImageEditor
        image={sourceUrl}
        minHeight={0}
        options={{ ...options, theme }}
        onLoad={(editor) => {
          window.localEditor = editor;
        }}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
