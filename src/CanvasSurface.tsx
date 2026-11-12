import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CanvasEngine } from './engine';
import {
  DEFAULT_EFFECTS,
  hitDocument,
  ImageDocument,
  inverse,
  Layer,
  Matrix,
  layerCorners,
  multiply,
  pathLayer,
  Point,
  Rect,
  resizeLayer,
  rotateLayer,
  scale,
  ShapeKind,
  transform,
  translate,
  updateLayer,
} from './model';
import {
  CropMode,
  cropHandles,
  distance,
  dragCrop,
  duplicateLayers,
  lineEndpoints,
  midpoint,
  moveLineEndpoint,
  marqueeLayers,
  pathNodes,
  pathSegments,
  rectFromPoints,
  resizeCursor,
  resizeTextBox,
  SnapGuide,
  snapMove,
  selectionFrame,
  snapPathPoint,
  transformLayers,
  withPathPoints,
} from './interactions';
import {
  fitTextLayer,
  fitView,
  paintCropPreview,
  paintDocument,
  View,
  zoomAt,
} from './render';
import {
  centerCropOnSource,
  constrainCropRect,
  constrainImageToCrop,
  cropOutputSize,
  CropConstraintError,
  transformImage,
  type CropOptions,
  type CropSize,
} from './crop';
import { clipCropGuides, paintCropMask, paintCropOverlay } from './cropOverlay';
import { resolveTextStyle, textContent } from './textModel';
import {
  RichTextInput,
  type RichTextInputHandle,
  type RichTextRenderer,
  type RichTextRendererProps,
} from './RichTextInput';
import type { TextSelection, TextStyleState } from './richText';
import type { EditorTool } from './types';

export interface SurfaceActions {
  fit(): void;
  zoom(factor: number): void;
  actualSize(): void;
  cancel(): void;
  editText(id: string): void;
  finishText(cancel?: boolean): void;
  flushText(): void;
  editPath(id: string): void;
  finishPath(closed?: boolean): void;
  deletePathPoint(): void;
  cropZoom(factor: number): void;
  cropRecenter(): void;
  fitCrop(): void;
  finishCropGesture(): void;
}
export type PathState = {
  drawing: boolean;
  editing: boolean;
  canFinish: boolean;
  canClose: boolean;
  canRemovePoint: boolean;
};
type Props = {
  engine: CanvasEngine;
  doc: ImageDocument;
  selected: string | null;
  selectedIds?: readonly string[];
  tool: EditorTool;
  brush: {
    color: string;
    size: number;
    mode: 'brush' | 'highlighter' | 'eraser';
    opacity?: number;
  };
  crop: Rect;
  cropRatio: number | null;
  cropOptions?: CropOptions;
  /** Staged preset output size; print guides measure output pixels against it. */
  cropOutput?: CropSize;
  compare?: boolean;
  snap?: boolean;
  shape?: ShapeKind | 'path' | null;
  redaction?: { mode: 'pixelate' | 'blur' | 'solid'; size: number };
  onViewChange?(view: { zoom: number; fitted: boolean }): void;
  onCropApply?(): void;
  onCropCancel?(): void;
  onImportImage?(file: File): void;
  onCrop(rect: Rect): void;
  onText(id: string): void;
  renderTextInput?: RichTextRenderer;
  onTextEditor?(editor: RichTextInputHandle | null): void;
  onTextSelectionChange?(selection: TextSelection, marks: TextStyleState): void;
  onPathStateChange?(state: PathState): void;
  t(key: string): string;
};
type Gesture =
  | { type: 'pan'; start: Point; view: View }
  | { type: 'draw'; base: ImageDocument; points: Point[]; id: string }
  | { type: 'create'; base: ImageDocument; start: Point; layer: Layer }
  | {
      type: 'move' | 'resize' | 'rotate' | 'endpoint' | 'node';
      base: ImageDocument;
      layer: Layer;
      start: Point;
      corner: number;
      ids?: readonly string[];
    }
  | { type: 'marquee'; start: Point; ids: readonly string[]; additive: boolean }
  | { type: 'path-tap' }
  | {
      type: 'crop';
      base: ImageDocument;
      start: Point;
      rect: Rect;
      mode: CropMode;
    }
  | {
      type: 'crop-image';
      base: ImageDocument;
      rollback: ImageDocument;
      start: Point;
      rect: Rect;
    }
  | {
      type: 'crop-pinch';
      base: ImageDocument;
      rollback: ImageDocument;
      center: Point;
      distance: number;
      rect: Rect;
    }
  | { type: 'pinch'; view: View; center: Point; distance: number };
type PathDraft = {
  base: ImageDocument;
  points: Point[];
  id: string;
  style: Partial<Layer>;
};
const screen = (p: Point, v: View): Point => ({
  x: v.x + p.x * v.zoom,
  y: v.y + p.y * v.zoom,
});
function rotationHandle(corners: Point[]): Point {
  const top = midpoint(corners[0], corners[1]),
    middle = midpoint(corners[0], corners[2]),
    d = Math.max(1, distance(top, middle));
  return {
    x: top.x + ((top.x - middle.x) * 26) / d,
    y: top.y + ((top.y - middle.y) * 26) / d,
  };
}
const cropCursor = (mode: CropMode) =>
  mode === 'move'
    ? 'move'
    : mode === 'new'
      ? 'crosshair'
      : (
          {
            nw: 'nwse-resize',
            ne: 'nesw-resize',
            se: 'nwse-resize',
            sw: 'nesw-resize',
            n: 'ns-resize',
            s: 'ns-resize',
            e: 'ew-resize',
            w: 'ew-resize',
          } as const
        )[mode];
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[contenteditable="true"]');
const DEFAULT_CROP_OPTIONS: CropOptions = {};

export const CanvasSurface = forwardRef<SurfaceActions, Props>(
  function CanvasSurface(
    {
      engine,
      doc,
      selected,
      selectedIds,
      tool,
      brush,
      crop,
      cropRatio,
      cropOptions = DEFAULT_CROP_OPTIONS,
      cropOutput,
      compare = false,
      snap = true,
      shape,
      redaction,
      onViewChange,
      onCropApply,
      onCropCancel,
      onImportImage,
      onCrop,
      onText,
      renderTextInput,
      onTextEditor,
      onTextSelectionChange,
      onPathStateChange,
      t,
    },
    ref
  ) {
    const host = useRef<HTMLDivElement>(null),
      lower = useRef<HTMLCanvasElement>(null),
      upper = useRef<HTMLCanvasElement>(null),
      textInput = useRef<RichTextInputHandle | null>(null);
    const [size, setSize] = useState({ width: 1, height: 1 }),
      [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
    const viewRef = useRef(view),
      fitted = useRef(true),
      gesture = useRef<Gesture | null>(null),
      pointers = useRef(new Map<number, Point>()),
      space = useRef(false),
      keyboardTransaction = useRef(false),
      editRef = useRef<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null),
      [guides, setGuides] = useState<SnapGuide[]>([]),
      [cursor, setCursor] = useState('default'),
      [dragOver, setDragOver] = useState(false),
      [hover, setHover] = useState<string | null>(null),
      [brushPoint, setBrushPoint] = useState<Point | null>(null),
      [marquee, setMarquee] = useState<Rect | null>(null),
      [pathDraft, setPathDraft] = useState<PathDraft | null>(null),
      [pathHover, setPathHover] = useState<Point | null>(null),
      [editingPath, setEditingPath] = useState<string | null>(null),
      [nodeIndex, setNodeIndex] = useState<number | null>(null);
    const pathDraftRef = useRef<PathDraft | null>(null);
    const engineSelection = engine.getSnapshot().selectedIds;
    const selection = useMemo(
      () => selectedIds ?? engineSelection,
      [selectedIds, engineSelection]
    );
    const group = useMemo(
      () => (selection.length > 1 ? selectionFrame(doc, selection) : null),
      [doc, selection]
    );
    const image = engine.image?.source,
      instructionsId = useId();
    const cropState = useRef({ tool, crop, options: cropOptions });
    useLayoutEffect(() => {
      cropState.current = { tool, crop, options: cropOptions };
    }, [tool, crop, cropOptions]);
    const previewCropImage = useCallback(
      (
        base: ImageDocument,
        matrix: Matrix,
        rect: Rect,
        options: CropOptions
      ) => {
        const source = engine.image;
        if (!source) return;
        try {
          const next = constrainImageToCrop(
            matrix,
            source,
            rect,
            options.allowOutsideImage
          );
          engine.preview(
            transformImage(base, multiply(next, inverse(base.imageMatrix)))
          );
        } catch (error) {
          if (!(error instanceof CropConstraintError)) throw error;
          // Keep the last valid preview when an extreme gesture cannot satisfy bounds.
        }
      },
      [engine]
    );
    const zoomCrop = useCallback(
      (factor: number, anchor?: Point) => {
        const current = engine.getSnapshot().document,
          state = cropState.current;
        if (
          !current ||
          state.tool !== 'crop' ||
          state.options.enableZoom === false ||
          !Number.isFinite(factor) ||
          factor <= 0
        )
          return;
        const center = anchor ?? {
          x: state.crop.x + state.crop.width / 2,
          y: state.crop.y + state.crop.height / 2,
        };
        const limited = Math.max(0.01, Math.min(100, factor));
        previewCropImage(
          current,
          multiply(
            multiply(
              translate(center.x, center.y),
              multiply(scale(limited), translate(-center.x, -center.y))
            ),
            current.imageMatrix
          ),
          state.crop,
          state.options
        );
      },
      [engine, previewCropImage]
    );
    const recenterCrop = useCallback(() => {
      const current = engine.getSnapshot().document,
        source = engine.image,
        state = cropState.current;
      if (!current || !source || state.tool !== 'crop') return;
      const center = transform(current.imageMatrix, {
        x: source.width / 2,
        y: source.height / 2,
      });
      previewCropImage(
        current,
        multiply(
          translate(
            state.crop.x + state.crop.width / 2 - center.x,
            state.crop.y + state.crop.height / 2 - center.y
          ),
          current.imageMatrix
        ),
        state.crop,
        state.options
      );
    }, [engine, previewCropImage]);
    const updateView = useCallback((next: View, isFit = false) => {
      fitted.current = isFit;
      viewRef.current = next;
      setView(next);
    }, []);
    useEffect(() => {
      onViewChange?.({ zoom: view.zoom, fitted: fitted.current });
    }, [view, onViewChange]);
    useEffect(() => {
      const node = host.current;
      if (!node) return;
      const wheel = (event: WheelEvent) => {
        if (isTyping(event.target)) return;
        if (gesture.current) return;
        const rect = node.getBoundingClientRect();
        const p = { x: event.clientX - rect.left, y: event.clientY - rect.top },
          state = cropState.current;
        if (
          state.tool === 'crop' &&
          state.options.interactionFocus === 'image'
        ) {
          const q = {
            x: (p.x - viewRef.current.x) / viewRef.current.zoom,
            y: (p.y - viewRef.current.y) / viewRef.current.zoom,
          };
          if (
            state.options.enableZoom === false ||
            q.x < state.crop.x ||
            q.y < state.crop.y ||
            q.x > state.crop.x + state.crop.width ||
            q.y > state.crop.y + state.crop.height
          )
            return;
          event.preventDefault();
          zoomCrop(
            Math.exp(
              -event.deltaY *
                (event.deltaMode === 1
                  ? 32
                  : event.deltaMode === 2
                    ? size.height
                    : 1) *
                0.002
            ),
            q
          );
          return;
        }
        event.preventDefault();
        updateView(
          zoomAt(
            viewRef.current,
            viewRef.current.zoom * Math.exp(-event.deltaY * 0.002),
            p
          )
        );
      };
      node.addEventListener('wheel', wheel, { passive: false });
      return () => node.removeEventListener('wheel', wheel);
    }, [updateView, zoomCrop, size.height]);
    useLayoutEffect(() => {
      const node = host.current;
      if (!node) return;
      const measure = () => {
        const r = node.getBoundingClientRect();
        setSize((current) =>
          r.width === current.width && r.height === current.height
            ? current
            : { width: Math.max(1, r.width), height: Math.max(1, r.height) }
        );
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);
    const fit = useCallback(
      () =>
        updateView(
          fitView(
            { width: doc.width, height: doc.height },
            size.width,
            size.height
          ),
          true
        ),
      [doc.width, doc.height, size.width, size.height, updateView]
    );
    const previousFrame = useRef({
      width: 0,
      height: 0,
      documentWidth: 0,
      documentHeight: 0,
      image,
    });
    useLayoutEffect(() => {
      const previous = previousFrame.current;
      if (
        fitted.current ||
        previous.image !== image ||
        previous.documentWidth !== doc.width ||
        previous.documentHeight !== doc.height
      )
        fit();
      else if (previous.width !== size.width || previous.height !== size.height)
        updateView({
          ...viewRef.current,
          x: viewRef.current.x + (size.width - previous.width) / 2,
          y: viewRef.current.y + (size.height - previous.height) / 2,
        });
      previousFrame.current = {
        ...size,
        documentWidth: doc.width,
        documentHeight: doc.height,
        image,
      };
    }, [fit, image, doc.width, doc.height, size, updateView]);
    const finishText = useCallback(
      (cancel = false) => {
        if (!editRef.current) return;
        if (!cancel) textInput.current?.flush();
        editRef.current = null;
        setEditing(null);
        if (cancel) engine.cancel();
        else engine.end();
      },
      [engine]
    );
    const previewPath = useCallback(
      (draft: PathDraft) => {
        pathDraftRef.current = draft;
        setPathDraft(draft);
        engine.preview({
          ...draft.base,
          layers: [
            ...draft.base.layers,
            pathLayer(draft.points, {
              ...draft.style,
              id: draft.id,
              pathEditable: true,
            }),
          ],
        });
      },
      [engine]
    );
    const finishPath = useCallback(
      (closed = false) => {
        const draft = pathDraftRef.current;
        if (!draft) return;
        pathDraftRef.current = null;
        setPathDraft(null);
        setPathHover(null);
        if (draft.points.length < 2 || (closed && draft.points.length < 3)) {
          engine.cancel();
          return;
        }
        engine.preview({
          ...draft.base,
          layers: [
            ...draft.base.layers,
            pathLayer(draft.points, {
              ...draft.style,
              id: draft.id,
              pathEditable: true,
              pathClosed: closed,
            }),
          ],
        });
        engine.end();
        engine.select(draft.id);
        setEditingPath(draft.id);
        setNodeIndex(null);
      },
      [engine]
    );
    const editPath = useCallback(
      (id: string) => {
        finishText();
        finishPath();
        const layer = engine
          .getSnapshot()
          .document?.layers.find((item) => item.id === id);
        if (
          !layer ||
          layer.kind !== 'path' ||
          !layer.pathEditable ||
          layer.locked ||
          layer.hidden
        )
          return;
        engine.select(id);
        setEditingPath((current) => (current === id ? null : id));
        setNodeIndex(null);
        host.current?.focus({ preventScroll: true });
      },
      [engine, finishPath, finishText]
    );
    const deletePathPoint = useCallback(() => {
      const current = engine.getSnapshot().document,
        layer = current?.layers.find((item) => item.id === editingPath);
      if (
        !current ||
        !layer ||
        nodeIndex === null ||
        (layer.points?.length ?? 0) <= (layer.pathClosed ? 3 : 2)
      )
        return;
      engine.commit(
        updateLayer(
          current,
          layer.id,
          withPathPoints(
            layer,
            layer.points!.filter((_, index) => index !== nodeIndex)
          )
        )
      );
      setNodeIndex(null);
    }, [engine, editingPath, nodeIndex]);
    useEffect(() => {
      const layer = doc.layers.find((item) => item.id === editingPath);
      onPathStateChange?.({
        drawing: !!pathDraft,
        editing: !!layer,
        canFinish: (pathDraft?.points.length ?? 0) >= 2,
        canClose: (pathDraft?.points.length ?? 0) >= 3,
        canRemovePoint:
          !!layer &&
          nodeIndex !== null &&
          (layer.points?.length ?? 0) > (layer.pathClosed ? 3 : 2),
      });
    }, [doc.layers, editingPath, nodeIndex, pathDraft, onPathStateChange]);
    useEffect(() => {
      if (
        editingPath &&
        (selection.length !== 1 ||
          selection[0] !== editingPath ||
          !doc.layers.some((layer) => layer.id === editingPath))
      ) {
        setEditingPath(null);
        setNodeIndex(null);
      }
      const path = doc.layers.find((layer) => layer.id === editingPath);
      if (nodeIndex !== null && nodeIndex >= (path?.points?.length ?? 0))
        setNodeIndex(null);
      if (
        pathDraftRef.current &&
        !doc.layers.some((layer) => layer.id === pathDraftRef.current!.id)
      ) {
        pathDraftRef.current = null;
        setPathDraft(null);
        setPathHover(null);
      }
    }, [doc.layers, editingPath, nodeIndex, selection]);
    const cancel = useCallback(() => {
      const current = gesture.current;
      if (current?.type === 'crop') {
        onCrop(current.rect);
        engine.preview(current.base);
      }
      if (current?.type === 'crop-image' || current?.type === 'crop-pinch')
        engine.preview(current.rollback);
      if (current?.type === 'marquee') engine.selectMany(current.ids);
      if (current?.type === 'pan' || current?.type === 'pinch')
        updateView(current.view);
      gesture.current = null;
      pointers.current.clear();
      keyboardTransaction.current = false;
      pathDraftRef.current = null;
      setPathDraft(null);
      setPathHover(null);
      setMarquee(null);
      finishText(true);
      if (tool !== 'crop') engine.cancel();
      setGuides([]);
      setCursor('default');
    }, [engine, finishText, onCrop, updateView, tool]);
    const beginText = useCallback(
      (id: string) => {
        finishPath();
        finishText();
        const current = engine.getSnapshot().document,
          layer = current?.layers.find((item) => item.id === id);
        if (!current || !layer || layer.kind !== 'text' || layer.locked) return;
        engine.select(id);
        engine.begin();
        editRef.current = id;
        setEditing(id);
        onText(id);
      },
      [engine, finishPath, finishText, onText]
    );
    useEffect(() => {
      if (editing) {
        textInput.current?.focus();
        textInput.current?.select();
      }
    }, [editing]);
    useEffect(() => {
      if (
        editing &&
        (!doc.layers.some((layer) => layer.id === editing) ||
          selected !== editing ||
          tool !== 'text')
      )
        finishText();
    }, [doc.layers, editing, selected, tool, finishText]);
    useImperativeHandle(
      ref,
      () => ({
        fit,
        cancel,
        editText: beginText,
        finishText,
        flushText: () => textInput.current?.flush(),
        editPath,
        finishPath,
        deletePathPoint,
        cropZoom: zoomCrop,
        cropRecenter: () => {
          const state = cropState.current;
          if (state.options.interactionFocus === 'image') return recenterCrop();
          const current = engine.getSnapshot().document,
            source = engine.image;
          if (!current || !source || state.tool !== 'crop') return;
          let rect: Rect;
          try {
            rect = centerCropOnSource(
              state.crop,
              { ...source, matrix: current.imageMatrix },
              state.options,
              { aspectRatio: state.options.aspectRatio ?? cropRatio }
            );
          } catch (error) {
            if (!(error instanceof CropConstraintError)) throw error;
            return;
          }
          onCrop(rect);
          // Pan only when the moved crop leaves the viewport; zoom out only if it cannot fit.
          const view = viewRef.current,
            a = screen(rect, view),
            w = rect.width * view.zoom,
            h = rect.height * view.zoom;
          if (
            a.x >= 0 &&
            a.y >= 0 &&
            a.x + w <= size.width &&
            a.y + h <= size.height
          )
            return;
          const fitted = fitView(rect, size.width, size.height),
            zoom = Math.min(view.zoom, fitted.zoom);
          updateView({
            zoom,
            x: size.width / 2 - (rect.x + rect.width / 2) * zoom,
            y: size.height / 2 - (rect.y + rect.height / 2) * zoom,
          });
        },
        fitCrop: () => {
          const rect = cropState.current.crop;
          const fitted = fitView(rect, size.width, size.height);
          updateView({
            ...fitted,
            x: fitted.x - rect.x * fitted.zoom,
            y: fitted.y - rect.y * fitted.zoom,
          });
        },
        finishCropGesture: () => {
          gesture.current = null;
          pointers.current.clear();
          keyboardTransaction.current = false;
          setGuides([]);
        },
        actualSize: () =>
          updateView(
            zoomAt(viewRef.current, 1, {
              x: size.width / 2,
              y: size.height / 2,
            })
          ),
        zoom: (factor) =>
          updateView(
            zoomAt(viewRef.current, viewRef.current.zoom * factor, {
              x: size.width / 2,
              y: size.height / 2,
            })
          ),
      }),
      [
        fit,
        cancel,
        beginText,
        finishText,
        editPath,
        finishPath,
        deletePathPoint,
        zoomCrop,
        recenterCrop,
        size,
        updateView,
        engine,
        cropRatio,
        onCrop,
      ]
    );
    useEffect(() => () => engine.cancel(), [engine]);
    useEffect(
      () =>
        engine.subscribe(() => {
          const current = gesture.current;
          if (
            current &&
            ['crop', 'crop-image', 'crop-pinch'].includes(current.type) &&
            (!engine.inTransaction || engine.getSnapshot().phase !== 'ready')
          ) {
            // A no-op restore can end the draft without emitting a change event.
            // Drop captured coordinates synchronously before the tool cleanup runs.
            gesture.current = null;
            pointers.current.clear();
            setGuides([]);
          }
        }),
      [engine]
    );
    useEffect(
      () =>
        engine.subscribeChanges(() => {
          // Exports, restores and history commands can commit while a pointer is captured.
          // The document now owns that result; an old gesture must never replay its base.
          if (gesture.current) {
            gesture.current = null;
            pointers.current.clear();
            setGuides([]);
            setMarquee(null);
          }
          if (pathDraftRef.current) {
            pathDraftRef.current = null;
            setPathDraft(null);
            setPathHover(null);
          }
          keyboardTransaction.current = false;
        }),
      [engine]
    );
    const previousMode = useRef({ image, tool, compare, shape });
    useEffect(() => {
      const previous = previousMode.current;
      if (
        previous.image !== image ||
        previous.tool !== tool ||
        previous.compare !== compare ||
        previous.shape !== shape
      ) {
        if (gesture.current) cancel();
        if (previous.image !== image) {
          pathDraftRef.current = null;
          setPathDraft(null);
          setPathHover(null);
        } else finishPath();
        setEditingPath(null);
        setNodeIndex(null);
        if (previous.image !== image) finishText(true);
        setGuides([]);
        setHover(null);
        setBrushPoint(null);
      }
      previousMode.current = { image, tool, compare, shape };
    }, [image, tool, compare, shape, cancel, finishText, finishPath]);
    useEffect(() => {
      const reset = () => {
        space.current = false;
        if (gesture.current) cancel();
        if (keyboardTransaction.current) {
          keyboardTransaction.current = false;
          if (tool !== 'crop') engine.end();
        }
      };
      window.addEventListener('blur', reset);
      return () => window.removeEventListener('blur', reset);
    }, [cancel, engine, tool]);

    useLayoutEffect(() => {
      const canvas = lower.current;
      if (!canvas || !image) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const width = Math.round(size.width * dpr),
        height = Math.round(size.height * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const displayDocument = compare
        ? {
            ...doc,
            layers: [],
            effects: DEFAULT_EFFECTS,
            background: 'transparent',
            frame: { ...doc.frame, style: 'none' as const },
            cornerRadius: 0,
          }
        : editing
          ? {
              ...doc,
              layers: doc.layers.filter((layer) => layer.id !== editing),
            }
          : doc;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (tool === 'crop' && !compare) {
        ctx.save();
        ctx.transform(view.zoom, 0, 0, view.zoom, view.x, view.y);
        paintCropPreview(ctx, doc, image, crop, engine.assets, cropOptions);
        ctx.restore();
      } else
        paintDocument(
          ctx,
          displayDocument,
          image,
          [view.zoom, 0, 0, view.zoom, view.x, view.y],
          engine.assets
        );
    }, [
      doc,
      image,
      view,
      size,
      compare,
      editing,
      engine,
      tool,
      crop,
      cropOptions,
    ]);

    useLayoutEffect(() => {
      const overlay = upper.current;
      if (!overlay) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1),
        width = Math.round(size.width * dpr),
        height = Math.round(size.height * dpr);
      if (overlay.width !== width) overlay.width = width;
      if (overlay.height !== height) overlay.height = height;
      const ui = overlay.getContext('2d');
      if (!ui) return;
      ui.setTransform(1, 0, 0, 1, 0, 0);
      ui.clearRect(0, 0, overlay.width, overlay.height);
      ui.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (compare) return;
      const accent =
        getComputedStyle(host.current!)
          .getPropertyValue('--rie-accent')
          .trim() || '#0797a7';
      const path = (points: Point[], closed = true) => {
        ui.beginPath();
        points.forEach((p, i) =>
          i ? ui.lineTo(p.x, p.y) : ui.moveTo(p.x, p.y)
        );
        if (closed) ui.closePath();
      };
      const handle = (p: Point, radius = 5) => {
        ui.fillStyle = '#fff';
        ui.strokeStyle = accent;
        ui.lineWidth = 1.5;
        ui.beginPath();
        ui.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ui.fill();
        ui.stroke();
      };
      if (tool === 'crop') {
        const a = screen(crop, view),
          w = crop.width * view.zoom,
          h = crop.height * view.zoom;
        const area = { x: a.x, y: a.y, width: w, height: h };
        paintCropMask(ui, size, area, cropOptions);
        clipCropGuides(ui, area, cropOptions);
        ui.strokeStyle = 'rgba(255,255,255,.48)';
        ui.lineWidth = 1;
        const guides = cropOptions.guides ?? 'thirds';
        const stops =
          typeof guides === 'object'
            ? guides
            : {
                columns:
                  guides === 'grid'
                    ? [0.25, 0.5, 0.75]
                    : guides === 'thirds'
                      ? [1 / 3, 2 / 3]
                      : [],
                rows:
                  guides === 'grid'
                    ? [0.25, 0.5, 0.75]
                    : guides === 'thirds'
                      ? [1 / 3, 2 / 3]
                      : [],
              };
        for (const stop of stops.columns) {
          ui.beginPath();
          ui.moveTo(a.x + w * stop, a.y);
          ui.lineTo(a.x + w * stop, a.y + h);
          ui.stroke();
        }
        for (const stop of stops.rows) {
          ui.beginPath();
          ui.moveTo(a.x, a.y + h * stop);
          ui.lineTo(a.x + w, a.y + h * stop);
          ui.stroke();
        }
        if (guides === 'diagonals') {
          path([a, { x: a.x + w, y: a.y + h }], false);
          ui.stroke();
          path(
            [
              { x: a.x + w, y: a.y },
              { x: a.x, y: a.y + h },
            ],
            false
          );
          ui.stroke();
        }
        ui.restore();
        ui.strokeStyle = '#fff';
        ui.lineWidth = 1.5;
        ui.strokeRect(a.x, a.y, w, h);
        paintCropOverlay(ui, area, crop, cropOptions, cropOutput);
        for (const { handle: name, point } of cropOptions.handleStyle ===
        'invisible'
          ? []
          : cropHandles(crop)) {
          const p = screen(point, view);
          ui.lineWidth = 3;
          ui.beginPath();
          if (name.length === 2) {
            if (cropOptions.handleStyle !== 'hook') {
              ui.fillStyle = '#fff';
              ui.strokeStyle = '#1f2937';
              ui.lineWidth = 1;
              ui.arc(p.x, p.y, 5, 0, Math.PI * 2);
              ui.fill();
              ui.stroke();
              ui.strokeStyle = '#fff';
              continue;
            }
            const dx = name.includes('w') ? 1 : -1,
              dy = name.includes('n') ? 1 : -1;
            ui.moveTo(p.x + dx * Math.min(18, w / 4), p.y);
            ui.lineTo(p.x, p.y);
            ui.lineTo(p.x, p.y + dy * Math.min(18, h / 4));
          } else if (name === 'n' || name === 's') {
            ui.moveTo(p.x - Math.min(10, w / 6), p.y);
            ui.lineTo(p.x + Math.min(10, w / 6), p.y);
          } else {
            ui.moveTo(p.x, p.y - Math.min(10, h / 6));
            ui.lineTo(p.x, p.y + Math.min(10, h / 6));
          }
          ui.stroke();
        }
        if (cropOptions.showSize !== false) {
          const output = cropOutputSize(crop, cropOptions);
          const label = `${output.width} × ${output.height}`;
          ui.font = '500 12px system-ui, sans-serif';
          const labelWidth = ui.measureText(label).width + 18,
            labelX = Math.max(
              4,
              Math.min(
                size.width - labelWidth - 4,
                a.x + w / 2 - labelWidth / 2
              )
            ),
            labelY =
              a.y + h + 32 < size.height
                ? a.y + h + 8
                : Math.max(4, a.y + h - 32);
          ui.fillStyle = 'rgba(15,23,42,.82)';
          ui.beginPath();
          ui.roundRect(labelX, labelY, labelWidth, 24, 6);
          ui.fill();
          ui.fillStyle = '#fff';
          ui.textBaseline = 'middle';
          ui.fillText(label, labelX + 9, labelY + 12);
        }
      } else if (!editing) {
        const hovered = doc.layers.find(
          (item) => item.id === hover && !selection.includes(item.id)
        );
        if (hovered && !gesture.current) {
          ui.strokeStyle = accent;
          ui.globalAlpha = 0.6;
          ui.lineWidth = 1;
          ui.setLineDash([4, 3]);
          path(layerCorners(hovered).map((p) => screen(p, view)));
          ui.stroke();
          ui.setLineDash([]);
          ui.globalAlpha = 1;
        }
        if (group) {
          ui.strokeStyle = accent;
          ui.lineWidth = 1;
          ui.globalAlpha = 0.55;
          for (const item of doc.layers.filter((item) =>
            selection.includes(item.id)
          )) {
            path(layerCorners(item).map((p) => screen(p, view)));
            ui.stroke();
          }
          ui.globalAlpha = 1;
        }
        const layer = group ?? doc.layers.find((item) => item.id === selected);
        if (layer && !layer.hidden) {
          const corners = layerCorners(layer).map((p) => screen(p, view));
          ui.strokeStyle = accent;
          ui.lineWidth = 1.5;
          if (layer.id === editingPath && layer.kind === 'path') {
            const nodes = pathNodes(layer).map((point) => screen(point, view));
            ui.setLineDash([4, 3]);
            path(nodes, !!layer.pathClosed);
            ui.stroke();
            ui.setLineDash([]);
            for (const item of pathSegments(layer)) {
              const p = screen(item.point, view);
              ui.fillStyle = '#fff';
              ui.fillRect(p.x - 3, p.y - 3, 6, 6);
              ui.strokeRect(p.x - 3, p.y - 3, 6, 6);
            }
            nodes.forEach((point, index) => {
              handle(point, index === nodeIndex ? 7 : 5);
              if (index === nodeIndex) {
                ui.fillStyle = accent;
                ui.beginPath();
                ui.arc(point.x, point.y, 3, 0, Math.PI * 2);
                ui.fill();
              }
            });
          } else if (layer.kind === 'line' || layer.kind === 'arrow') {
            const ends = lineEndpoints(layer).map((p) => screen(p, view));
            path(ends, false);
            ui.stroke();
            if (!layer.locked) ends.forEach((p) => handle(p, 6));
          } else {
            path(corners);
            ui.stroke();
            if (!layer.locked) {
              const r = rotationHandle(corners),
                top = midpoint(corners[0], corners[1]);
              path([top, r], false);
              ui.stroke();
              handle(r);
              corners.forEach((p) => handle(p));
              if (layer.kind === 'text') {
                handle(midpoint(corners[0], corners[3]), 5);
                handle(midpoint(corners[1], corners[2]), 5);
              }
            }
          }
        }
      }
      if (pathDraft) {
        const points = pathDraft.points.map((point) => screen(point, view));
        ui.strokeStyle = accent;
        ui.lineWidth = 1.5;
        if (pathHover) {
          ui.setLineDash([4, 3]);
          path([points[points.length - 1], screen(pathHover, view)], false);
          ui.stroke();
          ui.setLineDash([]);
        }
        points.forEach((point, index) => handle(point, index === 0 ? 6 : 4));
      }
      if (marquee) {
        const p = screen(marquee, view);
        ui.fillStyle = accent;
        ui.globalAlpha = 0.12;
        ui.fillRect(
          p.x,
          p.y,
          marquee.width * view.zoom,
          marquee.height * view.zoom
        );
        ui.globalAlpha = 1;
        ui.strokeStyle = accent;
        ui.lineWidth = 1;
        ui.strokeRect(
          p.x,
          p.y,
          marquee.width * view.zoom,
          marquee.height * view.zoom
        );
      }
      ui.strokeStyle = '#e762a1';
      ui.lineWidth = 1;
      ui.setLineDash([4, 3]);
      for (const guide of guides) {
        const value =
          guide.axis === 'x'
            ? view.x + guide.value * view.zoom
            : view.y + guide.value * view.zoom;
        path(
          guide.axis === 'x'
            ? [
                { x: value, y: view.y },
                { x: value, y: view.y + doc.height * view.zoom },
              ]
            : [
                { x: view.x, y: value },
                { x: view.x + doc.width * view.zoom, y: value },
              ],
          false
        );
        ui.stroke();
      }
      ui.setLineDash([]);
      if (tool === 'draw' && brushPoint && !space.current) {
        ui.beginPath();
        ui.arc(
          brushPoint.x,
          brushPoint.y,
          Math.max(2, (brush.size * view.zoom) / 2),
          0,
          Math.PI * 2
        );
        ui.strokeStyle = 'rgba(0,0,0,.8)';
        ui.lineWidth = 2.5;
        ui.stroke();
        ui.strokeStyle = '#fff';
        ui.lineWidth = 1;
        ui.stroke();
      }
    }, [
      doc,
      view,
      size,
      selected,
      selection,
      group,
      tool,
      crop,
      cropOptions,
      cropOutput,
      guides,
      compare,
      editing,
      hover,
      brushPoint,
      brush.size,
      marquee,
      pathDraft,
      pathHover,
      editingPath,
      nodeIndex,
    ]);

    const position = (event: { clientX: number; clientY: number }): Point => {
      const rect = host.current!.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const imagePoint = (p: Point): Point => ({
      x: (p.x - viewRef.current.x) / viewRef.current.zoom,
      y: (p.y - viewRef.current.y) / viewRef.current.zoom,
    });
    const inside = (p: Point) =>
      p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height;
    const cropModeAt = (p: Point, q: Point, touch = false): CropMode => {
      const handle = cropHandles(crop).find(
        (item) =>
          distance(screen(item.point, viewRef.current), p) <= (touch ? 22 : 11)
      );
      return (
        handle?.handle ??
        (q.x >= crop.x &&
        q.y >= crop.y &&
        q.x <= crop.x + crop.width &&
        q.y <= crop.y + crop.height
          ? 'move'
          : 'new')
      );
    };
    const selectedHandle = (p: Point, touch = false) => {
      const layer =
        group ??
        doc.layers.find(
          (item) => item.id === selected && !item.locked && !item.hidden
        );
      if (!layer || tool === 'draw' || editingPath === layer.id) return null;
      if (layer.kind === 'line' || layer.kind === 'arrow') {
        const endpoint = lineEndpoints(layer).findIndex(
          (point) =>
            distance(screen(point, viewRef.current), p) <= (touch ? 22 : 11)
        );
        return endpoint < 0
          ? null
          : {
              layer,
              type: 'endpoint' as const,
              corner: endpoint,
              cursor: 'crosshair',
              ids: group ? selection : undefined,
            };
      }
      const corners = layerCorners(layer).map((point) =>
          screen(point, viewRef.current)
        ),
        corner = corners.findIndex(
          (point) => distance(point, p) <= (touch ? 22 : 10)
        );
      if (corner >= 0)
        return {
          layer,
          type: 'resize' as const,
          corner,
          cursor: resizeCursor(corners, corner),
          ids: group ? selection : undefined,
        };
      if (layer.kind === 'text') {
        const side = [
          midpoint(corners[0], corners[3]),
          midpoint(corners[1], corners[2]),
        ].findIndex((point) => distance(point, p) <= (touch ? 22 : 10));
        if (side >= 0)
          return {
            layer,
            type: 'resize' as const,
            corner: side + 4,
            cursor: 'ew-resize',
            ids: undefined,
          };
      }
      if (distance(rotationHandle(corners), p) <= (touch ? 22 : 12))
        return {
          layer,
          type: 'rotate' as const,
          corner: -1,
          cursor: 'grab',
          ids: group ? selection : undefined,
        };
      return null;
    };
    const pathHandle = (p: Point, touch = false) => {
      const layer = doc.layers.find(
        (item) =>
          item.id === editingPath &&
          item.pathEditable &&
          !item.locked &&
          !item.hidden
      );
      if (!layer) return null;
      const index = pathNodes(layer).findIndex(
        (point) =>
          distance(screen(point, viewRef.current), p) <= (touch ? 22 : 10)
      );
      if (index >= 0)
        return { layer, index, insert: false, point: pathNodes(layer)[index] };
      const segment = pathSegments(layer).find(
        (item) =>
          distance(screen(item.point, viewRef.current), p) <= (touch ? 16 : 8)
      );
      return segment
        ? { layer, index: segment.index, insert: true, point: segment.point }
        : null;
    };
    const addPathPoint = (point: Point, shift: boolean, touch: boolean) => {
      const draft = pathDraftRef.current;
      if (draft) {
        const threshold = (touch ? 22 : 10) / viewRef.current.zoom;
        if (
          draft.points.length >= 3 &&
          distance(point, draft.points[0]) <= threshold
        ) {
          finishPath(true);
          return;
        }
        if (
          draft.points.length >= 2 &&
          distance(point, draft.points[draft.points.length - 1]) <= threshold
        ) {
          finishPath();
          return;
        }
        const next = shift
          ? snapPathPoint(draft.points[draft.points.length - 1], point)
          : point;
        if (
          distance(next, draft.points[draft.points.length - 1]) <
          1 / viewRef.current.zoom
        )
          return;
        previewPath({ ...draft, points: [...draft.points, next] });
      } else {
        setEditingPath(null);
        setNodeIndex(null);
        engine.select(null);
        engine.begin();
        previewPath({
          base: doc,
          id: crypto.randomUUID(),
          points: [point],
          style: {
            color: brush.color,
            strokeWidth: Math.max(2, doc.width / 200),
            fill: 'transparent',
            opacity: brush.opacity ?? 1,
            pathClosed: false,
          },
        });
      }
      setPathHover(null);
    };
    const stroke = (g: Extract<Gesture, { type: 'draw' }>) =>
      pathLayer(g.points, {
        id: g.id,
        color: brush.color,
        strokeWidth: brush.size,
        opacity:
          (brush.opacity ?? 1) * (brush.mode === 'highlighter' ? 0.35 : 1),
        erase: brush.mode === 'eraser',
      });
    const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if ((event.button !== 0 && event.button !== 1) || compare) return;
      event.preventDefault();
      finishText();
      host.current?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const p = position(event),
        q = imagePoint(p);
      pointers.current.set(event.pointerId, p);
      if (pointers.current.size === 2) {
        const previous = gesture.current;
        if (previous?.type === 'crop') {
          onCrop(previous.rect);
          engine.preview(previous.base);
        }
        if (
          tool === 'crop' &&
          cropOptions.interactionFocus === 'image' &&
          !space.current
        ) {
          const base = engine.getSnapshot().document;
          if (!base) return;
          const [a, b] = [...pointers.current.values()];
          gesture.current = {
            type: 'crop-pinch',
            base,
            rollback:
              previous?.type === 'crop-image' || previous?.type === 'crop-pinch'
                ? previous.rollback
                : previous?.type === 'crop'
                  ? previous.base
                  : base,
            center: imagePoint(midpoint(a, b)),
            distance: Math.max(1, distance(a, b)),
            rect: previous?.type === 'crop' ? previous.rect : crop,
          };
          setCursor('grabbing');
          return;
        }
        if (gesture.current?.type === 'marquee')
          engine.selectMany(gesture.current.ids);
        pathDraftRef.current = null;
        setPathDraft(null);
        setPathHover(null);
        setMarquee(null);
        if (tool !== 'crop') engine.cancel();
        setGuides([]);
        const [a, b] = [...pointers.current.values()];
        gesture.current = {
          type: 'pinch',
          view: viewRef.current,
          center: midpoint(a, b),
          distance: Math.max(1, distance(a, b)),
        };
        setCursor('grabbing');
        return;
      }
      if (pointers.current.size > 2) return;
      if (space.current || event.button === 1) {
        gesture.current = { type: 'pan', start: p, view: viewRef.current };
        setCursor('grabbing');
        return;
      }
      if (tool === 'crop') {
        const mode = cropModeAt(p, q, event.pointerType === 'touch');
        const base = engine.getSnapshot().document ?? doc;
        if (
          cropOptions.interactionFocus === 'image' &&
          (mode === 'move' || mode === 'new')
        ) {
          gesture.current = {
            type: 'crop-image',
            base,
            rollback: base,
            start: q,
            rect: crop,
          };
          setCursor('grabbing');
        } else {
          gesture.current = { type: 'crop', base, start: q, rect: crop, mode };
          setCursor(cropCursor(mode));
        }
        return;
      }
      if (pathDraftRef.current) {
        addPathPoint(q, event.shiftKey, event.pointerType === 'touch');
        gesture.current = { type: 'path-tap' };
        return;
      }
      const node = pathHandle(p, event.pointerType === 'touch');
      if (node) {
        engine.begin();
        let layer = node.layer;
        if (node.insert) {
          const points = [...(layer.points ?? [])];
          points.splice(
            node.index,
            0,
            transform(inverse(layer.matrix), node.point)
          );
          layer = withPathPoints(layer, points);
          engine.preview(updateLayer(doc, layer.id, layer));
        }
        setNodeIndex(node.index);
        gesture.current = {
          type: 'node',
          base: doc,
          layer,
          start: q,
          corner: node.index,
        };
        setCursor('move');
        return;
      }
      const handle = selectedHandle(p, event.pointerType === 'touch');
      if (handle) {
        engine.begin();
        gesture.current = {
          type: handle.type,
          base: doc,
          layer: handle.layer,
          start: q,
          corner: handle.corner,
          ids: handle.ids,
        };
        setCursor(handle.type === 'rotate' ? 'grabbing' : handle.cursor);
        return;
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
      const hit = hitDocument(
        doc,
        q,
        (event.pointerType === 'touch' ? 10 : 5) / viewRef.current.zoom
      );
      if (hit && !hit.locked) {
        let ids = selection;
        if (event.shiftKey) {
          engine.toggleSelection(hit.id);
          ids = engine.getSnapshot().selectedIds;
          if (!ids.includes(hit.id)) return;
        } else if (!ids.includes(hit.id)) {
          engine.select(hit.id);
          ids = [hit.id];
        }
        const frame = ids.length > 1 ? selectionFrame(doc, ids) : null;
        engine.begin();
        gesture.current = {
          type: 'move',
          base: doc,
          layer: frame ?? hit,
          start: q,
          corner: 0,
          ids: frame ? ids : undefined,
        };
        setCursor('move');
      } else if (tool === 'shapes' && shape === 'path' && inside(q)) {
        addPathPoint(q, event.shiftKey, event.pointerType === 'touch');
        gesture.current = { type: 'path-tap' };
        setCursor('crosshair');
      } else if (
        inside(q) &&
        ((tool === 'shapes' && shape) || tool === 'redact')
      ) {
        engine.select(null);
        const kind = tool === 'redact' ? 'redaction' : shape!;
        const layer: Layer = {
          id: crypto.randomUUID(),
          kind,
          matrix: translate(q.x, q.y),
          width: 1,
          height: 1,
          color: brush.color,
          fill: kind === 'redaction' ? '#111827' : 'transparent',
          strokeWidth: kind === 'redaction' ? 0 : Math.max(2, doc.width / 200),
          opacity: 1,
          ...(kind === 'redaction'
            ? {
                redactionMode: redaction?.mode ?? 'pixelate',
                redactionSize: redaction?.size ?? 16,
              }
            : {}),
          ...(kind === 'arrow' ? { arrowEnd: 'arrow' as const } : {}),
        };
        engine.begin();
        gesture.current = { type: 'create', base: doc, start: q, layer };
        setCursor('crosshair');
      } else if (tool === 'select' && !event.altKey) {
        if (
          group &&
          !event.shiftKey &&
          q.x >= group.matrix[4] &&
          q.y >= group.matrix[5] &&
          q.x <= group.matrix[4] + group.width &&
          q.y <= group.matrix[5] + group.height
        ) {
          engine.begin();
          gesture.current = {
            type: 'move',
            base: doc,
            layer: group,
            start: q,
            corner: 0,
            ids: selection,
          };
          setCursor('move');
        } else {
          gesture.current = {
            type: 'marquee',
            start: q,
            ids: selection,
            additive: event.shiftKey,
          };
          if (!event.shiftKey) engine.select(null);
          setMarquee({ ...q, width: 0, height: 0 });
          setCursor('crosshair');
        }
      } else {
        engine.select(null);
        gesture.current = { type: 'pan', start: p, view: viewRef.current };
        setCursor('grabbing');
      }
    };
    const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const p = position(event),
        q = imagePoint(p),
        g = gesture.current;
      if (pathDraftRef.current) {
        const points = pathDraftRef.current.points;
        setPathHover(
          event.shiftKey ? snapPathPoint(points[points.length - 1], q) : q
        );
        setCursor('crosshair');
        if (!g || g.type === 'path-tap') {
          if (pointers.current.has(event.pointerId))
            pointers.current.set(event.pointerId, p);
          return;
        }
      }
      if (tool === 'draw' && event.pointerType !== 'touch') setBrushPoint(p);
      if (!g || !pointers.current.has(event.pointerId)) {
        if (compare) return;
        if (space.current) setCursor('grab');
        else if (tool === 'crop') {
          const mode = cropModeAt(p, q);
          setCursor(
            cropOptions.interactionFocus === 'image' &&
              (mode === 'move' || mode === 'new')
              ? 'grab'
              : cropCursor(mode)
          );
        } else if (tool === 'draw') setCursor('crosshair');
        else {
          const handle = selectedHandle(p),
            node = pathHandle(p),
            hit = hitDocument(doc, q, 5 / viewRef.current.zoom);
          setHover(hit?.id ?? null);
          setCursor(
            (node ? (node.insert ? 'copy' : 'move') : handle?.cursor) ??
              (hit
                ? hit.locked
                  ? 'default'
                  : 'move'
                : tool === 'shapes' || tool === 'redact'
                  ? 'crosshair'
                  : 'grab')
          );
        }
        return;
      }
      pointers.current.set(event.pointerId, p);
      if (g.type === 'path-tap') return;
      if (g.type === 'crop-image') {
        previewCropImage(
          g.base,
          multiply(
            translate(q.x - g.start.x, q.y - g.start.y),
            g.base.imageMatrix
          ),
          g.rect,
          cropOptions
        );
        return;
      }
      if (g.type === 'crop-pinch') {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()],
          center = imagePoint(midpoint(a, b));
        const factor =
          cropOptions.enableZoom === false
            ? 1
            : Math.max(0.01, Math.min(100, distance(a, b) / g.distance));
        const delta = multiply(
          translate(center.x, center.y),
          multiply(scale(factor), translate(-g.center.x, -g.center.y))
        );
        previewCropImage(
          g.base,
          multiply(delta, g.base.imageMatrix),
          g.rect,
          cropOptions
        );
        return;
      }
      if (g.type === 'marquee') {
        const rect = rectFromPoints(g.start, q),
          ids = marqueeLayers(doc, rect);
        setMarquee(rect);
        engine.selectMany(g.additive ? [...new Set([...g.ids, ...ids])] : ids);
        return;
      }
      if (g.type === 'pinch') {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()],
          mid = midpoint(a, b),
          next = zoomAt(
            g.view,
            (g.view.zoom * distance(a, b)) / g.distance,
            g.center
          );
        updateView({
          ...next,
          x: next.x + mid.x - g.center.x,
          y: next.y + mid.y - g.center.y,
        });
        return;
      }
      if (g.type === 'pan') {
        updateView({
          ...g.view,
          x: g.view.x + p.x - g.start.x,
          y: g.view.y + p.y - g.start.y,
        });
        return;
      }
      if (g.type === 'draw') {
        const coalesced = event.nativeEvent.getCoalescedEvents?.(),
          samples = coalesced?.length ? coalesced : [event.nativeEvent];
        for (const sample of samples) {
          const point = imagePoint(position(sample));
          if (
            distance(point, g.points[g.points.length - 1]) >
            0.75 / viewRef.current.zoom
          )
            g.points.push(point);
        }
        if (g.points.length > 40000)
          g.points = g.points.filter(
            (_, i) => i % 2 === 0 || i === g.points.length - 1
          );
        engine.preview({ ...g.base, layers: [...g.base.layers, stroke(g)] });
        return;
      }
      if (g.type === 'create') {
        let dx = q.x - g.start.x,
          dy = q.y - g.start.y;
        if (event.shiftKey) {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          dx = (dx < 0 ? -1 : 1) * side;
          dy = (dy < 0 ? -1 : 1) * side;
        }
        if (Math.hypot(dx, dy) < 3 / viewRef.current.zoom) return;
        const line = g.layer.kind === 'line' || g.layer.kind === 'arrow';
        const layer = {
          ...g.layer,
          width: Math.max(1, Math.abs(dx)),
          height: Math.max(1, Math.abs(dy)),
          matrix: line
            ? ([
                dx < 0 ? -1 : 1,
                0,
                0,
                dy < 0 ? -1 : 1,
                g.start.x,
                g.start.y,
              ] as const)
            : translate(
                Math.min(g.start.x, g.start.x + dx),
                Math.min(g.start.y, g.start.y + dy)
              ),
        };
        engine.preview({ ...g.base, layers: [...g.base.layers, layer] });
        return;
      }
      if (g.type === 'crop') {
        const source = engine.image;
        if (!source) return;
        const ratio =
          cropOptions.aspectRatio ?? (event.shiftKey ? 1 : cropRatio);
        const next = dragCrop(g.rect, g.start, q, g.mode, null, ratio);
        const anchor =
          g.mode === 'move'
            ? undefined
            : {
                x:
                  g.mode === 'new'
                    ? q.x < g.start.x
                      ? 1
                      : 0
                    : g.mode.includes('w')
                      ? 1
                      : g.mode.includes('e')
                        ? 0
                        : 0.5,
                y:
                  g.mode === 'new'
                    ? q.y < g.start.y
                      ? 1
                      : 0
                    : g.mode.includes('n')
                      ? 1
                      : g.mode.includes('s')
                        ? 0
                        : 0.5,
              };
        try {
          onCrop(
            constrainCropRect(
              next,
              {
                width: source.width,
                height: source.height,
                matrix: g.base.imageMatrix,
              },
              cropOptions,
              { aspectRatio: ratio, anchor }
            )
          );
        } catch (error) {
          if (!(error instanceof CropConstraintError)) throw error;
        }
        return;
      }
      if (g.type === 'node') {
        const points = [...(g.layer.points ?? [])];
        let point = q;
        if (event.shiftKey && points.length > 1) {
          const previous =
            points[(g.corner + points.length - 1) % points.length];
          point = snapPathPoint(transform(g.layer.matrix, previous), q);
        }
        points[g.corner] = transform(inverse(g.layer.matrix), point);
        engine.preview(
          updateLayer(g.base, g.layer.id, withPathPoints(g.layer, points))
        );
        return;
      }
      let next = g.layer;
      if (g.type === 'move') {
        let delta = { x: q.x - g.start.x, y: q.y - g.start.y };
        const axis = event.shiftKey
          ? Math.abs(delta.x) >= Math.abs(delta.y)
            ? 'x'
            : 'y'
          : undefined;
        if (axis === 'x') delta.y = 0;
        if (axis === 'y') delta.x = 0;
        const snapped =
          snap && !event.altKey
            ? snapMove(
                g.base,
                g.layer,
                delta,
                5 / viewRef.current.zoom,
                axis,
                g.ids
              )
            : { delta, guides: [] };
        delta = snapped.delta;
        setGuides(snapped.guides);
        next = {
          ...g.layer,
          matrix: multiply(translate(delta.x, delta.y), g.layer.matrix),
        };
      }
      if (g.type === 'resize')
        next =
          g.layer.kind === 'text'
            ? resizeTextBox(g.layer, g.corner, q, fitTextLayer)
            : resizeLayer(
                g.layer,
                g.corner,
                q,
                event.shiftKey || g.layer.kind === 'image'
              );
      if (g.type === 'endpoint')
        next = moveLineEndpoint(g.layer, g.corner, q, event.shiftKey);
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
        const original =
          (Math.atan2(g.layer.matrix[1], g.layer.matrix[0]) * 180) / Math.PI;
        if (event.shiftKey)
          angle = Math.round((original + angle) / 15) * 15 - original;
        else if (snap && !event.altKey) {
          const aligned = Math.round((original + angle) / 90) * 90;
          if (Math.abs(aligned - original - angle) < 3)
            angle = aligned - original;
        }
        next = rotateLayer(g.layer, angle);
      }
      engine.preview(
        g.ids
          ? transformLayers(
              g.base,
              g.ids,
              multiply(next.matrix, inverse(g.layer.matrix))
            )
          : updateLayer(g.base, g.layer.id, next)
      );
    };
    const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      const g = gesture.current;
      if (g?.type === 'draw' && g.points.length === 1)
        engine.preview({ ...g.base, layers: [...g.base.layers, stroke(g)] });
      if (
        g &&
        ![
          'pan',
          'pinch',
          'crop',
          'crop-image',
          'crop-pinch',
          'marquee',
          'path-tap',
        ].includes(g.type)
      )
        engine.end();
      if (
        g?.type === 'create' &&
        engine
          .getSnapshot()
          .document?.layers.some((layer) => layer.id === g.layer.id)
      )
        engine.select(g.layer.id);
      pointers.current.delete(event.pointerId);
      // A remaining finger continues panning after a pinch without drawing an accidental stroke.
      gesture.current =
        g?.type === 'crop-pinch' && pointers.current.size === 1
          ? {
              type: 'crop-image',
              base: engine.getSnapshot().document ?? g.base,
              rollback: g.rollback,
              start: imagePoint([...pointers.current.values()][0]),
              rect: g.rect,
            }
          : g?.type === 'pinch' && pointers.current.size === 1
            ? {
                type: 'pan',
                start: [...pointers.current.values()][0],
                view: viewRef.current,
              }
            : null;
      setGuides([]);
      setMarquee(null);
      setCursor(
        space.current ||
          gesture.current?.type === 'pan' ||
          gesture.current?.type === 'crop-image'
          ? 'grab'
          : tool === 'draw'
            ? 'crosshair'
            : 'default'
      );
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTyping(event.target)) return;
      if (
        (gesture.current || pathDraftRef.current) &&
        (event.ctrlKey || event.metaKey) &&
        ['z', 'y'].includes(event.key.toLowerCase())
      ) {
        cancel();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === ' ') {
        space.current = true;
        setCursor('grab');
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        const active = !!gesture.current || !!pathDraftRef.current;
        cancel();
        if (!active && tool === 'crop') onCropCancel?.();
        else if (!active && editingPath) {
          setEditingPath(null);
          setNodeIndex(null);
        } else if (!active) engine.select(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (compare) return;
      const draft = pathDraftRef.current;
      if (draft && ['Enter', 'Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter')
          finishPath(event.shiftKey && draft.points.length >= 3);
        else if (draft.points.length <= 1) cancel();
        else previewPath({ ...draft, points: draft.points.slice(0, -1) });
        return;
      }
      if (event.key === '0' && !event.ctrlKey && !event.metaKey) {
        fit();
        event.preventDefault();
        return;
      }
      if (event.key === '+' || event.key === '=' || event.key === '-') {
        if (tool === 'crop' && cropOptions.interactionFocus === 'image') {
          zoomCrop(event.key === '-' ? 0.8 : 1.25);
          event.preventDefault();
          return;
        }
        updateView(
          zoomAt(
            viewRef.current,
            viewRef.current.zoom * (event.key === '-' ? 0.8 : 1.25),
            { x: size.width / 2, y: size.height / 2 }
          )
        );
        event.preventDefault();
        return;
      }
      if (tool === 'crop') {
        if (event.key === 'Enter') {
          onCropApply?.();
          event.preventDefault();
        }
        const amount = event.shiftKey ? 10 : 1;
        if (event.key.startsWith('Arrow')) {
          const delta = {
            x:
              event.key === 'ArrowLeft'
                ? -amount
                : event.key === 'ArrowRight'
                  ? amount
                  : 0,
            y:
              event.key === 'ArrowUp'
                ? -amount
                : event.key === 'ArrowDown'
                  ? amount
                  : 0,
          };
          const current = engine.getSnapshot().document,
            source = engine.image;
          if (current && source) {
            if (cropOptions.interactionFocus === 'image')
              previewCropImage(
                current,
                multiply(translate(delta.x, delta.y), current.imageMatrix),
                crop,
                cropOptions
              );
            else {
              try {
                onCrop(
                  constrainCropRect(
                    { ...crop, x: crop.x + delta.x, y: crop.y + delta.y },
                    {
                      width: source.width,
                      height: source.height,
                      matrix: current.imageMatrix,
                    },
                    cropOptions,
                    { aspectRatio: cropRatio }
                  )
                );
              } catch (error) {
                if (!(error instanceof CropConstraintError)) throw error;
              }
            }
          }
          event.preventDefault();
        }
        return;
      }
      const layer = doc.layers.find((item) => item.id === selected),
        command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'a') {
        engine.selectMany(
          doc.layers
            .filter(
              (item) =>
                !item.hidden && !item.locked && !item.erase && item.opacity > 0
            )
            .map((item) => item.id)
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (command && event.key.toLowerCase() === 'd' && layer) {
        const copy = duplicateLayers(doc, selection);
        engine.commit(copy.document);
        engine.selectMany(copy.ids);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingPath && nodeIndex !== null) deletePathPoint();
        else if (!layer?.locked) engine.removeSelected();
        event.preventDefault();
        return;
      }
      if (event.key === '[' || event.key === ']') {
        const i = doc.layers.findIndex((item) => item.id === selected),
          direction = event.key === ']' ? 1 : -1;
        if (command && i >= 0 && !layer?.locked) {
          const layers = [...doc.layers],
            target = event.shiftKey
              ? direction > 0
                ? layers.length - 1
                : 0
              : Math.max(0, Math.min(layers.length - 1, i + direction));
          const [item] = layers.splice(i, 1);
          layers.splice(target, 0, item);
          engine.commit({ ...doc, layers });
        } else
          engine.select(
            doc.layers[(i + direction + doc.layers.length) % doc.layers.length]
              ?.id ?? null
          );
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter' && layer?.kind === 'text') {
        beginText(layer.id);
        event.preventDefault();
        return;
      }
      if (
        event.key === 'Enter' &&
        layer?.kind === 'path' &&
        layer.pathEditable
      ) {
        editPath(layer.id);
        event.preventDefault();
        return;
      }
      if (
        layer &&
        !layer.locked &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        if (!keyboardTransaction.current) {
          engine.begin();
          keyboardTransaction.current = true;
        }
        const amount = event.shiftKey ? 10 : 1;
        const delta = {
          x:
            event.key === 'ArrowLeft'
              ? -amount
              : event.key === 'ArrowRight'
                ? amount
                : 0,
          y:
            event.key === 'ArrowUp'
              ? -amount
              : event.key === 'ArrowDown'
                ? amount
                : 0,
        };
        if (
          editingPath === layer.id &&
          nodeIndex !== null &&
          layer.points?.[nodeIndex]
        ) {
          const points = [...layer.points],
            point = transform(layer.matrix, points[nodeIndex]);
          points[nodeIndex] = transform(inverse(layer.matrix), {
            x: point.x + delta.x,
            y: point.y + delta.y,
          });
          engine.preview(
            updateLayer(doc, layer.id, withPathPoints(layer, points))
          );
          return;
        }
        if (group) {
          const matrix = event.altKey
            ? multiply(
                rotateLayer(
                  group,
                  (event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 1) * (event.shiftKey ? 15 : 1)
                ).matrix,
                inverse(group.matrix)
              )
            : translate(delta.x, delta.y);
          engine.preview(transformLayers(doc, selection, matrix));
          return;
        }
        engine.preview(
          updateLayer(
            doc,
            layer.id,
            event.altKey
              ? rotateLayer(
                  layer,
                  (event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 1) * (event.shiftKey ? 15 : 1)
                )
              : {
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
                }
          )
        );
      }
    };
    const registerTextEditor = useCallback(
      (editor: RichTextInputHandle | null) => {
        textInput.current = editor;
        onTextEditor?.(editor);
      },
      [onTextEditor]
    );
    const editingLayer = doc.layers.find((layer) => layer.id === editing);
    const textProps: RichTextRendererProps | null = editingLayer
      ? {
          editorRef: registerTextEditor,
          context: 'canvas',
          className: 'rie-canvas-text',
          testId: 'native-canvas-text',
          ariaLabel: t('text.content'),
          value: {
            text: textContent(editingLayer),
            runs: editingLayer.textRuns,
          },
          getValue: () => {
            const state = engine.getSnapshot();
            const layer = state.document?.layers.find(
              (item) =>
                item.id === editRef.current && item.id === state.selected
            );
            return layer
              ? { text: textContent(layer), runs: layer.textRuns }
              : null;
          },
          defaults: resolveTextStyle(editingLayer),
          style: {
            position: 'absolute',
            zIndex: 5,
            left: view.x,
            top: view.y,
            transformOrigin: '0 0',
            transform: `matrix(${editingLayer.matrix.map((value) => value * view.zoom).join(',')})`,
            width: Math.max(1, editingLayer.width),
            height: editingLayer.height,
            minHeight:
              editingLayer.textLayout === 'fixed'
                ? 0
                : (editingLayer.fontSize ?? 40) *
                  (editingLayer.lineHeight ?? 1.2),
            padding: 0,
            margin: 0,
            border: 0,
            overflow:
              editingLayer.textLayout === 'fixed' ? 'hidden' : 'visible',
            boxSizing: 'content-box',
            fontSize: editingLayer.fontSize ?? 40,
            fontFamily: editingLayer.fontFamily ?? 'sans-serif',
            fontWeight:
              editingLayer.fontWeight ?? (editingLayer.bold ? 700 : 400),
            fontStyle: editingLayer.italic ? 'italic' : 'normal',
            lineHeight: editingLayer.lineHeight ?? 1.2,
            letterSpacing: editingLayer.letterSpacing ?? 0,
            textAlign: editingLayer.textAlign ?? 'left',
            textDecoration: 'none',
            color: editingLayer.color,
            backgroundColor: editingLayer.fill,
            opacity: editingLayer.opacity,
            whiteSpace:
              !editingLayer.textLayout ||
              editingLayer.textLayout === 'auto-width'
                ? 'pre'
                : 'pre-wrap',
            overflowWrap: 'anywhere',
          },
          onChange: (value) => {
            const current = engine.getSnapshot().document;
            const layer = current?.layers.find(
              (item) => item.id === editRef.current
            );
            if (!current || !layer) return;
            engine.begin();
            engine.preview(
              updateLayer(
                current,
                layer.id,
                fitTextLayer({
                  ...layer,
                  text: value.text,
                  textRuns: value.runs,
                })
              )
            );
          },
          onFocus: () => onTextEditor?.(textInput.current),
          onSelectionChange: onTextSelectionChange,
          onBlur: (event) => {
            const target = event?.relatedTarget;
            if (
              target instanceof HTMLElement &&
              target.closest('[data-rich-text-toolbar]')
            )
              return;
            finishText();
          },
          onCommit: () => {
            finishText();
            host.current?.focus({ preventScroll: true });
          },
          onCancel: () => {
            finishText(true);
            host.current?.focus({ preventScroll: true });
          },
        }
      : null;
    return (
      <div className="rie-canvas-wrap">
        <div
          ref={host}
          className="rie-canvas"
          role="application"
          tabIndex={0}
          aria-label={t('canvas.label')}
          aria-describedby={instructionsId}
          data-drag-over={dragOver || undefined}
          data-zoom={view.zoom.toFixed(4)}
          onKeyDown={keyDown}
          onKeyUp={(event) => {
            if (event.key === ' ') {
              space.current = false;
              setCursor('default');
            }
            if (event.key.startsWith('Arrow') && keyboardTransaction.current) {
              keyboardTransaction.current = false;
              if (tool !== 'crop') engine.end();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              space.current = false;
              if (keyboardTransaction.current) {
                keyboardTransaction.current = false;
                if (tool !== 'crop') engine.end();
              }
            }
          }}
          onDragOver={(event) => {
            if (onImportImage && event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDragOver(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragOver(false);
          }}
          onDrop={(event) => {
            setDragOver(false);
            const file = [...event.dataTransfer.files].find((item) =>
              item.type.startsWith('image/')
            );
            if (file && onImportImage) {
              event.preventDefault();
              finishText();
              onImportImage(file);
            }
          }}
          onPaste={(event) => {
            if (isTyping(event.target)) return;
            const file = [...event.clipboardData.files].find((item) =>
              item.type.startsWith('image/')
            );
            if (file && onImportImage) {
              event.preventDefault();
              onImportImage(file);
            }
          }}
        >
          <div
            className="rie-artboard"
            data-cropping={(tool === 'crop' && !compare) || undefined}
            style={{
              left: view.x,
              top: view.y,
              width: doc.width * view.zoom,
              height: doc.height * view.zoom,
            }}
          />
          {tool === 'crop' && !compare ? (
            <div
              className="rie-crop-artboard"
              style={{
                left: view.x + crop.x * view.zoom,
                top: view.y + crop.y * view.zoom,
                width: crop.width * view.zoom,
                height: crop.height * view.zoom,
              }}
            />
          ) : null}
          <canvas ref={lower} className="lower-canvas" aria-hidden="true" />
          <canvas
            ref={upper}
            className="upper-canvas"
            aria-hidden="true"
            style={{ cursor }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={cancel}
            onLostPointerCapture={(event) => {
              if (pointers.current.has(event.pointerId)) cancel();
            }}
            onPointerLeave={() => {
              setHover(null);
              setBrushPoint(null);
            }}
            onDoubleClick={(event) => {
              if (compare || tool === 'crop' || tool === 'draw') return;
              if (pathDraftRef.current) {
                finishPath();
                return;
              }
              const layer = hitDocument(
                doc,
                imagePoint(position(event)),
                5 / viewRef.current.zoom
              );
              if (layer?.kind === 'text') beginText(layer.id);
              else if (layer?.kind === 'path' && layer.pathEditable)
                editPath(layer.id);
            }}
          />
          {textProps && !compare ? (
            renderTextInput ? (
              renderTextInput(textProps)
            ) : (
              <RichTextInput
                key={editing}
                {...textProps}
                ref={registerTextEditor}
              />
            )
          ) : null}
        </div>
        <span id={instructionsId} className="rie-sr-only">
          {t('canvas.instructions')}
        </span>
      </div>
    );
  }
);
