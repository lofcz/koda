// Reproducible editor benchmark. Not part of the default gate.
//
//   node test/perf.mjs                       # Chromium, normal + 4x CPU throttle
//   EDITOR_BROWSER=firefox node test/perf.mjs
//   EDITOR_PERF_RUNS=5 EDITOR_PERF_OUT=perf.json node test/perf.mjs
//   EDITOR_PERF_ROOT=/path/to/other/checkout node test/perf.mjs   # A/B a revision
//
// Builds demo/verification.html for production (minified React, no dev
// checks) and serves it with `vite preview`, so numbers reflect a host app.
// Every scenario runs EDITOR_PERF_RUNS times; the report keeps the median of
// each metric across runs.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserName, isChromium, launchBrowser } from './browser-env.mjs';

const root = process.env.EDITOR_PERF_ROOT
    ? path.resolve(process.env.EDITOR_PERF_ROOT)
    : fileURLToPath(new URL('..', import.meta.url)),
  demo = path.join(root, 'demo'),
  port = Number(process.env.EDITOR_PERF_PORT ?? 4254),
  runs = Number(process.env.EDITOR_PERF_RUNS ?? 3),
  throttles = (process.env.EDITOR_PERF_THROTTLE ?? (isChromium ? '1,4' : '1'))
    .split(',')
    .map(Number);
const require = createRequire(path.join(demo, 'package.json'));
const vite = await import(pathToFileURL(require.resolve('vite')).href);
const outDir = mkdtempSync(path.join(tmpdir(), 'rie-perf-'));
await vite.build({
  root: demo,
  configFile: path.join(demo, 'vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: path.join(demo, 'verification.html') },
  },
});
const server = await vite.preview({
  root: demo,
  configFile: path.join(demo, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir },
  preview: { port, host: '127.0.0.1', strictPort: true },
});
const base = `http://127.0.0.1:${port}`;

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value) =>
  value === null || value === undefined ? null : Math.round(value * 10) / 10;

// In-page helpers, installed once per page.
const install = () => {
  window.__perf = {
    percentile(values, p) {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[
        Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
      ];
    },
    frame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
    heap: () => performance.memory?.usedJSHeapSize ?? null,
    peak: null,
    sampler: null,
    startHeap() {
      this.peak = this.heap();
      this.sampler = setInterval(() => {
        const value = this.heap();
        if (value !== null) this.peak = Math.max(this.peak ?? 0, value);
      }, 20);
    },
    stopHeap() {
      clearInterval(this.sampler);
      const value = this.heap();
      if (value !== null) this.peak = Math.max(this.peak ?? 0, value);
      return this.peak;
    },
    /** Deterministic photo-like content: gradients, noise and hard edges. */
    async image(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#1d4e89');
      gradient.addColorStop(0.5, '#f4a259');
      gradient.addColorStop(1, '#5b8e7d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      let seed = 7;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsla(${random() * 360},70%,${30 + random() * 40}%,0.6)`;
        ctx.beginPath();
        ctx.arc(
          random() * width,
          random() * height,
          (random() * Math.min(width, height)) / 8,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      return URL.createObjectURL(blob);
    },
    async load(url) {
      const started = performance.now();
      await window.localEditor.reset(url);
      while (
        document
          .querySelector('[data-editor-engine] [data-ready]')
          ?.getAttribute('data-ready') !== 'true'
      )
        await this.frame();
      const ready = performance.now() - started;
      await this.frame();
      return { ready, firstPaint: performance.now() - started };
    },
    /** Time from each input to the next frame, plus frame-to-frame intervals. */
    async scrub(input, values) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set;
      input.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
      );
      const times = [];
      await this.frame();
      for (const value of values) {
        const started = performance.now();
        setter.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await this.frame();
        times.push(performance.now() - started);
      }
      input.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })
      );
      return times;
    },
    frames: [],
    recording: false,
    async record() {
      this.frames = [];
      this.recording = true;
      let last = await this.frame();
      while (this.recording) {
        const now = await this.frame();
        this.frames.push(now - last);
        last = now;
      }
    },
  };
};

// EDITOR_PERF_PROFILE=1 (Chromium): sample the CPU during each 4K gesture and
// report the functions with the most self time.
const profileTop = async (cdp, run) => {
  if (!cdp) return run();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await run();
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(),
    byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const interval =
    (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length);
  for (const id of profile.samples) {
    const frame = byId.get(id).callFrame,
      name = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + interval / 1000);
  }
  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, ms]) => `${Math.round(ms)}ms ${name}`);
};

const scenario = async (page, throttle, cdp) => {
  const result = {};
  const profiled = async (name, size, run) => {
    if (size !== '4K' || !cdp) return run();
    result[`profile ${name}`] = await profileTop(cdp, run);
  };
  const startHeap = () => page.evaluate(() => window.__perf.startHeap());
  const stopHeap = () => page.evaluate(() => window.__perf.stopHeap());
  // Cold load of the 600x400 harness: navigation to editor ready.
  const navigated = Date.now();
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  result.pageLoadToReady = Date.now() - navigated;
  await page.evaluate(install);
  const urls = await page.evaluate(async () => ({
    '1K': await window.__perf.image(1024, 768),
    '4K': await window.__perf.image(3840, 2160),
  }));
  for (const size of ['1K', '4K']) {
    await startHeap();
    const load = await page.evaluate(
      (url) => window.__perf.load(url),
      urls[size]
    );
    result[`load${size}Ready`] = load.ready;
    result[`load${size}FirstPaint`] = load.firstPaint;
    // Effect slider scrub (Adjust → Brightness), 40 steps.
    await page.getByTestId('native-tool-adjust').click();
    let scrub;
    await profiled('scrub', size, async () => {
      scrub = await page.evaluate(async () => {
        const input = document.querySelector(
          '[data-testid="native-filter-brightness"]'
        );
        const values = Array.from({ length: 40 }, (_, i) =>
          Math.round(Math.sin(i / 4) * 60)
        );
        const times = await window.__perf.scrub(input, values);
        return [
          window.__perf.percentile(times, 50),
          window.__perf.percentile(times, 95),
        ];
      });
    });
    result[`scrub${size}P50`] = scrub[0];
    result[`scrub${size}P95`] = scrub[1];
    await page.getByTestId('native-tool-options-close').click();
    // Export latency.
    for (const type of ['image/png', 'image/jpeg']) {
      result[`export${size}${type === 'image/png' ? 'Png' : 'Jpeg'}`] =
        await page.evaluate(async (type) => {
          const started = performance.now();
          await window.localEditor.getBlob({ type, quality: 0.9 });
          return performance.now() - started;
        }, type);
    }
    // Drag one shape among 200 shapes + 20 text layers.
    await page.evaluate(async () => {
      const doc = window.localEditor.getDocument(),
        layers = [];
      let seed = 11;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const kinds = ['rectangle', 'ellipse', 'triangle', 'line', 'arrow'];
      for (let i = 0; i < 200; i++)
        layers.push({
          id: `shape-${i}`,
          kind: kinds[i % kinds.length],
          matrix: [
            1,
            0,
            0,
            1,
            random() * doc.width * 0.9,
            random() * doc.height * 0.9,
          ],
          width: doc.width * (0.03 + random() * 0.08),
          height: doc.height * (0.03 + random() * 0.08),
          color: '#202a38',
          fill: i % 2 ? '#facc15' : 'transparent',
          strokeWidth: Math.max(2, doc.width / 300),
          opacity: 1,
        });
      for (let i = 0; i < 20; i++)
        layers.push({
          id: `text-${i}`,
          kind: 'text',
          text: `Label ${i}`,
          fontSize: Math.round(doc.width / 40),
          fontFamily: 'sans-serif',
          matrix: [
            1,
            0,
            0,
            1,
            random() * doc.width * 0.8,
            random() * doc.height * 0.9,
          ],
          width: doc.width / 8,
          height: doc.width / 30,
          color: '#ffffff',
          fill: 'transparent',
          strokeWidth: 0,
          opacity: 1,
        });
      layers.push({
        id: 'target',
        kind: 'rectangle',
        matrix: [1, 0, 0, 1, doc.width * 0.4, doc.height * 0.4],
        width: doc.width * 0.2,
        height: doc.height * 0.2,
        color: '#e5484d',
        fill: '#e5484d',
        strokeWidth: 4,
        opacity: 1,
      });
      await window.localEditor.restoreDocument({ ...doc, layers });
    });
    await page.getByTestId('native-tool-select').click();
    const box = await page.locator('.rie-artboard').boundingBox();
    const cx = box.x + box.width * 0.5,
      cy = box.y + box.height * 0.5;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await profiled('drag', size, async () => {
      const recording = page.evaluate(() => window.__perf.record());
      await page.mouse.move(cx + 120, cy + 60, { steps: 40 });
      await page.evaluate(() => (window.__perf.recording = false));
      await recording;
    });
    await page.mouse.up();
    const drag = await page.evaluate(() => [
      window.__perf.percentile(window.__perf.frames, 50),
      window.__perf.percentile(window.__perf.frames, 95),
    ]);
    result[`drag${size}P50`] = drag[0];
    result[`drag${size}P95`] = drag[1];
    // Hover across the canvas: should only repaint the overlay.
    const hoverRecording = page.evaluate(() => window.__perf.record());
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, {
      steps: 40,
    });
    await page.evaluate(() => (window.__perf.recording = false));
    await hoverRecording;
    result[`hover${size}P95`] = await page.evaluate(() =>
      window.__perf.percentile(window.__perf.frames, 95)
    );
    // Crop preview: drag the right edge handle.
    await page.evaluate(async () => {
      const doc = window.localEditor.getDocument();
      await window.localEditor.restoreDocument({ ...doc, layers: [] });
    });
    await page.getByTestId('native-tool-crop').click();
    await page.evaluate(() => window.__perf.frame());
    const crop = await page.locator('.rie-crop-artboard').boundingBox();
    const hx = crop.x + crop.width - 1,
      hy = crop.y + crop.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    const cropRecording = page.evaluate(() => window.__perf.record());
    await page.mouse.move(hx - crop.width * 0.3, hy, { steps: 40 });
    await page.evaluate(() => (window.__perf.recording = false));
    await cropRecording;
    await page.mouse.up();
    const cropFrames = await page.evaluate(() => [
      window.__perf.percentile(window.__perf.frames, 50),
      window.__perf.percentile(window.__perf.frames, 95),
    ]);
    result[`crop${size}P50`] = cropFrames[0];
    result[`crop${size}P95`] = cropFrames[1];
    await page.getByTestId('native-crop-cancel').click();
    result[`heap${size}PeakMB`] = await stopHeap().then((bytes) =>
      bytes === null ? null : bytes / 1048576
    );
  }
  result.throttle = throttle;
  return result;
};

const browser = await launchBrowser({
  // Expose performance.memory with real values in Chromium.
  ...(isChromium
    ? { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] }
    : {}),
});
const report = {
  browser: `${browserName} ${browser.version()}`,
  cpu: `${cpus()[0]?.model} (${cpus().length} threads)`,
  memoryGB: Math.round(totalmem() / 1073741824),
  loadAverageAtStart: loadavg().map((value) => Math.round(value * 10) / 10),
  revision: (() => {
    try {
      return execSync('git describe --always --dirty', { cwd: root })
        .toString()
        .trim();
    } catch {
      return null;
    }
  })(),
  runs,
  results: {},
};
try {
  for (const throttle of throttles) {
    const samples = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({
          viewport: { width: 1280, height: 860 },
        }),
        page = await context.newPage();
      const cdp = isChromium ? await context.newCDPSession(page) : null;
      if (throttle !== 1)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      samples.push(
        await scenario(
          page,
          throttle,
          process.env.EDITOR_PERF_PROFILE && run === 0 ? cdp : null
        )
      );
      await context.close();
    }
    const keys = Object.keys(samples[0]).filter((key) => key !== 'throttle');
    report.results[`${throttle}x`] = Object.fromEntries(
      keys.map((key) => [
        key,
        key.startsWith('profile ')
          ? samples[0][key]
          : round(median(samples.map((s) => s[key]))),
      ])
    );
  }
  report.loadAverageAtEnd = loadavg().map(
    (value) => Math.round(value * 10) / 10
  );
  const json = JSON.stringify(report, null, 2);
  console.info(json);
  if (process.env.EDITOR_PERF_OUT)
    writeFileSync(process.env.EDITOR_PERF_OUT, `${json}\n`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  rmSync(outDir, { recursive: true, force: true });
}
