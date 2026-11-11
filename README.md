# React Image Editor

A fully local React image editor, maintained by ScioBot. The package owns the Canvas2D renderer, editable layers, history and controls. It has no runtime dependency other than React, loads no remote scripts or fonts, and never uploads images. Image URLs supplied by the host are the only network resources it reads.

Version `2.0.0-rc.3` is a prepared release candidate. It replaces the hosted engine used in version 1. See [migration notes](#migrating-from-version-1) before upgrading. This candidate has not been published to npm.

## Install and use

Requires React 18 or newer and a browser with Canvas2D and Pointer Events. Build a candidate from this checkout:

```sh
pnpm install
pnpm build
npm pack --ignore-scripts
# In the consuming app:
npm install /path/to/lofcz-react-image-editor-2.0.0-rc.3.tgz
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
        // Persist this Blob through your application's upload service.
        console.info(blob.size);
      }}
      onCancel={() => console.info('Close the editor')}
    />
  );
}
```

The ESM and CommonJS builds include types and a `use client` directive. Server rendering does not access the DOM. Styles and SVG icons are bundled; no stylesheet import is required.

## Tools and interaction

| Tool     | Behavior                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Select   | Select, move, resize, rotate, duplicate, reorder and delete editable objects.                                           |
| Crop     | Eight resize handles, aspect presets, guides, straightening, 90-degree rotation and flips.                              |
| Resize   | Set output pixel dimensions, with optional aspect lock.                                                                 |
| Draw     | Brush, translucent highlighter and alpha eraser, with color and size controls.                                          |
| Text     | Edit on the image, multiline text, searchable font families, alignment, line height, bold, italic and underline.        |
| Shapes   | Rectangle, ellipse, triangle, line and arrow, with editable endpoints, fill, outline, opacity and line endings.         |
| Adjust   | Brightness, contrast, saturation, exposure, gamma, temperature, clarity and light/dark vignette.                        |
| Filter   | Sixteen presets with current-source previews, including warm/cool, monochrome, sepia, chrome, fade and pastel families. |
| Stickers | Import images by browsing, dropping or pasting, or insert built-in symbols as editable objects.                         |
| Redact   | Editable pixelated, blurred or solid regions over the photo and earlier annotations.                                    |
| Frame    | Ten choices: none, solid, inset, double, mat, polaroid, bevel, hooks, cross and edge; color, width and rounded corners. |
| Fill     | Transparent or colored canvas background.                                                                               |

Wheel zoom stays inside the canvas. Fit and zoom buttons are available. Drag empty space, hold Space, or use the middle mouse button to pan; use two fingers to zoom and pan on touch screens. Shift constrains crop/resize or snaps rotation. Arrow keys move the selected object (Shift moves by 10 pixels), Alt+arrows rotate, Delete removes it, and `[` / `]` select adjacent objects. Enter edits selected text; Escape cancels a gesture. Undo/redo use the toolbar or Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y. Shortcuts do not intercept typing in fields.

Each pointer gesture and text editing transaction is one undo step. History retains up to 100 steps. Crop and resize transform the image and editable layers together in image coordinates. Zoom and device pixel ratio never change exported dimensions. PNG and WebP preserve transparency; JPEG uses a configurable opaque background. Export contains no handles, checkerboard or other interface elements. Image dimensions are limited to 8192 pixels per side and 32 × 1024 × 1024 pixels in total. Reset is undoable, and Compare toggles the original view without changing the document.

## Props

| Prop                               | Purpose                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `image: string`                    | Required URL, data URL or object URL. Cross-origin URLs must allow anonymous CORS for canvas export. |
| `options?: ImageEditorOptions`     | Theme, locale, translations, tool visibility and action visibility.                                  |
| `onLoad(editor)`                   | Called once after the initial successful image load.                                                 |
| `onSave({ dataUrl, blob })`        | Native Save action; both values represent the selected format. Persistence belongs to the host.      |
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

| Method                                     | Contract                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `getImage(options?): string \| null`       | Current image data URL, or null while not ready. Applies pending crop and text edits first. Defaults to PNG.                  |
| `getBlob(options?): Promise<Blob>`         | The same export as a Blob; rejects while not ready.                                                                           |
| `getDocument(): ImageDocument \| null`     | Independent JSON-safe editable state, including embedded sticker images. Flushes pending edits.                               |
| `restoreDocument(document): Promise<void>` | Validate and restore a document or serialized JSON against the currently loaded original source.                              |
| `addImage(url): Promise<void>`             | Load and embed an image as a new editable layer.                                                                              |
| `getSource(): CanvasImageSource \| null`   | Original source pixels for comparison or custom previews.                                                                     |
| `getSourceBlob(): Promise<Blob>`           | Original encoded source bytes, retained from the successful load; rejects while not ready.                                    |
| `getExportOptions(): ImageExportOptions`   | Independent copy of the current output settings for persistence.                                                              |
| `revert()`                                 | Return to the loaded baseline as a single undoable edit.                                                                      |
| `hasChanges(): boolean`                    | Whether the document differs from its loaded baseline. Saving does not mark it clean; reset to the saved source when desired. |
| `reset(imageUrl?): Promise<void>`          | Load a new baseline, clearing selection and history after success. Without a URL, reload the last successful source.          |
| `updateOptions(options)`                   | Update presentation without losing the document, selection or history. An `image` value requests a source replacement.        |
| `destroy()`                                | Cancel pending loading and release the document. Normally called by React cleanup.                                            |

The latest requested image wins. Superseded requests reject with `AbortError`; late completion cannot restore a destroyed editor. A failed replacement rejects while preserving the previous document, history and pending crop. A successful replacement discards old pending controls before any immediate export. Initial failures have a retry surface; replacement failures leave the previous editor usable with an error message.

Export options accept `type` (`image/png`, `image/jpeg`, `image/webp`), `quality` (0–1), `width`, `height` and `background`. A single output dimension preserves aspect ratio. Pass defaults as `options.export`, or override them for one `getImage`/`getBlob` call. Export controls remain available when the host hides Save/Cancel.

To resume an editable document, save `getSourceBlob()`, `getDocument()` and `getExportOptions()` together with the rendered output. Load the original source, call `restoreDocument(savedDocument)`, and restore the export settings with `updateOptions({ export: savedOptions })`. A flattened export cannot recover its layers. Invalid state, a failed sticker load, or a newer edit leaves the current draft intact.

`getSourceBlob()` retains the original encoded bytes from the successful image load, including JPEG metadata. It never downloads an expired URL during Save. Custom `options.imageLoader(url, signal)` decoders can return origin-clean `{ source, width, height, sourceBlob? }` pixels; without `sourceBlob`, the original pixels are encoded as PNG. Loaders must honor cancellation.

Export settings support `fit: 'contain' | 'cover' | 'force'`, `upscale: false` to avoid enlargement, and `resampling: 'high' | 'pixelated'`. JPEG exports preserve EXIF by default while normalizing orientation and output dimensions and removing stale embedded thumbnails. Use `metadata: 'strip'` to omit metadata.

Server code can import `createDocument`, `parseDocument`, `parseExportOptions`, `resolveExportSize` and document types from `@lofcz/react-image-editor/document`. That entry has no React or browser dependency; hosts can validate the same saved state on the client and server.

The Path tool creates open paths and closed polygons with editable vertices. Shift-click or the layer list builds a multi-selection; marquee selection, group transforms, alignment and distribution keep one undo transaction. Text supports an outline, background and shadow; shapes support dashed strokes, cap/join styles, rounded corners and feathered edges.

See [the parity ledger](https://github.com/lofcz/react-image-editor/blob/main/docs/PINTURA_PARITY.md) for verified capabilities and remaining reference gaps. A matching tool or preset count does not imply full Pintura parity.

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

`showActions` defaults to true. All twelve tools default to enabled. Tools use boolean visibility flags; the rail can dock left or right. Theme, locale and tool changes do not remount the engine. Czech, Slovak, English and Polish are included; regional locales fall back to their base language and then English. Overrides use the existing flat `image_editor.*` keys; available keys are listed in [`src/locale.ts`](src/locale.ts).

The layout responds to its own container width. At 760px and below, tools become a horizontal bottom rail with a bounded contextual panel above it. The component inherits the host font. Hosts can override `--rie-bg`, `--rie-panel`, `--rie-muted`, `--rie-line`, `--rie-fg`, `--rie-secondary`, `--rie-accent` and `--rie-tint` on `.image-editor-root`. The root includes `data-editor-engine="local-canvas"`; stable `native-*` test IDs cover tools and controls.

## Migrating from version 1

The fork retains the React component, ref methods, callbacks, layout hooks and translation namespace. The runtime is now owned by this repository, with no Unlayer global, project, account, CDN or license service.

Hosted AI assistants, custom tool icons and remote font catalogs are not included. Stickers, frames, rounded corners, filters and annotations use this package's own implementation. `projectId`, `user`, `env`, `offline`, `licenseUrl`, `defaultPrompt`, `autoSubmitPrompt`, `aiAssistantOpenState`, `features.ai` and `scriptUrl` remain accepted as deprecated compatibility fields and have no effect. Tool flags are booleans. The old `features.imageEditor: false` shorthand is not supported. Built-in locales are now cs/sk/en/pl; provide translation overrides for other languages.

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
