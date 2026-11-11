import { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ImageEditor } from '../src/ImageEditor';
import type { ImageEditorRef } from '../src/types';

// Exercise the real wrapper and engine. Canvas controls have Chromium coverage.
vi.mock('../src/EditorUI', () => ({ EditorUI: () => null }));

class NativeImage {
  static instances: NativeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 320;
  naturalHeight = 240;
  crossOrigin = '';
  src = '';
  constructor() {
    NativeImage.instances.push(this);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('replaces and removes imageLoader without resetting the current draft', async () => {
  NativeImage.instances = [];
  vi.stubGlobal('Image', NativeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  } as unknown as CanvasRenderingContext2D);
  const firstLoader = vi.fn(async () => ({
    source: document.createElement('canvas'),
    width: 100,
    height: 80,
  }));
  const nextLoader = vi.fn(async () => ({
    source: document.createElement('canvas'),
    width: 200,
    height: 120,
  }));
  const ref = createRef<ImageEditorRef>(),
    onLoad = vi.fn();
  const mounted = render(
    <ImageEditor
      ref={ref}
      image="initial"
      options={{ imageLoader: firstLoader }}
      onLoad={onLoad}
    />
  );
  await waitFor(() =>
    expect(ref.current?.editor?.getDocument()?.width).toBe(100)
  );
  const editor = ref.current!.editor!;
  await act(async () => {
    await editor.restoreDocument({
      ...editor.getDocument()!,
      background: '#facc15',
    });
  });
  const draft = editor.getDocument();
  expect(editor.hasChanges()).toBe(true);

  mounted.rerender(
    <ImageEditor
      ref={ref}
      image="initial"
      options={{ imageLoader: nextLoader }}
      onLoad={onLoad}
    />
  );
  expect(editor.getDocument()).toEqual(draft);
  expect(editor.hasChanges()).toBe(true);
  expect(nextLoader).not.toHaveBeenCalled();
  await act(async () => {
    await editor.reset('replacement');
  });
  expect(nextLoader).toHaveBeenCalledExactlyOnceWith(
    'replacement',
    expect.any(AbortSignal)
  );
  expect(editor.getDocument()).toMatchObject({ width: 200, height: 120 });
  expect(firstLoader).toHaveBeenCalledTimes(1);

  await act(async () => {
    await editor.restoreDocument({
      ...editor.getDocument()!,
      background: '#30a46c',
    });
  });
  const secondDraft = editor.getDocument();
  mounted.rerender(
    <ImageEditor ref={ref} image="initial" options={{}} onLoad={onLoad} />
  );
  expect(editor.getDocument()).toEqual(secondDraft);
  expect(editor.hasChanges()).toBe(true);
  await act(async () => {
    const pending = editor.reset('native-source');
    const native = NativeImage.instances.at(-1)!;
    expect(native.src).toBe('native-source');
    native.onload?.();
    await pending;
  });
  expect(editor.getDocument()).toMatchObject({ width: 320, height: 240 });
  expect(nextLoader).toHaveBeenCalledTimes(1);
  expect(onLoad).toHaveBeenCalledTimes(1);
});
