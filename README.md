# /koda/

<p align="center">
  <a href="https://www.npmjs.com/package/koda-editor"><img src="https://img.shields.io/npm/v/koda-editor?style=flat-square&label=npm&color=111111" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-24-111111?style=flat-square" alt="node 24" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/react-19-111111?style=flat-square" alt="react 19" /></a>
</p>

---

```
   .------------------------------------------------------------------------.
   |  .--.                                                          .--.    |
   |  |  |      __               __                                 |  |    |
   |  '--'     / /______  ____  / /___ _      ___________________   '--'    |
   |          / //_/ __ \/ __ \/ / __ `/     |  .-.      _/\     |          |
   |   [+]   / ,< / /_/ / /_/ / / /_/ /      | (   )  _/    \_   |    [+]   |
   |        /_/|_|\____/\__,_/  \__,_/       |  `-'  /  /\    \  |          |
   |                                         |  ____/__/__\____\ |          |
   |  .--.                                   |___________________|  .--.    |
   |  |  |             I m a g e   E d i t o r                      |  |    |
   |  '--'                                                          '--'    |
   '------------------------------------------------------------------------'
```

<p align="center">
  <a href="https://lofcz.github.io/koda/">live demo</a>
  ·
  <a href="docs/PERFORMANCE.md">performance</a>
  ·
  <a href="https://www.npmjs.com/package/koda-editor">npm</a>
</p>

Image editor for React. Canvas2D, editable layers, undo history. No runtime dependencies besides React, no remote scripts or fonts, no uploads.

## Quick Start

```bash
pnpm install
pnpm dev
```

Demo at http://127.0.0.1:5173, imports the editor from `src/`. Published to [lofcz.github.io/koda](https://lofcz.github.io/koda/) on every push to `main`.

## Install

```bash
npm install koda-editor
```

React 19. Node 22+ for tooling.

```tsx
import { useRef } from 'react';
import ImageEditor, { type ImageEditorRef } from 'koda-editor';

export function PhotoEditor({ image }: { image: string }) {
  const ref = useRef<ImageEditorRef>(null);
  return (
    <ImageEditor
      ref={ref}
      image={image}
      options={{ theme: 'dark', locale: 'en' }}
      onSave={({ blob }) => upload(blob)}
      onCancel={close}
    />
  );
}
```

ESM + CJS with types. Styles and icons are bundled. SSR-safe.

## Tools

| Tool     |                                                                                   |
| -------- | --------------------------------------------------------------------------------- |
| Select   | Move, resize, rotate, align, distribute, duplicate, reorder, delete               |
| Crop     | Presets, guides, profile circle, print bleed, straighten, recenter, flip          |
| Resize   | Output size with aspect lock                                                      |
| Draw     | Brush, highlighter, eraser, editable paths and polygons                           |
| Text     | On-canvas rich text, font catalogs, auto/fixed boxes, outline, shadow             |
| Shapes   | Rectangle, ellipse, triangle, line, arrow; dashes, caps, radius, feather          |
| Adjust   | Brightness, contrast, saturation, exposure, gamma, temperature, clarity, vignette |
| Filter   | 16 presets with live previews                                                     |
| Stickers | Browse, drop or paste images; symbols                                             |
| Redact   | Pixelate, blur, solid                                                             |
| Frame    | Vector presets and 9-slice image frames, inside or outside the photo              |
| Fill     | Color or image background (cover, contain, stretch, repeat)                       |

Locales: cs, sk, en, pl. Light and dark themes. Works in Chromium, Firefox and WebKit.

## Options

```tsx
const options = {
  theme: 'dark',
  locale: 'cs',
  showActions: false, // host owns Save/Cancel
  features: { imageEditor: { dock: 'left', tools: { shapes: false } } },
  crop: { interactionFocus: 'image', guides: 'thirds', presets: [/* … */] },
  fonts: [
    ...DEFAULT_FONTS,
    {
      id: 'inter',
      label: 'Inter',
      family: 'Inter',
      source: [{ url: '/inter.woff2' }],
    },
  ],
  backgrounds: [
    { id: 'paper', label: 'Paper', url: '/paper.png', fit: 'repeat' },
  ],
  frames: [{ id: 'gilded', label: 'Gilded', url: '/gilded.png', slice: 40 }],
  layerRights: { all: { reorder: false } },
  export: { type: 'image/webp', quality: 0.9 },
};
```

Theme with `--rie-*` CSS variables on `.image-editor-root`. Translation keys are in [`src/locale.ts`](src/locale.ts).

### Layer rights

Any layer can deny `select`, `move`, `resize`, `rotate`, `flip`, `delete`, `duplicate`, `reorder`, `style`, `editText`, `textNewlines`, `textLayout`, `pathPoints`, `erase`, `snap`, `lock` or `visibility`:

```ts
// Editable caption that cannot be moved, deleted or broken into lines.
{ ...layer, rights: { move: false, delete: false, textNewlines: false } }
```

## Ref

`ref.current.editor`:

| Method                                              |                                                       |
| --------------------------------------------------- | ----------------------------------------------------- |
| `getImage(options?)`                                | Data URL of the result (PNG, JPEG or WebP)            |
| `getBlob(options?)`                                 | Same as a Blob; waits for fonts                       |
| `getDocument()`                                     | Editable JSON state                                   |
| `restoreDocument(doc)`                              | Restore saved state over the loaded source            |
| `getSourceBlob()`                                   | Current source bytes                                  |
| `getExportOptions()`                                | Output settings                                       |
| `getBaseImage(options?)`                            | The photo without layers, for AI edits                |
| `replaceBase(image)`                                | Swap the photo as one undo step; layers stay editable |
| `addImage(url)`                                     | Add an image layer                                    |
| `getLayerRights(id)` / `setLayerRights(id, rights)` | Read or set a layer's rights                          |
| `fontsReady(timeout?)`                              | Wait for catalog fonts                                |
| `hasChanges()` / `revert()` / `reset(url?)`         | Dirty state, revert, new baseline                     |
| `updateOptions(options)`                            | Change options without losing state                   |

Save `getSourceBlob()`, `getDocument()` and `getExportOptions()` together to resume editing later. Server code can validate documents with `koda-editor/document` (no React or DOM).

### AI edits

```ts
const base = editor.getBaseImage(); // send with an optional mask
await editor.replaceBase(await myModel(base)); // undo restores the previous photo
```

## Develop

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:browser            # Chromium
pnpm test:browser:firefox
pnpm test:browser:webkit
pnpm test:a11y
```

Release: `gh workflow run release.yml -R lofcz/koda -f release_type=minor`. First publish of a new package name: `pnpm bootstrap:publish` (npm login, publish, trusted publisher).

## License

MIT
