// Shared browser selection for the Playwright suites.
//
//   EDITOR_BROWSER=chromium|firefox|webkit   (default: chromium)
//   CHROMIUM_PATH / FIREFOX_PATH / WEBKIT_PATH override the executable.
//   EDITOR_TOUCH=cdp|synthetic                (default: cdp on Chromium)
//
// Chromium drives touch through CDP `Input.dispatchTouchEvent`, which goes
// through the browser's real touch → pointer pipeline. Firefox and WebKit
// expose only single-point `touchscreen.tap`, so on those engines `createTouch`
// replays the same CDP-shaped commands as synthetic touch PointerEvents. The
// event order, ids, coordinates and capture semantics mirror what Chromium
// produces for the same CDP commands (measured with a probe page), so a suite
// can assert identical editor state on every engine. `EDITOR_TOUCH=synthetic`
// runs that emulation on Chromium to check it against the CDP path.
import { chromium, firefox, webkit } from 'playwright';

const engines = { chromium, firefox, webkit };
export const browserName = (process.env.EDITOR_BROWSER ?? 'chromium')
  .trim()
  .toLowerCase();
if (!engines[browserName])
  throw new Error(
    `EDITOR_BROWSER must be chromium, firefox or webkit, not "${browserName}"`
  );
export const isChromium = browserName === 'chromium';
export const touchMode =
  process.env.EDITOR_TOUCH ?? (isChromium ? 'cdp' : 'synthetic');
if (touchMode === 'cdp' && !isChromium)
  throw new Error('EDITOR_TOUCH=cdp needs EDITOR_BROWSER=chromium');

/** Resolution of mouse clientX/clientY in CSS pixels as delivered by the
 * engine under Playwright: Chromium keeps fractional coordinates, Firefox
 * truncates them to whole pixels (measured with a probe page). Assertions on
 * pointer-derived geometry may allow this much slack, never more. */
export const pointerQuantum = { chromium: 0, firefox: 1, webkit: 1 }[
  browserName
];

const executablePath = {
  chromium: process.env.CHROMIUM_PATH,
  firefox: process.env.FIREFOX_PATH,
  webkit: process.env.WEBKIT_PATH,
}[browserName];

export function launchBrowser(options = {}) {
  return engines[browserName].launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    ...options,
  });
}

/** Log a section that only one engine can drive, so skipped coverage is visible. */
export function skipped(section, reason) {
  console.info(`[${browserName}] skipped: ${section} (${reason})`);
}

/** Touch commands with CDP `Input.dispatchTouchEvent` semantics on every engine:
 * - touchStart: listed ids that are not down yet start; others move if changed.
 * - touchMove: listed ids move; an id that is not down starts a new touch.
 * - touchEnd: an empty list lifts every touch; otherwise lifts the listed ids
 *   at their listed coordinates.
 * - touchCancel: cancels every touch. */
export async function createTouch(page) {
  if (touchMode === 'cdp') {
    const cdp = await page.context().newCDPSession(page);
    return {
      send: (type, touchPoints) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints }),
      detach: () => cdp.detach(),
    };
  }
  return {
    send: (type, touchPoints) =>
      page.evaluate(syntheticTouch, {
        type,
        points: touchPoints.map(({ x, y, id }) => ({ x, y, id })),
      }),
    detach: async () => {},
  };
}

// Runs in the page. Kept self-contained so it can be serialized by evaluate.
function syntheticTouch({ type, points }) {
  const state = (window.__rieSyntheticTouch ??= (() => {
    const active = new Map(),
      captured = new Map(),
      synthetic = (id) => id >= 9000 && id < 10000;
    const proto = Element.prototype,
      set = proto.setPointerCapture,
      has = proto.hasPointerCapture,
      release = proto.releasePointerCapture;
    // Synthetic pointer ids are unknown to the browser, so real capture calls
    // would throw NotFoundError. Track capture for them instead; touch input is
    // implicitly captured to its pointerdown target anyway.
    proto.setPointerCapture = function (id) {
      if (!synthetic(id)) return set.call(this, id);
      captured.set(id, this);
    };
    proto.hasPointerCapture = function (id) {
      if (!synthetic(id)) return has.call(this, id);
      return captured.get(id) === this;
    };
    proto.releasePointerCapture = function (id) {
      if (!synthetic(id)) return release.call(this, id);
      if (captured.get(id) === this) captured.delete(id);
    };
    return { active, captured, next: 9000 };
  })());
  const fire = (target, eventType, pointer, x, y, buttons, extra = {}) =>
    target.dispatchEvent(
      new PointerEvent(eventType, {
        bubbles: !['pointerenter', 'pointerleave'].includes(eventType),
        cancelable: ![
          'pointerenter',
          'pointerleave',
          'pointercancel',
          'gotpointercapture',
          'lostpointercapture',
        ].includes(eventType),
        composed: true,
        view: window,
        pointerId: pointer.pointerId,
        pointerType: 'touch',
        isPrimary: pointer.primary,
        clientX: x,
        clientY: y,
        screenX: x + window.screenX,
        screenY: y + window.screenY,
        width: 1,
        height: 1,
        pressure: buttons ? 0.5 : 0,
        button: eventType === 'pointermove' ? -1 : 0,
        buttons,
        ...extra,
      })
    );
  const targetOf = (pointer) =>
    state.captured.get(pointer.pointerId) ?? pointer.target;
  const start = ({ id, x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document.body,
      pointer = {
        pointerId: state.next++,
        primary: state.active.size === 0,
        target,
        x,
        y,
      };
    if (state.next >= 10000) state.next = 9000;
    state.active.set(id, pointer);
    fire(target, 'pointerover', pointer, x, y, 1);
    fire(target, 'pointerenter', pointer, x, y, 1);
    fire(target, 'pointerdown', pointer, x, y, 1);
  };
  const move = (pointer, x, y) => {
    if (pointer.x === x && pointer.y === y) return;
    pointer.x = x;
    pointer.y = y;
    fire(targetOf(pointer), 'pointermove', pointer, x, y, 1);
  };
  const finish = (id, pointer, kind, x = pointer.x, y = pointer.y) => {
    const target = targetOf(pointer);
    state.active.delete(id);
    fire(target, kind, pointer, x, y, 0, {
      button: kind === 'pointercancel' ? -1 : 0,
    });
    // The implicit release after pointerup/cancel fires lostpointercapture.
    if (state.captured.has(pointer.pointerId)) {
      state.captured.delete(pointer.pointerId);
      fire(target, 'lostpointercapture', pointer, x, y, 0);
    }
    fire(target, 'pointerout', pointer, x, y, 0);
    fire(target, 'pointerleave', pointer, x, y, 0);
  };
  if (type === 'touchStart' || type === 'touchMove') {
    const fresh = [];
    for (const point of points) {
      const pointer = state.active.get(point.id);
      if (pointer) move(pointer, point.x, point.y);
      else fresh.push(point);
    }
    fresh.forEach(start);
  } else if (type === 'touchEnd') {
    if (points.length)
      for (const point of points) {
        const pointer = state.active.get(point.id);
        if (pointer) finish(point.id, pointer, 'pointerup', point.x, point.y);
      }
    else
      for (const [id, pointer] of [...state.active])
        finish(id, pointer, 'pointerup');
  } else if (type === 'touchCancel') {
    for (const [id, pointer] of [...state.active])
      finish(id, pointer, 'pointercancel');
  } else throw new Error(`Unknown touch event ${type}`);
}
