// @vitest-environment node
import {
  createDocument,
  parseDocument,
  MAX_DIMENSION,
  MAX_PIXELS,
} from '../src/document';
import type { ImageDocument } from '../src/document';

it('validates serialized documents in a Node environment without browser globals', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  const doc: ImageDocument = createDocument(640, 480);
  expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  expect(() => parseDocument({ ...doc, width: MAX_DIMENSION + 1 })).toThrow();
  expect(MAX_PIXELS).toBeGreaterThan(MAX_DIMENSION);
});
