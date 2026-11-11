# React Image Editor

A fully local React image editor, maintained by ScioBot. The package owns the Canvas2D renderer, editable layers, history and controls. It has no runtime dependency other than React, loads no remote scripts or fonts, and never uploads images. Image URLs supplied by the host are the only network resources it reads.

Version `2.0.0-rc.0` is a prepared release candidate. It replaces the hosted engine used in version 1. See [migration notes](#migrating-from-version-1) before upgrading. This candidate has not been published to npm.

## Install and use

Requires React 18 or newer and a browser with Canvas2D and Pointer Events. Build a candidate from this checkout:

```sh
pnpm install
pnpm build
npm pack --ignore-scripts
# In the consuming app:
npm install /path/to/lofcz-react-image-editor-2.0.0-rc.0.tgz
```

```tsx
import { useRef } from 'react';
import ImageEditor, { type ImageEditorRef } from '@lofcz/react-image-editor';

export function PhotoEditor({ image }: { image: string }) {
  const ref = useRef<ImageEditorRef>(null);
  return (
    <ImageEditor
      ref={ref}
      image={image}
      options={{ theme: 'light', locale: 'en' }}
      onSave={({ blob }) => {
        // Persist this image/png Blob through your application's upload service.
        console.info(blob.size);
      }}
      onCancel={() => console.info('Close the editor')}
    />
  );
}
```

The ESM and CommonJS builds include types and a `use client` directive. Server rendering does not access the DOM. Styles and SVG icons are bundled; no stylesheet import is required.

## Tools and interaction

| Tool    | Behavior                                                                                |
| ------- | --------------------------------------------------------------------------------------- |
| Select  | Select, move, resize, rotate, duplicate, reorder and delete editable objects.           |
| Crop    | Drag a region or its corners, choose an aspect ratio, rotate by 90 degrees and flip.    |
| Resize  | Set output pixel dimensions, with optional aspect lock.                                 |
| Draw    | Brush, translucent highlighter and alpha eraser, with color and size controls.          |
| Text    | Editable multiline text, size, built-in font families, bold, italic, color and opacity. |
| Shapes  | Rectangle, ellipse, triangle, line and arrow, with fill, outline and opacity.           |
| Effects | Grayscale, sepia, invert, vintage, brightness, contrast and saturation.                 |

Wheel zoom stays inside the canvas. Fit and zoom buttons are available. Drag empty space, hold Space, or use the middle mouse button to pan; use two fingers to zoom and pan on touch screens. Shift constrains crop/resize or snaps rotation. Arrow keys move the selected object (Shift moves by 10 pixels), Alt+arrows rotate, Delete removes it, and `[` / `]` select adjacent objects. Enter edits selected text; Escape cancels a gesture. Undo/redo use the toolbar or Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y. Shortcuts do not intercept typing in fields.

Each pointer gesture and text editing transaction is one undo step. History retains up to 100 steps. Crop and resize transform the image and editable layers together in image coordinates. Zoom and device pixel ratio never change exported dimensions. PNG exports preserve transparency and contain no handles, checkerboard or other interface elements. Image dimensions are limited to 8192 pixels per side and 32 × 1024 × 1024 pixels in total.

## Props

| Prop                               | Purpose                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `image: string`                    | Required URL, data URL or object URL. Cross-origin URLs must allow anonymous CORS for canvas export. |
| `options?: ImageEditorOptions`     | Theme, locale, translations, tool visibility and action visibility.                                  |
| `onLoad(editor)`                   | Called once after the initial successful image load.                                                 |
| `onSave({ dataUrl, blob })`        | Native Save action; both values represent the same PNG. Persistence belongs to the host.             |
| `onCancel()`                       | Native Cancel action. The host decides whether to close the editor.                                  |
| `onChange(change)`                 | Synchronous notification after committed edits, undo/redo and successful image replacement.          |
| `onLoadError()` / `onError(error)` | Image loading failure notifications; `onError` also reports export failures.                         |
| `loadingFallback`                  | React content displayed during image loading.                                                        |
| `errorFallback`                    | React content or `(error, retry) => ReactNode` for an initial load failure.                          |
| `editorId`, `ariaLabel`            | Optional container ID and accessible region name.                                                    |
| `minHeight`                        | Minimum wrapper height, default 500. Use 0 inside a host with a fixed available height.              |
| `className`, `style`               | Inner container styling.                                                                             |
| `wrapperClassName`, `wrapperStyle` | Outer wrapper styling.                                                                               |

`onChange` receives `{ width, height, hasChanges, geometryKey }`. `geometryKey` is an opaque identity for the source image, output dimensions and background transform. Hosts can compare it to invalidate geometry-dependent masks. Markup edits preserve it; source replacement, crop, resize, rotation and flips change it. Notifications never fire for intermediate pointer previews. An export that applies a pending crop sends its change notification **before** returning the pixels.

## Public ref

`ref.current.editor` is null before initialization and after destruction.

| Method                            | Contract                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `getImage(): string \| null`      | Current PNG data URL, or null while not ready. Applies any visible pending crop and finalizes text editing first.             |
| `getBlob(): Promise<Blob>`        | The same export as a PNG Blob; rejects while not ready.                                                                       |
| `hasChanges(): boolean`           | Whether the document differs from its loaded baseline. Saving does not mark it clean; reset to the saved source when desired. |
| `reset(imageUrl?): Promise<void>` | Load a new baseline, clearing selection and history after success. Without a URL, reload the last successful source.          |
| `updateOptions(options)`          | Update presentation without losing the document, selection or history. An `image` value requests a source replacement.        |
| `destroy()`                       | Cancel pending loading and release the document. Normally called by React cleanup.                                            |

The latest requested image wins. Superseded requests reject with `AbortError`; late completion cannot restore a destroyed editor. A failed replacement rejects while preserving the previous document, history and pending crop. A successful replacement discards old pending controls before any immediate export. Initial failures have a retry surface; replacement failures leave the previous editor usable with an error message.

## Configuration and layout

```tsx
const options = {
  theme: 'dark' as const,
  locale: 'cs',
  showActions: false, // Host owns Save/Cancel and calls ref.editor.getBlob().
  features: {
    imageEditor: {
      dock: 'left' as const,
      tools: { draw: true, text: true, shapes: false },
    },
  },
  translations: {
    cs: { 'image_editor.toolbar.save': 'Uložit obrázek' },
  },
};
```

`showActions` defaults to true. All seven tools default to enabled. Tools use boolean visibility flags; the rail can dock left or right. Theme, locale and tool changes do not remount the engine. Czech, Slovak, English and Polish are included; regional locales fall back to their base language and then English. Overrides use the existing flat `image_editor.*` keys; available keys are listed in [`src/locale.ts`](src/locale.ts).

The layout responds to its own container width. At 620px and below, tools become a horizontal rail and a bounded options panel moves below the canvas. The component inherits the host font. Hosts can override `--rie-bg`, `--rie-panel`, `--rie-muted`, `--rie-line`, `--rie-fg`, `--rie-secondary`, `--rie-accent` and `--rie-tint` on `.image-editor-root`. The root includes `data-editor-engine="local-canvas"`; stable `native-*` test IDs cover tools and controls.

## Migrating from version 1

The fork retains the React component, ref methods, callbacks, layout hooks and translation namespace. The runtime is now owned by this repository, with no Unlayer global, project, account, CDN or license service.

Hosted-only AI assistants, stickers, frames, rounded corners, custom tool icons, remote font catalogs and the extended hosted filter/text presets are not implemented. `projectId`, `user`, `env`, `offline`, `licenseUrl`, `defaultPrompt`, `autoSubmitPrompt`, `aiAssistantOpenState`, `features.ai`, `scriptUrl` and legacy sticker/frame/corner flags remain accepted as deprecated compatibility fields and have no effect. Tool flags are booleans. The old `features.imageEditor: false` shorthand is not supported. Built-in locales are now cs/sk/en/pl; provide translation overrides for other languages.

Hosts own AI generation, inpainting, background removal, masks, sharing and persistence. Export the current image through the public ref, call your backend, then `await editor.reset(resultUrl)` to preview its result. Save it only when the user accepts the edit. No hosted engine code or assets have been copied into this package.

## Development and verification

```sh
pnpm dev
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm --dir demo typecheck
pnpm --dir demo build
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
```

Unit tests exercise affine geometry, editable layers, bounded transactions, image loading races, failed replacement recovery, synchronous notifications, localization and SSR. Chromium checks use actual Canvas2D pixels and controls, including alpha, exact export dimensions, gestures, crop export through the host ref, text, effects, mobile layout and absence of hosted globals/requests. CI runs both suites. `CHROMIUM_PATH` can select an already installed browser for local verification.

Release setup and fork history are in [FORK.md](FORK.md). The MIT license credits Unlayer for the original React wrapper and ScioBot contributors for the local engine.
