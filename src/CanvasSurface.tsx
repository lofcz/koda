import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CanvasEngine } from './engine';
import {
  clamp,
  hitDocument,
  ImageDocument,
  Layer,
  layerCorners,
  multiply,
  pathLayer,
  Point,
  Rect,
  resizeLayer,
  rotateLayer,
  transform,
  translate,
  updateLayer,
} from './model';
import { fitView, paintDocument, View, zoomAt } from './render';
import type { EditorTool } from './types';

export interface SurfaceActions {
  fit(): void;
  zoom(factor: number): void;
}
type Props = {
  engine: CanvasEngine;
  doc: ImageDocument;
  selected: string | null;
  tool: EditorTool;
  brush: {
    color: string;
    size: number;
    mode: 'brush' | 'highlighter' | 'eraser';
  };
  crop: Rect;
  cropRatio: number | null;
  onCrop(rect: Rect): void;
  onText(id: string): void;
  t(key: string): string;
};
type Gesture =
  | { type: 'pan'; start: Point; view: View }
  | { type: 'draw'; base: ImageDocument; points: Point[]; id: string }
  | {
      type: 'move' | 'resize' | 'rotate';
      base: ImageDocument;
      layer: Layer;
      start: Point;
      corner: number;
    }
  | { type: 'crop'; start: Point; rect: Rect; mode: 'new' | 'move' | number }
  | { type: 'pinch'; view: View; center: Point; distance: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
function screen(p: Point, v: View): Point {
  return { x: v.x + p.x * v.zoom, y: v.y + p.y * v.zoom };
}
function rotationHandle(corners: Point[]): Point {
  const top = center(corners[0], corners[1]),
    middle = center(corners[0], corners[2]),
    d = Math.max(1, distance(top, middle));
  return {
    x: top.x + ((top.x - middle.x) * 26) / d,
    y: top.y + ((top.y - middle.y) * 26) / d,
  };
}

export const CanvasSurface = forwardRef<SurfaceActions, Props>(
  function CanvasSurface(
    { engine, doc, selected, tool, brush, crop, cropRatio, onCrop, onText, t },
    ref
  ) {
    const host = useRef<HTMLDivElement>(null),
      lower = useRef<HTMLCanvasElement>(null),
      upper = useRef<HTMLCanvasElement>(null);
    const [size, setSize] = useState({ width: 1, height: 1 });
    const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
    const gesture = useRef<Gesture | null>(null),
      pointers = useRef(new Map<number, Point>()),
      space = useRef(false);
    const image = engine.image?.source;
    const instructionsId = useId();
    useEffect(() => {
      const node = host.current;
      if (!node) return;
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        setView((v) =>
          zoomAt(v, v.zoom * Math.exp(-event.deltaY * 0.002), {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          })
        );
      };
      node.addEventListener('wheel', wheel, { passive: false });
      return () => node.removeEventListener('wheel', wheel);
    }, []);
    useLayoutEffect(() => {
      const node = host.current;
      if (!node) return;
      const measure = () => {
        const r = node.getBoundingClientRect();
        setSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);
    const fit = useCallback(
      () =>
        setView(
          fitView(
            { width: doc.width, height: doc.height },
            size.width,
            size.height
          )
        ),
      [doc.width, doc.height, size.width, size.height]
    );
    useEffect(() => {
      fit();
    }, [fit, image]);
    useImperativeHandle(
      ref,
      () => ({
        fit,
        zoom: (factor) =>
          setView((v) =>
            zoomAt(v, v.zoom * factor, {
              x: size.width / 2,
              y: size.height / 2,
            })
          ),
      }),
      [fit, size]
    );
    useEffect(() => () => engine.cancel(), [engine]);

    useLayoutEffect(() => {
      const canvas = lower.current,
        overlay = upper.current;
      if (!canvas || !overlay || !image) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      for (const item of [canvas, overlay]) {
        item.width = Math.round(size.width * dpr);
        item.height = Math.round(size.height * dpr);
      }
      const ctx = canvas.getContext('2d'),
        ui = overlay.getContext('2d');
      if (!ctx || !ui) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintDocument(ctx, doc, image, [
        view.zoom,
        0,
        0,
        view.zoom,
        view.x,
        view.y,
      ]);
      ui.setTransform(dpr, 0, 0, dpr, 0, 0);
      let corners: Point[] = [];
      if (tool === 'crop') {
        const a = screen(crop, view),
          w = crop.width * view.zoom,
          h = crop.height * view.zoom;
        ui.fillStyle = 'rgba(15,23,42,.52)';
        ui.beginPath();
        ui.rect(0, 0, size.width, size.height);
        ui.rect(a.x, a.y, w, h);
        ui.fill('evenodd');
        ui.strokeStyle = 'rgba(255,255,255,.65)';
        ui.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ui.beginPath();
          ui.moveTo(a.x + (w * i) / 3, a.y);
          ui.lineTo(a.x + (w * i) / 3, a.y + h);
          ui.moveTo(a.x, a.y + (h * i) / 3);
          ui.lineTo(a.x + w, a.y + (h * i) / 3);
          ui.stroke();
        }
        corners = [
          a,
          { x: a.x + w, y: a.y },
          { x: a.x + w, y: a.y + h },
          { x: a.x, y: a.y + h },
        ];
      } else {
        const layer = doc.layers.find((item) => item.id === selected);
        if (layer) {
          corners = layerCorners(layer).map((p) => screen(p, view));
          const handle = rotationHandle(corners),
            top = center(corners[0], corners[1]);
          ui.strokeStyle = '#0284c7';
          ui.beginPath();
          ui.moveTo(top.x, top.y);
          ui.lineTo(handle.x, handle.y);
          ui.stroke();
          ui.fillStyle = 'white';
          ui.beginPath();
          ui.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
          ui.fill();
          ui.stroke();
        }
      }
      if (corners.length) {
        ui.strokeStyle = '#0284c7';
        ui.lineWidth = 1.5;
        ui.beginPath();
        corners.forEach((p, i) =>
          i ? ui.lineTo(p.x, p.y) : ui.moveTo(p.x, p.y)
        );
        ui.closePath();
        ui.stroke();
        for (const p of corners) {
          ui.fillStyle = 'white';
          ui.fillRect(p.x - 4, p.y - 4, 8, 8);
          ui.strokeRect(p.x - 4, p.y - 4, 8, 8);
        }
      }
    }, [doc, image, view, size, selected, tool, crop]);

    const position = (event: { clientX: number; clientY: number }): Point => {
      const rect = host.current!.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const imagePoint = (p: Point): Point => ({
      x: (p.x - view.x) / view.zoom,
      y: (p.y - view.y) / view.zoom,
    });
    const inside = (p: Point) =>
      p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height;
    const cancel = () => {
      engine.cancel();
      if (gesture.current?.type === 'crop') onCrop(gesture.current.rect);
      gesture.current = null;
      pointers.current.clear();
    };
    const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      host.current?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const p = position(event),
        q = imagePoint(p);
      pointers.current.set(event.pointerId, p);
      if (pointers.current.size === 2) {
        engine.cancel();
        const [a, b] = [...pointers.current.values()];
        gesture.current = {
          type: 'pinch',
          view,
          center: center(a, b),
          distance: Math.max(1, distance(a, b)),
        };
        return;
      }
      if (pointers.current.size > 2) return;
      if (space.current || event.button === 1) {
        gesture.current = { type: 'pan', start: p, view };
        return;
      }
      if (tool === 'crop') {
        const corners = [
          crop,
          { x: crop.x + crop.width, y: crop.y },
          { x: crop.x + crop.width, y: crop.y + crop.height },
          { x: crop.x, y: crop.y + crop.height },
        ];
        const corner = corners.findIndex(
          (point) =>
            distance(screen(point, view), p) <
            (event.pointerType === 'touch' ? 18 : 10)
        );
        const inCrop =
          q.x >= crop.x &&
          q.y >= crop.y &&
          q.x <= crop.x + crop.width &&
          q.y <= crop.y + crop.height;
        gesture.current = {
          type: 'crop',
          start: q,
          rect: crop,
          mode: corner >= 0 ? corner : inCrop ? 'move' : 'new',
        };
        return;
      }
      const layer = doc.layers.find((item) => item.id === selected);
      if (layer && tool !== 'draw') {
        const corners = layerCorners(layer).map((point) => screen(point, view));
        const corner = corners.findIndex(
          (point) =>
            distance(point, p) < (event.pointerType === 'touch' ? 18 : 10)
        );
        if (corner >= 0 || distance(rotationHandle(corners), p) < 14) {
          engine.begin();
          gesture.current = {
            type: corner >= 0 ? 'resize' : 'rotate',
            base: doc,
            layer,
            start: q,
            corner,
          };
          return;
        }
      }
      if (tool === 'draw' && inside(q)) {
        engine.select(null);
        engine.begin();
        gesture.current = {
          type: 'draw',
          base: doc,
          points: [q],
          id: crypto.randomUUID(),
        };
        return;
      }
      const hit = hitDocument(doc, q, 6 / view.zoom);
      engine.select(hit?.id ?? null);
      if (hit) {
        engine.begin();
        gesture.current = {
          type: 'move',
          base: doc,
          layer: hit,
          start: q,
          corner: 0,
        };
      } else gesture.current = { type: 'pan', start: p, view };
    };
    const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const g = gesture.current;
      if (!g || !pointers.current.has(event.pointerId)) return;
      const p = position(event),
        q = imagePoint(p);
      pointers.current.set(event.pointerId, p);
      if (g.type === 'pinch') {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()],
          mid = center(a, b);
        const next = zoomAt(
          g.view,
          (g.view.zoom * distance(a, b)) / g.distance,
          g.center
        );
        setView({
          ...next,
          x: next.x + mid.x - g.center.x,
          y: next.y + mid.y - g.center.y,
        });
        return;
      }
      if (g.type === 'pan') {
        setView({
          ...g.view,
          x: g.view.x + p.x - g.start.x,
          y: g.view.y + p.y - g.start.y,
        });
        return;
      }
      if (g.type === 'draw') {
        const coalesced = event.nativeEvent.getCoalescedEvents?.();
        const samples = coalesced?.length ? coalesced : [event.nativeEvent];
        for (const sample of samples) {
          const point = imagePoint(position(sample));
          if (distance(point, g.points[g.points.length - 1]) > 0.75 / view.zoom)
            g.points.push(point);
        }
        // Bound memory for very long strokes, retaining their full extent and final point.
        if (g.points.length > 40000)
          g.points = g.points.filter(
            (_, i) => i % 2 === 0 || i === g.points.length - 1
          );
        const layer = pathLayer(g.points, {
          id: g.id,
          color: brush.color,
          strokeWidth: brush.size,
          opacity: brush.mode === 'highlighter' ? 0.35 : 1,
          erase: brush.mode === 'eraser',
        });
        engine.preview({ ...g.base, layers: [...g.base.layers, layer] });
        return;
      }
      if (g.type === 'crop') {
        if (g.mode === 'move') {
          onCrop({
            ...g.rect,
            x: clamp(g.rect.x + q.x - g.start.x, 0, doc.width - g.rect.width),
            y: clamp(g.rect.y + q.y - g.start.y, 0, doc.height - g.rect.height),
          });
          return;
        }
        const corner = typeof g.mode === 'number' ? g.mode : null;
        const anchor =
          corner === null
            ? g.start
            : [
                { x: g.rect.x + g.rect.width, y: g.rect.y + g.rect.height },
                { x: g.rect.x, y: g.rect.y + g.rect.height },
                g.rect,
                { x: g.rect.x + g.rect.width, y: g.rect.y },
              ][corner];
        const bounded = {
          x: clamp(q.x, 0, doc.width),
          y: clamp(q.y, 0, doc.height),
        };
        let w = Math.max(1, Math.abs(bounded.x - anchor.x)),
          h = Math.max(1, Math.abs(bounded.y - anchor.y));
        const ratio = event.shiftKey ? 1 : cropRatio;
        if (ratio) {
          if (w / h > ratio) w = h * ratio;
          else h = w / ratio;
        }
        onCrop({
          x: clamp(
            bounded.x < anchor.x ? anchor.x - w : anchor.x,
            0,
            doc.width - w
          ),
          y: clamp(
            bounded.y < anchor.y ? anchor.y - h : anchor.y,
            0,
            doc.height - h
          ),
          width: w,
          height: h,
        });
        return;
      }
      let next = g.layer;
      if (g.type === 'move')
        next = {
          ...g.layer,
          matrix: multiply(
            translate(q.x - g.start.x, q.y - g.start.y),
            g.layer.matrix
          ),
        };
      if (g.type === 'resize')
        next = resizeLayer(g.layer, g.corner, q, event.shiftKey);
      if (g.type === 'rotate') {
        const c = transform(g.layer.matrix, {
          x: g.layer.width / 2,
          y: g.layer.height / 2,
        });
        let angle =
          ((Math.atan2(q.y - c.y, q.x - c.x) -
            Math.atan2(g.start.y - c.y, g.start.x - c.x)) *
            180) /
          Math.PI;
        if (event.shiftKey) angle = Math.round(angle / 15) * 15;
        next = rotateLayer(g.layer, angle);
      }
      engine.preview(updateLayer(g.base, g.layer.id, next));
    };
    const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const g = gesture.current;
      if (g?.type === 'draw' && g.points.length === 1)
        engine.preview({
          ...g.base,
          layers: [
            ...g.base.layers,
            pathLayer(g.points, {
              id: g.id,
              color: brush.color,
              strokeWidth: brush.size,
              opacity: brush.mode === 'highlighter' ? 0.35 : 1,
              erase: brush.mode === 'eraser',
            }),
          ],
        });
      if (g && !['pan', 'pinch', 'crop'].includes(g.type)) engine.end();
      pointers.current.delete(event.pointerId);
      gesture.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === ' ') {
        space.current = true;
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        cancel();
        engine.select(null);
        event.preventDefault();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        engine.removeSelected();
        event.preventDefault();
        return;
      }
      if (event.key === '[' || event.key === ']') {
        const i = doc.layers.findIndex((layer) => layer.id === selected),
          direction = event.key === ']' ? 1 : -1;
        engine.select(
          doc.layers[(i + direction + doc.layers.length) % doc.layers.length]
            ?.id ?? null
        );
        event.preventDefault();
        return;
      }
      const layer = doc.layers.find((item) => item.id === selected);
      if (event.key === 'Enter' && layer?.kind === 'text') {
        onText(layer.id);
        event.preventDefault();
        return;
      }
      if (
        layer &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        if (event.altKey)
          engine.commit(
            updateLayer(
              doc,
              layer.id,
              rotateLayer(
                layer,
                (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 15 : 1)
              )
            )
          );
        else
          engine.commit(
            updateLayer(doc, layer.id, {
              matrix: multiply(
                translate(
                  event.key === 'ArrowLeft'
                    ? -amount
                    : event.key === 'ArrowRight'
                      ? amount
                      : 0,
                  event.key === 'ArrowUp'
                    ? -amount
                    : event.key === 'ArrowDown'
                      ? amount
                      : 0
                ),
                layer.matrix
              ),
            })
          );
      }
    };
    return (
      <div className="rie-canvas-wrap">
        <div
          ref={host}
          className="rie-canvas"
          role="application"
          tabIndex={0}
          aria-label={t('canvas.label')}
          aria-describedby={instructionsId}
          onKeyDown={keyDown}
          onKeyUp={(event) => {
            if (event.key === ' ') space.current = false;
          }}
          onBlur={() => {
            space.current = false;
          }}
        >
          <div
            className="rie-artboard"
            style={{
              left: view.x,
              top: view.y,
              width: doc.width * view.zoom,
              height: doc.height * view.zoom,
            }}
          />
          <canvas ref={lower} className="lower-canvas" aria-hidden="true" />
          <canvas
            ref={upper}
            className="upper-canvas"
            aria-hidden="true"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (gesture.current) cancel();
            }}
            onDoubleClick={(event) => {
              const layer = hitDocument(doc, imagePoint(position(event)));
              if (layer?.kind === 'text') onText(layer.id);
            }}
          />
        </div>
        <span id={instructionsId} className="rie-sr-only">
          {t('canvas.instructions')}
        </span>
      </div>
    );
  }
);
