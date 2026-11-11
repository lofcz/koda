/** Browser fixture for the host's async onLoad restoration under React StrictMode. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageEditor } from '../src/ImageEditor';
import { CanvasEngine, loadImage } from '../src/engine';
import {
  createDocument,
  cropDocument,
  pathLayer,
  translate,
} from '../src/model';

export async function verifyStrictStickerRestore() {
  const canvas = document.createElement('canvas');
  canvas.width = 1248;
  canvas.height = 832;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const source = canvas.toDataURL();
  canvas.width = canvas.height = 12;
  const stickerContext = canvas.getContext('2d')!;
  stickerContext.fillStyle = '#00ff00';
  stickerContext.fillRect(0, 0, 12, 12);
  const sticker = canvas.toDataURL(),
    restored = {
      ...cropDocument(createDocument(1248, 832), {
        x: 0,
        y: 0,
        width: 512,
        height: 512,
      }),
      layers: [
        {
          ...pathLayer([]),
          id: 'persisted-sticker',
          kind: 'image' as const,
          width: 12,
          height: 12,
          matrix: translate(20, 30),
          imageSource: sticker,
        },
      ],
    };
  let release!: () => void,
    begin!: (engine: CanvasEngine) => void,
    complete!: () => void,
    fail!: (error: unknown) => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<CanvasEngine>((resolve) => {
      begin = resolve;
    }),
    done = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
  // Keep the rejection observed while the fixture waits for StrictMode cleanup.
  void done.catch(() => {});
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:700px;display:flex';
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <StrictMode>
        <ImageEditor
          image={source}
          options={{
            showActions: false,
            imageLoader: async (url, signal) => {
              if (url === sticker) await gate;
              return loadImage(url, signal);
            },
          }}
          onLoad={(instance) => {
            const engine = instance as CanvasEngine;
            const restoring = instance.restoreDocument(restored);
            begin(engine);
            void restoring.then(complete, fail);
          }}
        />
      </StrictMode>
    );
    const engine = await started,
      before = engine.getSnapshot().revision;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    engine.cancel();
    engine.end();
    engine.getDocument();
    engine.getImage();
    await engine.getBlob();
    const notifications = engine.getSnapshot().revision - before;
    release();
    await done;
    const snapshot = engine.getSnapshot();
    if (
      snapshot.document?.width !== 512 ||
      snapshot.document.height !== 512 ||
      snapshot.document.layers[0]?.id !== 'persisted-sticker'
    )
      throw new Error('StrictMode did not restore the complete saved document');
    const blob = await engine.getBlob(),
      bitmap = await createImageBitmap(blob);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      layers: snapshot.document.layers.length,
      notifications,
    };
    bitmap.close();
    return result;
  } finally {
    release();
    root.unmount();
    host.remove();
  }
}
