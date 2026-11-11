import { vi } from 'vitest';
import { loadImage } from '../src/engine';

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 120;
  naturalHeight = 80;
  crossOrigin = '';
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
}
beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['pixels'], { type: 'image/png' }),
    }))
  );
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:owned-image'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  } as unknown as CanvasRenderingContext2D);
});
async function loading(url: string, signal = new AbortController().signal) {
  const count = FakeImage.instances.length,
    promise = loadImage(url, signal);
  await vi.waitFor(() => expect(FakeImage.instances).toHaveLength(count + 1));
  return { promise, image: FakeImage.instances[count] };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('requests anonymous CORS and validates exportability before resolving', async () => {
  const { promise, image } = await loading(
    'https://example.com/image.png',
    new AbortController().signal
  );
  expect(image.crossOrigin).toBe('anonymous');
  expect(image.src).toBe('blob:owned-image');
  expect(fetch).toHaveBeenCalledWith('https://example.com/image.png', {
    signal: expect.any(AbortSignal),
    credentials: 'same-origin',
  });
  image.onload?.();
  expect(await promise).toMatchObject({
    width: 120,
    height: 80,
    source: image,
  });
  expect(image.onload).toBeNull();
  expect(image.onerror).toBeNull();
  expect((await promise).sourceBlob).toBeInstanceOf(Blob);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-image');
});
it('aborts decoding and detaches callbacks without waiting for the network', async () => {
  const controller = new AbortController(),
    { promise, image } = await loading('slow', controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(image.src).toBe('');
  expect(image.onload).toBeNull();
});
it('does not start loading a request already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadImage('ignored', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(FakeImage.instances).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects failed, empty and tainted images and missing Canvas2D', async () => {
  const { promise: failed } = await loading('missing');
  FakeImage.instances.at(-1)!.onerror?.();
  await expect(failed).rejects.toThrow('Unable to load');
  const { promise: empty } = await loading('empty');
  FakeImage.instances.at(-1)!.naturalWidth = 0;
  FakeImage.instances.at(-1)!.onload?.();
  await expect(empty).rejects.toThrow('no pixels');
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => {
      throw new DOMException('tainted', 'SecurityError');
    },
  } as unknown as CanvasRenderingContext2D);
  const { promise: tainted } = await loading('tainted');
  FakeImage.instances.at(-1)!.onload?.();
  await expect(tainted).rejects.toMatchObject({ name: 'SecurityError' });
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const { promise: unavailable } = await loading('canvas');
  FakeImage.instances.at(-1)!.onload?.();
  await expect(unavailable).rejects.toThrow('Canvas2D');
});
