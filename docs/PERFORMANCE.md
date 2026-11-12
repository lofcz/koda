# Performance

`test/perf.mjs` is a reproducible benchmark. It is not part of the default gate.

```sh
pnpm run test:perf                                   # Chromium, normal and 4x CPU throttle
EDITOR_BROWSER=firefox pnpm run test:perf            # Firefox (no throttle, no heap)
EDITOR_PERF_RUNS=5 EDITOR_PERF_OUT=perf.json pnpm run test:perf
EDITOR_PERF_ROOT=../other-checkout pnpm run test:perf   # measure another revision
EDITOR_PERF_PROFILE=1 pnpm run test:perf             # add top self-time functions for 4K gestures
```

The script builds `demo/verification.html` for production (minified React) and serves it with `vite preview`, so the numbers include no development-mode React checks. Each scenario runs `EDITOR_PERF_RUNS` times (default 3) in a fresh browser context; the report keeps the median of every metric. The JSON report records the browser version, CPU, memory, the git revision of the measured checkout and the load average at start and end.

## Scenarios

Images are generated in the page (gradient plus 400 translucent circles, PNG) at 1024×768 (1K) and 3840×2160 (4K). The viewport is 1280×860.

| Metric            | What is measured                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageLoadToReady` | Navigation to the 600×400 harness until the editor reports `ready` (ms)                                                                         |
| `load*Ready`      | `reset(url)` with the 1K/4K image until the editor is `ready` (ms)                                                                              |
| `load*FirstPaint` | The same, until the next animation frame after `ready` (ms)                                                                                     |
| `scrub*P50/P95`   | Adjust → Brightness: 40 slider input events, each timed from the input event to the next animation frame (ms)                                   |
| `export*Png/Jpeg` | `getBlob()` latency at full resolution (ms), right after the scrub                                                                              |
| `drag*P50/P95`    | Frame intervals while dragging one rectangle across 200 shapes and 20 text layers with 40 mouse moves (ms). 16.7 is one 60 Hz frame             |
| `hover*P95`       | Frame intervals while the pointer crosses the same 221-layer document without a button (ms)                                                     |
| `crop*P50/P95`    | Frame intervals while dragging the crop's right edge with 40 moves (ms)                                                                         |
| `heap*PeakMB`     | Peak `performance.memory.usedJSHeapSize` sampled every 20 ms during the size's scenarios (Chromium only; canvas backing stores are not JS heap) |
| `4x`              | Chromium `Emulation.setCPUThrottlingRate` 4 for the whole run                                                                                   |

## Machine and conditions

- Chromium 158.0.8127.18 (Playwright 1.65 headless shell), Intel(R) Core(TM) Ultra 5 235U (14 threads), 62 GB RAM, CachyOS Linux, 2026-11-12.
- The machine was shared with other heavy work (a QEMU VM, dev servers and other browser suites). 1-minute load averages during the runs: `954025a` run A 65.5 → 97.2, run B 78 → 83, `3f32b72` 86.3 → 78.9. Absolute numbers are therefore far slower and noisier than on an idle machine; the two baseline runs of identical code differ by up to 9× on some metrics.
- Medians of 3 runs per column. Raw JSON reports were produced with `EDITOR_PERF_OUT`; the baseline used `EDITOR_PERF_ROOT` on a detached `954025a` worktree.

Read only changes that fall outside both baseline runs and have a known mechanism as real. They are listed under Findings.

## Chromium, normal CPU

| Metric (ms unless noted)            | `954025a` run A | `954025a` run B | `3f32b72` |
| ----------------------------------- | --------------: | --------------: | --------: |
| Harness page load → ready (600×400) |            3955 |            2319 |      2434 |
| 1K load → ready                     |             419 |           306.1 |     412.6 |
| 1K load → first paint               |             523 |           321.1 |     427.9 |
| 4K load → ready                     |          4503.2 |          2370.7 |    1381.4 |
| 4K load → first paint               |          4518.3 |          2420.7 |    1397.2 |
| 1K effect scrub p50                 |           292.1 |           186.2 |     105.4 |
| 1K effect scrub p95                 |           955.3 |           471.3 |     501.3 |
| 4K effect scrub p50                 |            2233 |            1358 |     148.3 |
| 4K effect scrub p95                 |          4559.3 |            2724 |     832.3 |
| 1K drag (221 layers) frame p50      |            83.3 |              50 |        50 |
| 1K drag (221 layers) frame p95      |           783.3 |           316.7 |     283.3 |
| 4K drag (221 layers) frame p50      |            66.7 |            33.5 |        50 |
| 4K drag (221 layers) frame p95      |          1016.6 |           433.3 |     316.6 |
| 1K hover frame p95                  |             200 |            33.4 |       150 |
| 4K hover frame p95                  |           233.4 |              50 |     116.7 |
| 1K crop edge drag frame p50         |            83.4 |            33.4 |        50 |
| 1K crop edge drag frame p95         |           566.7 |           133.3 |       200 |
| 4K crop edge drag frame p50         |            83.3 |            33.4 |      66.7 |
| 4K crop edge drag frame p95         |           516.7 |           166.7 |     216.6 |
| 1K PNG export                       |          1623.4 |           179.7 |     308.7 |
| 1K JPEG export                      |          1439.2 |           119.6 |     122.4 |
| 4K PNG export                       |          3438.6 |          2116.8 |    4514.6 |
| 4K JPEG export                      |          1741.2 |           987.6 |    1881.7 |
| 1K peak JS heap (MB)                |              53 |            56.1 |      33.7 |
| 4K peak JS heap (MB)                |           163.3 |           131.6 |      45.6 |

## Chromium, 4× CPU throttle

| Metric (ms unless noted)            | `954025a` run A | `954025a` run B | `3f32b72` |
| ----------------------------------- | --------------: | --------------: | --------: |
| Harness page load → ready (600×400) |           11524 |            3210 |      6540 |
| 1K load → ready                     |          1636.7 |           773.6 |    1013.5 |
| 1K load → first paint               |          1862.7 |           824.1 |    1084.9 |
| 4K load → ready                     |          6610.4 |          3178.4 |      3850 |
| 4K load → first paint               |          6718.8 |          3238.6 |    4124.2 |
| 1K effect scrub p50                 |           739.2 |           483.3 |     470.3 |
| 1K effect scrub p95                 |          2781.3 |          1033.1 |    1262.4 |
| 4K effect scrub p50                 |          6017.4 |          3614.2 |     387.8 |
| 4K effect scrub p95                 |         14265.1 |          5511.2 |    1089.3 |
| 1K drag (221 layers) frame p50      |           133.3 |           116.6 |     116.6 |
| 1K drag (221 layers) frame p95      |          1166.6 |           733.3 |     716.7 |
| 4K drag (221 layers) frame p50      |           200.1 |           116.7 |     116.7 |
| 4K drag (221 layers) frame p95      |          2549.9 |           983.3 |       750 |
| 1K hover frame p95                  |             650 |           149.9 |       300 |
| 4K hover frame p95                  |           616.7 |           216.7 |     133.4 |
| 1K crop edge drag frame p50         |             150 |            50.1 |      83.3 |
| 1K crop edge drag frame p95         |           833.2 |           216.7 |     233.3 |
| 4K crop edge drag frame p50         |           166.7 |            83.3 |       100 |
| 4K crop edge drag frame p95         |          1149.9 |           249.9 |       350 |
| 1K PNG export                       |          2830.8 |           799.7 |    1405.4 |
| 1K JPEG export                      |          1710.5 |           286.8 |     568.1 |
| 4K PNG export                       |          7784.1 |          5229.5 |   11347.4 |
| 4K JPEG export                      |          7175.7 |          4091.8 |    2920.2 |
| 1K peak JS heap (MB)                |            46.4 |            43.9 |      31.5 |
| 4K peak JS heap (MB)                |           131.7 |           131.6 |      45.6 |

## Profiles

`EDITOR_PERF_PROFILE=1` on the effect-display-resolution build (between `954025a` and `3f32b72`), 4K, normal CPU, self time:

- Effect scrub: `drawImage` 15.1 s, minified editor code 3.1 s, `getImageData` 1.1 s.
- Drag with 221 layers: `drawImage` 24.9 s; React and editor code under 0.5 s each.

Both gestures spent their time compositing the full 3840×2160 document every frame and downscaling it to the screen. Effects were also filtered over every source pixel per slider step.

## Findings and changes

1. **Effects filtered at display resolution** (`paintDocument`): the on-screen view filters a copy of the source at about display resolution in half-octave steps. Export filters at full resolution through its own cache.
2. **Document composed at display resolution**: when the view shows the document smaller than its pixels, the preview composes into a reduced canvas. Feather blur and text-shadow lengths are device pixels that the canvas transform does not scale, so they now follow the transform outside the layer. Export is unchanged; reduced previews and the crop preview now match it (`test/core-browser.mjs` checks the reduced preview against the scaled export).

Outside both baselines:

- 4K effect scrub p50 1358–2233 → 148 ms (4×: 3614–6017 → 388 ms); p95 2724–4559 → 832 ms (4×: 5511–14265 → 1089 ms).
- 4K peak JS heap 132–163 → 46 MB; 1K 44–56 → 32–34 MB.
- **Regression:** 4K PNG export 2117–3439 → 4515 ms (4×: 5230–7784 → 11347 ms). The preview no longer holds a full-resolution filtered image and composition, so the first export after an effect change computes them. A 1K export is not affected beyond noise.

Within the noise of the two baselines (no claim either way): page load, 1K load, 1K scrub, drags, hover, crop edge drags, 1K exports, 4K JPEG export and 4K load under throttling. Hover never recomposes the document (`paintDocument` depends on the document, view and tool, not hover state).

## Not measured

- Firefox and WebKit timings: `EDITOR_BROWSER=firefox` runs the same benchmark without CPU throttling or heap numbers, but no run at this load produced numbers worth recording.
- Canvas backing-store memory (not in the JS heap), low-memory devices, real mobile hardware and an idle machine.
