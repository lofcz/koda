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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('requests anonymous CORS and validates exportability before resolving', async () => {
  const promise = loadImage(
      'https://example.com/image.png',
      new AbortController().signal
    ),
    image = FakeImage.instances[0];
  expect(image.crossOrigin).toBe('anonymous');
  expect(image.src).toBe('https://example.com/image.png');
  image.onload?.();
  expect(await promise).toMatchObject({
    width: 120,
    height: 80,
    source: image,
  });
  expect(image.onload).toBeNull();
  expect(image.onerror).toBeNull();
});
it('aborts decoding and detaches callbacks without waiting for the network', async () => {
  const controller = new AbortController(),
    promise = loadImage('slow', controller.signal),
    image = FakeImage.instances[0];
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
  expect(FakeImage.instances[0].src).toBe('');
});
it('rejects failed, empty and tainted images and missing Canvas2D', async () => {
  const failed = loadImage('missing', new AbortController().signal);
  FakeImage.instances.at(-1)!.onerror?.();
  await expect(failed).rejects.toThrow('Unable to load');
  const empty = loadImage('empty', new AbortController().signal);
  FakeImage.instances.at(-1)!.naturalWidth = 0;
  FakeImage.instances.at(-1)!.onload?.();
  await expect(empty).rejects.toThrow('no pixels');
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => {
      throw new DOMException('tainted', 'SecurityError');
    },
  } as unknown as CanvasRenderingContext2D);
  const tainted = loadImage('tainted', new AbortController().signal);
  FakeImage.instances.at(-1)!.onload?.();
  await expect(tainted).rejects.toMatchObject({ name: 'SecurityError' });
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const unavailable = loadImage('canvas', new AbortController().signal);
  FakeImage.instances.at(-1)!.onload?.();
  await expect(unavailable).rejects.toThrow('Canvas2D');
});
