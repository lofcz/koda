import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CanvasEngine, EngineState } from './engine';
import { CanvasSurface, PathState, SurfaceActions } from './CanvasSurface';
import { alignLayers, distributeLayers, duplicateLayers } from './interactions';
import {
  DEFAULT_EFFECTS,
  DEFAULT_FRAME,
  duplicateLayer,
  Effects,
  flipDocument,
  flipLayer,
  ImageDocument,
  inverse,
  Layer,
  Matrix,
  multiply,
  Rect,
  resizeDocument,
  rotateDocument,
  rotation,
  rotateLayer,
  reorderLayer,
  scale,
  ShapeKind,
  TextStyle,
  translate,
  updateLayer,
} from './model';
import { filterPixels, fitTextLayer, textSize } from './render';
import { resolveTextStyle, textContent } from './textModel';
import {
  applyCrop as applyCropDocument,
  constrainCropRect,
  constrainImageToCrop,
  parseCropOptions,
  transformImage,
} from './crop';
import type { CropOptions, CropPreset } from './crop';
import {
  formatRichText,
  selectedTextStyle,
  type RichTextValue,
  type TextSelection,
  type TextStyleState,
} from './richText';
import {
  RichTextInput,
  type RichTextInputHandle,
  type RichTextInputProps,
  type RichTextRenderer,
} from './RichTextInput';
import { Icon } from './icons';
import { translator } from './locale';
import type { EditorTool, ImageEditorProps } from './types';

function commonValue<T>(values: readonly T[]): T | null {
  return values.length && values.every((value) => Object.is(value, values[0]))
    ? values[0]
    : null;
}
const hasColor = (layer: Layer) =>
  layer.kind !== 'image' &&
  (layer.kind !== 'redaction' || layer.redactionMode === 'solid');
const hasFill = (layer: Layer) =>
  !['line', 'arrow', 'image', 'redaction'].includes(layer.kind) &&
  (layer.kind !== 'path' || !!layer.pathClosed);
const hasStroke = (layer: Layer) =>
  !['text', 'image', 'redaction'].includes(layer.kind);
function colorKey(value: string | null): string | null {
  if (!value) return null;
  const color = value.toLowerCase();
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb)
    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`;
  if (/^#[\da-f]{3}$/.test(color))
    return `#${color
      .slice(1)
      .split('')
      .map((part) => part + part)
      .join('')}`;
  return color;
}

function NumberField({
  label,
  value,
  onCommit,
  testId,
  mixedLabel,
  step = 1,
  onStart,
  onEnd,
  min = 1,
  max = 8192,
}: {
  label: string;
  value: number | null;
  onCommit(value: number): void;
  testId?: string;
  mixedLabel?: string;
  step?: number;
  onStart?(): void;
  onEnd?(): void;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current)
      ref.current.value =
        value === null ? '' : String(Math.round(value * 100) / 100);
  }, [value]);
  return (
    <label className="rie-label">
      <span>{label}</span>
      <input
        ref={ref}
        type="number"
        defaultValue={value === null ? '' : Math.round(value * 100) / 100}
        placeholder={value === null ? mixedLabel : undefined}
        aria-valuetext={value === null ? mixedLabel : undefined}
        data-mixed={value === null || undefined}
        min={min}
        max={max}
        step={step}
        data-testid={testId}
        onFocus={onStart}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (event.target.value && Number.isFinite(n) && n >= min && n <= max)
            onCommit(n);
        }}
        onBlur={(event) => {
          const n = Number(event.currentTarget.value);
          if (
            event.currentTarget.value &&
            Number.isFinite(n) &&
            n >= min &&
            n <= max
          )
            onCommit(n);
          event.currentTarget.value =
            value === null ? '' : String(Math.round(value * 100) / 100);
          onEnd?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
  mixedLabel,
}: {
  label: string;
  value: string | null;
  onChange(value: string): void;
  mixedLabel?: string;
}) {
  return (
    <fieldset className="rie-color-field">
      <legend>
        {label}
        {value === null ? (
          <span className="rie-mixed-label">{mixedLabel}</span>
        ) : null}
      </legend>
      <div className="rie-swatches">
        {[
          '#ffffff',
          '#202a38',
          '#e5484d',
          '#f59e0b',
          '#facc15',
          '#30a46c',
          '#0797a7',
          '#3b82f6',
          '#8b5cf6',
        ].map((color) => (
          <button
            key={color}
            type="button"
            className="rie-swatch"
            style={{ background: color }}
            aria-label={`${label}: ${color}`}
            aria-pressed={colorKey(value) === color}
            onClick={() => onChange(color)}
          />
        ))}
        <input
          aria-label={value === null ? `${label}: ${mixedLabel}` : label}
          type="color"
          value={colorKey(value)?.match(/^#[\da-f]{6}$/)?.[0] ?? '#0797a7'}
          data-mixed={value === null || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  testId,
  onStart,
  onEnd,
  step = 1,
  suffix = '',
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  testId?: string;
  onStart?(): void;
  onEnd?(): void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="rie-label">
      <span>
        {label}
        <output>
          {Math.round(value * 100) / 100}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onBlur={onEnd}
        onKeyDown={(event) => {
          if (
            event.key.startsWith('Arrow') ||
            ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
          )
            onStart?.();
        }}
        onKeyUp={onEnd}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
function ChoicePicker({
  label,
  value,
  choices,
  onChange,
  t,
  testId,
}: {
  label: string;
  value: string | null;
  choices: readonly { value: string; label: string; group?: string }[];
  onChange(value: string): void;
  t(key: string): string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null),
    id = useId();
  const filtered = choices.filter((item) =>
    `${item.group ?? ''} ${item.label}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="rie-picker rie-label"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          const items = [
              ...(root.current?.querySelectorAll<HTMLButtonElement>(
                '[role="option"]'
              ) ?? []),
            ],
            index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={trigger}
        data-testid={testId}
        className="rie-picker-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => {
          setQuery('');
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {value === null
            ? t('selection.mixed')
            : (choices.find((item) => item.value === value)?.label ?? value)}
        </span>
        <Icon name="chevron_down" />
      </button>
      {open ? (
        <div className="rie-picker-popup">
          <input
            ref={search}
            value={query}
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div id={`${id}-list`} role="listbox" aria-label={label}>
            {filtered.map((item, index) => (
              <React.Fragment key={item.value}>
                {item.group && item.group !== filtered[index - 1]?.group ? (
                  <div className="rie-picker-group" role="presentation">
                    {item.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={item.value === value}
                  key={item.value}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  {item.label}
                  {item.value === value ? <Icon name="check" /> : null}
                </button>
              </React.Fragment>
            ))}
            {!filtered.length ? (
              <p className="rie-help">{t('picker.empty')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function FilterPreview({
  engine,
  preset,
  revision,
}: {
  engine: CanvasEngine;
  preset: Effects['preset'];
  revision: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current,
      image = engine.image;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const factor = Math.max(
      canvas.width / image.width,
      canvas.height / image.height
    );
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image.source,
      (canvas.width - image.width * factor) / 2,
      (canvas.height - image.height * factor) / 2,
      image.width * factor,
      image.height * factor
    );
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    filterPixels(pixels.data, { ...DEFAULT_EFFECTS, preset });
    ctx.putImageData(pixels, 0, 0);
  }, [engine, preset, revision]);
  return <canvas ref={ref} width={144} height={96} aria-hidden="true" />;
}
const toolNames: EditorTool[] = [
  'select',
  'crop',
  'adjust',
  'filter',
  'draw',
  'text',
  'shapes',
  'stickers',
  'redact',
  'frame',
  'fill',
  'resize',
];

export function EditorUI({
  engine,
  state,
  onSave,
  onCancel,
  onError,
  renderTextInput,
}: {
  engine: CanvasEngine;
  state: EngineState;
  onSave: ImageEditorProps['onSave'];
  onCancel: ImageEditorProps['onCancel'];
  onError: ImageEditorProps['onError'];
  renderTextInput?: RichTextRenderer;
}) {
  const doc = state.document,
    t = translator(state.options),
    shell = useRef<HTMLDivElement>(null),
    nav = useRef<HTMLElement>(null),
    surface = useRef<SurfaceActions>(null),
    textField = useRef<RichTextInputHandle>(null),
    canvasTextEditor = useRef<RichTextInputHandle | null>(null),
    activeTextEditor = useRef<{
      id: string;
      handle: RichTextInputHandle;
    } | null>(null),
    uploadField = useRef<HTMLInputElement>(null),
    straightening = useRef<ImageDocument | null>(null),
    straightenStartAngle = useRef(0);
  const [tool, setTool] = useState<EditorTool>('select'),
    [panel, setPanel] = useState(false),
    [locked, setLocked] = useState(true);
  const [overflow, setOverflow] = useState({
    before: false,
    after: false,
    horizontal: false,
  });
  const measureNav = () => {
    const element = nav.current;
    if (!element) return;
    const horizontal = element.scrollWidth > element.clientWidth + 2;
    const before = horizontal ? element.scrollLeft > 2 : element.scrollTop > 2;
    const after = horizontal
      ? element.scrollLeft + element.clientWidth < element.scrollWidth - 2
      : element.scrollTop + element.clientHeight < element.scrollHeight - 2;
    setOverflow((previous) =>
      previous.before === before &&
      previous.after === after &&
      previous.horizontal === horizontal
        ? previous
        : { before, after, horizontal }
    );
  };
  useEffect(() => {
    if (!nav.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureNav);
    observer.observe(nav.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = nav.current,
        button = element?.querySelector<HTMLButtonElement>(
          '[aria-pressed="true"]'
        );
      if (!element || !button) return;
      const parent = element.getBoundingClientRect(),
        child = button.getBoundingClientRect();
      if (element.scrollWidth > element.clientWidth + 2) {
        if (child.left < parent.left + 26)
          element.scrollBy({ left: child.left - parent.left - 26 });
        if (child.right > parent.right - 26)
          element.scrollBy({ left: child.right - parent.right + 26 });
      } else {
        if (child.top < parent.top + 26)
          element.scrollBy({ top: child.top - parent.top - 26 });
        if (child.bottom > parent.bottom - 26)
          element.scrollBy({ top: child.bottom - parent.bottom + 26 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [tool]);
  const [compare, setCompare] = useState(false),
    [view, setView] = useState({ zoom: 1, fitted: true }),
    [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [adding, setAdding] = useState(false),
    [angle, setAngle] = useState(0),
    [shape, setShape] = useState<ShapeKind | 'path' | null>(null),
    [pathState, setPathState] = useState<PathState>({
      drawing: false,
      editing: false,
      canFinish: false,
      canClose: false,
      canRemovePoint: false,
    }),
    [multiSelect, setMultiSelect] = useState(false),
    [redaction, setRedaction] = useState<{
      mode: 'pixelate' | 'blur' | 'solid';
      size: number;
    }>({ mode: 'pixelate', size: 14 });
  useEffect(() => {
    const element = shell.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      element.style.setProperty(
        '--rie-options-max-height',
        `${Math.max(56, Math.min(220, entry.contentRect.height * 0.3))}px`
      );
      element.dataset.short = String(entry.contentRect.height < 420);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const [crop, updateCrop] = useState<Rect>({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }),
    [ratio, updateRatio] = useState<number | null>(null);
  const ratioRef = useRef(ratio);
  const setRatio = useCallback((next: number | null) => {
    ratioRef.current = next;
    updateRatio(next);
  }, []);
  const cropRect = useRef(crop);
  const cropSession = useRef<{
    imageRevision: number;
    output?: { width: number; height: number };
  } | null>(null);
  const [cropOverrides, setCropOverrides] = useState<Partial<CropOptions>>({});
  const [cropPreset, setCropPreset] = useState('free');
  const [cropOutput, setCropOutput] = useState<
    { width: number; height: number } | undefined
  >();
  const cropOptions = parseCropOptions({
    ...state.options.crop,
    ...cropOverrides,
  });
  const setCrop = useCallback((next: Rect) => {
    cropRect.current = next;
    updateCrop(next);
  }, []);
  const cropConfigKey = JSON.stringify(state.options.crop);
  useLayoutEffect(() => {
    let previous = JSON.stringify(engine.getSnapshot().options.crop);
    return engine.subscribe(() => {
      const key = JSON.stringify(engine.getSnapshot().options.crop);
      if (key === previous) return;
      previous = key;
      if (!cropSession.current) return;
      surface.current?.finishCropGesture();
      const current = engine.getSnapshot(),
        image = engine.image;
      if (!current.document || !image) return;
      const options = parseCropOptions(current.options.crop);
      try {
        const nextRatio = options.aspectRatio ?? ratioRef.current;
        const next = constrainCropRect(
          cropRect.current,
          {
            width: image.width,
            height: image.height,
            matrix: current.document.imageMatrix,
          },
          options.interactionFocus === 'image'
            ? { ...options, allowOutsideImage: true }
            : options,
          { aspectRatio: nextRatio }
        );
        if (
          options.interactionFocus === 'image' &&
          !options.allowOutsideImage
        ) {
          const covered = constrainImageToCrop(
            current.document.imageMatrix,
            image,
            next
          );
          if (covered !== current.document.imageMatrix)
            engine.preview(
              transformImage(
                current.document,
                multiply(covered, inverse(current.document.imageMatrix))
              )
            );
        }
        setCropOverrides({});
        setRatio(nextRatio);
        setCrop(next);
        if (
          options.aspectRatio &&
          cropSession.current.output &&
          Math.abs(
            cropSession.current.output.width /
              cropSession.current.output.height -
              options.aspectRatio
          ) > 1e-9
        ) {
          cropSession.current.output = undefined;
          setCropOutput(undefined);
        }
        setError('');
      } catch {
        setError(translator(current.options)('crop.constraints_error'));
      }
    });
  }, [engine, setCrop, setRatio]);
  useLayoutEffect(() => {
    const invalidate = () => {
      if (!cropSession.current) return;
      cropSession.current = null;
      straightening.current = null;
      setAngle(0);
      setTool('select');
      setPanel(false);
    };
    const committed = engine.subscribeChanges(invalidate);
    const source = engine.subscribe(() => {
      if (
        cropSession.current &&
        (!engine.inTransaction ||
          engine.getSnapshot().imageRevision !==
            cropSession.current.imageRevision)
      )
        invalidate();
    });
    return () => {
      committed();
      source();
    };
  }, [engine]);
  const [brush, setBrush] = useState<{
    color: string;
    size: number;
    mode: 'brush' | 'highlighter' | 'eraser';
    opacity: number;
  }>({ color: '#e5484d', size: 8, mode: 'brush', opacity: 1 });
  const [textSession, setTextSession] = useState<{
    id: string;
    selection: TextSelection;
    marks: TextStyleState;
  } | null>(null);
  const onTextEditor = useCallback(
    (handle: RichTextInputHandle | null) => {
      const id = engine.getSnapshot().selected;
      if (handle && id) {
        canvasTextEditor.current = handle;
        activeTextEditor.current = { id, handle };
      } else {
        if (activeTextEditor.current?.handle === canvasTextEditor.current) {
          activeTextEditor.current = null;
          setTextSession(null);
        }
        canvasTextEditor.current = null;
      }
    },
    [engine]
  );
  const onTextSelection = useCallback(
    (selection: TextSelection, marks: TextStyleState) => {
      const id = engine.getSnapshot().selected;
      if (id)
        setTextSession((previous) =>
          previous?.id === id &&
          previous.selection.anchor === selection.anchor &&
          previous.selection.focus === selection.focus &&
          JSON.stringify(previous.marks) === JSON.stringify(marks)
            ? previous
            : { id, selection, marks }
        );
    },
    [engine]
  );
  const onPanelTextFocus = useCallback(() => {
    surface.current?.finishText();
    engine.begin();
    const id = engine.getSnapshot().selected;
    if (id && textField.current)
      activeTextEditor.current = { id, handle: textField.current };
  }, [engine]);
  const onPanelTextBlur = useCallback(
    (event?: { relatedTarget: EventTarget | null }) => {
      if (
        event?.relatedTarget instanceof Element &&
        event.relatedTarget.closest('[data-rich-text-toolbar]')
      )
        return;
      engine.end();
      activeTextEditor.current = null;
      setTextSession(null);
    },
    [engine]
  );
  const cancelPanelText = useCallback(() => {
    engine.cancel();
    activeTextEditor.current = null;
    setTextSession(null);
  }, [engine]);
  const disabled = state.phase !== 'ready' || saving;
  useLayoutEffect(() => {
    if (tool === 'shapes' && (shape === 'path' || pathState.editing))
      shell.current
        ?.querySelector('.rie-options-content')
        ?.scrollTo({ top: 0 });
  }, [tool, shape, pathState.drawing, pathState.editing]);
  const layer = doc?.layers.find((item) => item.id === state.selected);
  const selectedIds = state.selectedIds;
  const selectedLayers =
    doc?.layers.filter((item) => selectedIds.includes(item.id)) ?? [];
  const isGroup = selectedLayers.length > 1;
  const textLayers = selectedLayers.filter((item) => item.kind === 'text');
  const textValue = (item: Layer): RichTextValue => ({
    text: textContent(item),
    runs: item.textRuns,
  });
  const textMarks: TextStyleState = {};
  const inlineStyles = textLayers.map((item) => {
    if (textLayers.length === 1 && !isGroup && textSession?.id === item.id) {
      return textSession.selection.anchor === textSession.selection.focus
        ? textSession.marks
        : selectedTextStyle(
            textValue(item),
            textSession.selection,
            resolveTextStyle(item)
          );
    }
    return selectedTextStyle(
      textValue(item),
      { anchor: 0, focus: textContent(item).length },
      resolveTextStyle(item)
    );
  });
  for (const key of [
    'fontSize',
    'fontFamily',
    'fontWeight',
    'italic',
    'underline',
    'strike',
    'color',
    'background',
    'letterSpacing',
  ] as const)
    Object.assign(textMarks, {
      [key]: commonValue(inlineStyles.map((style) => style[key])),
    });
  const cropSource = (current: ImageDocument) => ({
    width: engine.image?.width ?? current.width,
    height: engine.image?.height ?? current.height,
    matrix: current.imageMatrix,
  });
  const changeCrop = (
    next: Rect,
    axis?: 'width' | 'height',
    nextRatio = ratio
  ) => {
    const current = engine.getSnapshot().document;
    if (!current || !cropSession.current) return;
    try {
      setCrop(
        constrainCropRect(next, cropSource(current), cropOptions, {
          aspectRatio: nextRatio,
          axis,
        })
      );
      setError('');
      return true;
    } catch {
      setError(t('crop.constraints_error'));
      return false;
    }
  };
  const applyCrop = (propagateError = false) => {
    const snapshot = engine.getSnapshot(),
      current = snapshot.document;
    if (!current || !cropSession.current) return current;
    surface.current?.finishCropGesture();
    const session = cropSession.current;
    const options = parseCropOptions({
      ...snapshot.options.crop,
      ...(JSON.stringify(snapshot.options.crop) === cropConfigKey
        ? cropOverrides
        : {}),
    });
    let next: ImageDocument;
    try {
      next = applyCropDocument(
        current,
        cropRect.current,
        cropSource(current),
        options,
        { aspectRatio: ratioRef.current }
      );
    } catch (cause) {
      setError(t('crop.constraints_error'));
      if (propagateError) throw cause;
      return null;
    }
    cropSession.current = null;
    straightening.current = null;
    if (
      session.output &&
      (!options.aspectRatio ||
        Math.abs(
          session.output.width / session.output.height - options.aspectRatio
        ) < 1e-9)
    )
      engine.updateOptions({
        export: {
          ...engine.getSnapshot().options.export,
          ...session.output,
          fit: 'force',
        },
      });
    engine.commit(next);
    setAngle(0);
    setTool('select');
    setPanel(false);
    return next;
  };
  useLayoutEffect(() =>
    engine.beforeExport(
      doc
        ? () => {
            activeTextEditor.current?.handle.flush();
            surface.current?.flushText();
            if (pathState.drawing) surface.current?.finishPath();
            if (cropSession.current) applyCrop(true);
          }
        : null
    )
  );
  const choose = (next: EditorTool) => {
    if (disabled) return;
    const current = tool === 'crop' ? applyCrop() : doc;
    if (!current) return;
    if (next === 'crop' && current) {
      const options = parseCropOptions(state.options.crop);
      const nextRatio = options.aspectRatio ?? null;
      let nextCrop: Rect,
        nextDocument = current;
      try {
        nextCrop = constrainCropRect(
          { x: 0, y: 0, width: current.width, height: current.height },
          cropSource(current),
          options.interactionFocus === 'image'
            ? { ...options, allowOutsideImage: true }
            : options,
          { aspectRatio: nextRatio }
        );
        if (
          options.interactionFocus === 'image' &&
          !options.allowOutsideImage
        ) {
          const covered = constrainImageToCrop(
            current.imageMatrix,
            cropSource(current),
            nextCrop
          );
          if (covered !== current.imageMatrix)
            nextDocument = transformImage(
              current,
              multiply(covered, inverse(current.imageMatrix))
            );
        }
      } catch {
        setError(t('crop.constraints_error'));
        return;
      }
      surface.current?.finishText();
      engine.begin();
      cropSession.current = {
        imageRevision: engine.getSnapshot().imageRevision,
      };
      if (nextDocument !== current) engine.preview(nextDocument);
      setCropOverrides({});
      setCropOutput(undefined);
      setCrop(nextCrop);
      setRatio(nextRatio);
      setCropPreset(nextRatio ? 'custom' : 'free');
      setAngle(0);
    }
    setTool(next);
    setPanel(next !== 'select');
    setCompare(false);
    setError('');
  };
  const closePanel = () => {
    if (tool === 'crop' && !applyCrop()) return;
    if (tool === 'select') engine.select(null);
    setTool('select');
    setPanel(false);
  };
  const iconButton = (
    name: string,
    key: string,
    action: () => void,
    isDisabled = false,
    testId?: string
  ) => (
    <button
      type="button"
      className="rie-icon-button"
      aria-label={t(key)}
      title={t(key)}
      disabled={disabled || isDisabled}
      onClick={action}
      data-testid={testId}
    >
      <Icon name={name} />
    </button>
  );
  const changeLayer = (patch: Partial<Layer>) => {
    if (doc && layer) engine.commit(updateLayer(doc, layer.id, patch));
  };
  const previewLayer = (patch: Partial<Layer>) => {
    if (doc && layer) engine.preview(updateLayer(doc, layer.id, patch));
  };
  const changeSelection = (
    patch: Partial<Layer>,
    preview = false,
    accepts: (item: Layer) => boolean = () => true
  ) => {
    if (!doc) return;
    const next = selectedLayers
      .filter(accepts)
      .map((item) => item.id)
      .reduce((document, id) => {
        const item = document.layers.find((item) => item.id === id)!;
        if (item.kind === 'text' && patch.color !== undefined) {
          const value = formatRichText(
            textValue(item),
            { anchor: 0, focus: textContent(item).length },
            { color: patch.color }
          );
          return updateLayer(
            document,
            id,
            fitTextLayer({
              ...item,
              ...patch,
              text: value.text,
              textRuns: value.runs,
            })
          );
        }
        return updateLayer(document, id, patch);
      }, doc);
    if (preview) {
      engine.begin();
      engine.preview(next);
    } else engine.commit(next);
  };
  const gesture = { onStart: () => engine.begin(), onEnd: () => engine.end() };
  const addShape = (kind: ShapeKind) => {
    if (!doc) return;
    setShape(kind);
    const width = Math.max(10, doc.width * 0.35),
      height = Math.max(10, doc.height * 0.25);
    const item: Layer = {
      id: crypto.randomUUID(),
      kind,
      width,
      height,
      matrix: translate((doc.width - width) / 2, (doc.height - height) / 2),
      color: '#0797a7',
      fill: kind === 'line' || kind === 'arrow' ? 'transparent' : '#0797a7',
      strokeWidth: Math.max(2, doc.width / 200),
      opacity: 1,
    };
    engine.commit({ ...doc, layers: [...doc.layers, item] });
    engine.select(item.id);
  };
  const editText = (id: string) => {
    engine.select(id);
    setTool('text');
    setPanel(true);
  };
  const addText = () => {
    if (!doc) return;
    const fontSize = Math.max(
        12,
        Math.round(Math.min(doc.width, doc.height) / 12)
      ),
      text = t('text.placeholder'),
      fontFamily = 'sans-serif',
      size = textSize(text, fontSize, fontFamily);
    const item: Layer = {
      id: crypto.randomUUID(),
      kind: 'text',
      ...size,
      matrix: translate(
        (doc.width - size.width) / 2,
        (doc.height - size.height) / 2
      ),
      text,
      fontSize,
      fontFamily,
      color: '#202a38',
      fill: 'transparent',
      strokeWidth: 0,
      opacity: 1,
    };
    engine.commit({ ...doc, layers: [...doc.layers, item] });
    editText(item.id);
    requestAnimationFrame(() => surface.current?.editText(item.id));
  };
  const changeText = (patch: Partial<Layer>, preview = false) => {
    const current = engine.getSnapshot(),
      document = current.document;
    if (!document) return;
    const next = {
      ...document,
      layers: document.layers.map((item) =>
        current.selectedIds.includes(item.id) && item.kind === 'text'
          ? fitTextLayer({ ...item, ...patch })
          : item
      ),
    };
    if (preview) {
      engine.begin();
      engine.preview(next);
    } else engine.commit(next);
  };
  const changeTextContent = (value: RichTextValue) => {
    const current = engine.getSnapshot(),
      document = current.document;
    if (
      !document ||
      !layer ||
      layer.kind !== 'text' ||
      current.selected !== layer.id
    )
      return;
    const item = document.layers.find((item) => item.id === layer.id);
    if (!item) return;
    engine.begin();
    engine.preview(
      updateLayer(
        document,
        item.id,
        fitTextLayer({ ...item, text: value.text, textRuns: value.runs })
      )
    );
  };
  const formatText = (patch: Partial<TextStyle>, preview = false) => {
    const current = engine.getSnapshot(),
      document = current.document,
      active = activeTextEditor.current;
    if (!document) return;
    if (current.selectedIds.length === 1 && active?.id === current.selected) {
      active.handle.applyFormat(patch);
      return;
    }
    const { background, ...basePatch } = patch;
    const next = {
      ...document,
      layers: document.layers.map((item) => {
        if (!current.selectedIds.includes(item.id) || item.kind !== 'text')
          return item;
        const value = formatRichText(
          textValue(item),
          { anchor: 0, focus: textContent(item).length },
          patch
        );
        return fitTextLayer({
          ...item,
          ...basePatch,
          ...(background === undefined ? {} : { textBackground: background }),
          text: value.text,
          textRuns: value.runs,
        });
      }),
    };
    if (preview) {
      engine.begin();
      engine.preview(next);
    } else engine.commit(next);
  };
  const resize = (width: number, height: number) => {
    if (!doc) return;
    try {
      engine.commit(resizeDocument(doc, width, height));
      setError('');
    } catch {
      setError(t('status.size_invalid'));
    }
  };
  const presetRatio = (value: number | null) => {
    const current = engine.getSnapshot().document;
    if (!current || cropOptions.aspectRatio) return;
    const width = value
        ? Math.min(current.width, current.height * value)
        : current.width,
      height = value ? width / value : current.height;
    const changed = changeCrop(
      {
        x: (current.width - width) / 2,
        y: (current.height - height) / 2,
        width,
        height,
      },
      undefined,
      value
    );
    if (changed) setRatio(value);
    return changed;
  };
  const selectCropPreset = (preset: CropPreset) => {
    if (
      !presetRatio(
        preset.size
          ? preset.size.width / preset.size.height
          : (preset.aspectRatio ?? null)
      )
    )
      return;
    setCropPreset(preset.id);
    if (cropSession.current) cropSession.current.output = preset.size;
    setCropOutput(preset.size);
  };
  const previewCropImage = (base: ImageDocument, delta: Matrix) => {
    let next = transformImage(base, delta);
    const covered = constrainImageToCrop(
      next.imageMatrix,
      cropSource(next),
      cropRect.current,
      cropOptions.allowOutsideImage
    );
    next = transformImage(next, multiply(covered, inverse(next.imageMatrix)));
    engine.preview(next);
  };
  const centeredCropTransform = (matrix: Matrix): Matrix => {
    const rect = cropRect.current,
      x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    return multiply(translate(x, y), multiply(matrix, translate(-x, -y)));
  };
  const rotate = (clockwise: boolean) => {
    const current = engine.getSnapshot().document;
    if (!current || !cropSession.current) return;
    if (cropOptions.interactionFocus === 'image') {
      previewCropImage(
        current,
        centeredCropTransform(rotation(clockwise ? 90 : -90))
      );
    } else {
      const next = rotateDocument(current, clockwise),
        r = cropRect.current;
      const nextRatio = cropOptions.aspectRatio ?? (ratio ? 1 / ratio : null);
      let nextCrop: Rect;
      try {
        nextCrop = constrainCropRect(
          {
            x: clockwise ? current.height - r.y - r.height : r.y,
            y: clockwise ? r.x : current.width - r.x - r.width,
            width: r.height,
            height: r.width,
          },
          cropSource(next),
          cropOptions,
          { aspectRatio: nextRatio }
        );
      } catch {
        setError(t('crop.constraints_error'));
        return;
      }
      engine.preview(next);
      setRatio(nextRatio);
      setCrop(nextCrop);
      if (cropSession.current.output && !cropOptions.aspectRatio) {
        cropSession.current.output = {
          width: cropSession.current.output.height,
          height: cropSession.current.output.width,
        };
        setCropOutput(cropSession.current.output);
      }
    }
    straightening.current = null;
    setAngle(0);
  };
  const flip = (horizontal: boolean) => {
    const current = engine.getSnapshot().document;
    if (!current || !cropSession.current) return;
    if (cropOptions.interactionFocus === 'image')
      previewCropImage(
        current,
        centeredCropTransform(scale(horizontal ? -1 : 1, horizontal ? 1 : -1))
      );
    else {
      engine.preview(flipDocument(current, horizontal));
      const r = cropRect.current;
      setCrop({
        ...r,
        x: horizontal ? current.width - r.x - r.width : r.x,
        y: horizontal ? r.y : current.height - r.y - r.height,
      });
    }
    straightening.current = null;
    setAngle(0);
  };
  const reorder = (direction: number) => {
    if (!doc || !layer) return;
    engine.commit(
      reorderLayer(doc, layer.id, direction > 0 ? 'forward' : 'backward')
    );
  };
  const importImage = async (file: File) => {
    if (!file.type.startsWith('image/') || adding) return;
    setAdding(true);
    setError('');
    const url = URL.createObjectURL(file);
    try {
      await engine.addImage(url);
      setTool('stickers');
      setPanel(true);
    } catch {
      setError(t('status.import_failed'));
    } finally {
      URL.revokeObjectURL(url);
      setAdding(false);
    }
  };
  const addSymbol = (symbol: string) => {
    if (!doc) return;
    const fontSize = Math.max(24, Math.min(doc.width, doc.height) / 3),
      size = textSize(symbol, fontSize, 'sans-serif');
    const item: Layer = {
      id: crypto.randomUUID(),
      kind: 'text',
      ...size,
      matrix: translate(
        (doc.width - size.width) / 2,
        (doc.height - size.height) / 2
      ),
      text: symbol,
      fontSize,
      fontFamily: 'sans-serif',
      color: brush.color,
      fill: 'transparent',
      strokeWidth: 0,
      opacity: 1,
    };
    engine.commit({ ...doc, layers: [...doc.layers, item] });
    engine.select(item.id);
  };
  const cancelCrop = () => {
    if (cropSession.current) {
      surface.current?.finishCropGesture();
      cropSession.current = null;
      engine.cancel();
    }
    straightening.current = null;
    setAngle(0);
    setTool('select');
    setPanel(false);
  };
  const endStraighten = () => {
    if (!straightening.current) return;
    straightening.current = null;
  };
  const save = async () => {
    if (disabled) return;
    setSaving(true);
    try {
      if (tool === 'crop') applyCrop(true);
      const dataUrl = engine.getImage();
      if (!dataUrl) throw new Error('Editor is not ready');
      const blob = await engine.getBlob();
      onSave?.({ dataUrl, blob });
    } catch (e) {
      setError(t('status.export_failed'));
      onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setSaving(false);
    }
  };
  const groupControls =
    doc && isGroup ? (
      <div className="rie-stack" data-testid="native-group-controls">
        <p className="rie-selection-count" role="status">
          {t('selection.count').replace(
            '{count}',
            String(selectedLayers.length)
          )}
        </p>
        <div className="rie-row">
          {iconButton('duplicate', 'actions.duplicate', () => {
            const copy = duplicateLayers(doc, selectedIds);
            engine.commit(copy.document);
            engine.selectMany(copy.ids);
          })}
          {iconButton('delete', 'actions.delete', () =>
            engine.removeSelected()
          )}
        </div>
        <fieldset className="rie-control-group">
          <legend>{t('selection.align')}</legend>
          <div className="rie-alignment-grid">
            {(
              ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
            ).map((alignment) => (
              <React.Fragment key={alignment}>
                {iconButton(
                  `objects_${alignment}`,
                  `selection.align_${alignment}`,
                  () => engine.commit(alignLayers(doc, selectedIds, alignment)),
                  false,
                  `native-align-${alignment}`
                )}
              </React.Fragment>
            ))}
            {(['horizontal', 'vertical'] as const).map((axis) => (
              <React.Fragment key={axis}>
                {iconButton(
                  `distribute_${axis}`,
                  `selection.distribute_${axis}`,
                  () => engine.commit(distributeLayers(doc, selectedIds, axis)),
                  selectedIds.length < 3,
                  `native-distribute-${axis}`
                )}
              </React.Fragment>
            ))}
          </div>
        </fieldset>
        {selectedLayers.some(hasColor) &&
        !(tool === 'text' && textLayers.length) ? (
          <ColorField
            label={t('draw.color')}
            value={commonValue(
              selectedLayers
                .filter(hasColor)
                .map((item) =>
                  item.kind === 'text'
                    ? (selectedTextStyle(
                        textValue(item),
                        { anchor: 0, focus: textContent(item).length },
                        resolveTextStyle(item)
                      ).color ?? null)
                    : item.color
                )
            )}
            mixedLabel={t('selection.mixed')}
            onChange={(color) => changeSelection({ color }, false, hasColor)}
          />
        ) : null}
        {selectedLayers.some(hasFill) ? (
          <>
            <ColorField
              label={t('shapes.fill')}
              value={commonValue(
                selectedLayers.filter(hasFill).map((item) => item.fill)
              )}
              mixedLabel={t('selection.mixed')}
              onChange={(fill) => changeSelection({ fill }, false, hasFill)}
            />
            <button
              type="button"
              onClick={() =>
                changeSelection({ fill: 'transparent' }, false, hasFill)
              }
            >
              {t('shapes.transparent')}
            </button>
          </>
        ) : null}
        {selectedLayers.some(hasStroke) ? (
          <NumberField
            label={t('shapes.stroke_width')}
            value={commonValue(
              selectedLayers.filter(hasStroke).map((item) => item.strokeWidth)
            )}
            mixedLabel={t('selection.mixed')}
            min={0}
            max={300}
            onCommit={(strokeWidth) =>
              changeSelection({ strokeWidth }, false, hasStroke)
            }
          />
        ) : null}
        <NumberField
          label={t('draw.opacity')}
          value={commonValue(
            selectedLayers.map((item) => Math.round(item.opacity * 100))
          )}
          mixedLabel={t('selection.mixed')}
          min={0}
          max={100}
          onCommit={(opacity) => changeSelection({ opacity: opacity / 100 })}
        />
      </div>
    ) : null;
  const selectedControls = isGroup ? (
    groupControls
  ) : layer && doc ? (
    <div className="rie-stack" data-testid="native-selection-controls">
      <div className="rie-row">
        {iconButton('duplicate', 'actions.duplicate', () => {
          const next = duplicateLayer(doc, layer.id);
          engine.commit(next);
          engine.select(
            next.layers.find(
              (item) => !doc.layers.some((existing) => existing.id === item.id)
            )?.id ?? null
          );
        })}
        {iconButton('forward', 'actions.forward', () => reorder(1))}
        {iconButton('backward', 'actions.backward', () => reorder(-1))}
        {iconButton('delete', 'actions.delete', () => engine.removeSelected())}
      </div>
      <div className="rie-row">
        {iconButton('flip_horizontal', 'rotate.flip_horizontal', () =>
          changeLayer(flipLayer(layer, true))
        )}
        {iconButton('flip_vertical', 'rotate.flip_vertical', () =>
          changeLayer(flipLayer(layer, false))
        )}
        <button
          type="button"
          className="rie-icon-button"
          title={t('selection.locked')}
          aria-label={t('selection.locked')}
          aria-pressed={!!layer.locked}
          onClick={() => changeLayer({ locked: !layer.locked })}
        >
          <Icon name="lock" />
        </button>
        <button
          type="button"
          className="rie-icon-button"
          title={t('selection.hidden')}
          aria-label={t('selection.hidden')}
          aria-pressed={!!layer.hidden}
          onClick={() => changeLayer({ hidden: !layer.hidden })}
        >
          <Icon name="hidden" />
        </button>
      </div>
      {!['image', 'text'].includes(layer.kind) ? (
        <ColorField
          label={t('draw.color')}
          value={layer.color}
          onChange={(color) => changeLayer({ color })}
        />
      ) : null}
      {!['text', 'image', 'redaction'].includes(layer.kind) ? (
        <NumberField
          label={t('shapes.stroke_width')}
          value={layer.strokeWidth}
          min={0}
          max={300}
          onCommit={(strokeWidth) => changeLayer({ strokeWidth })}
        />
      ) : null}
      {!['line', 'arrow', 'image', 'redaction'].includes(layer.kind) ? (
        <>
          <ColorField
            label={t(layer.kind === 'text' ? 'text.background' : 'shapes.fill')}
            value={layer.fill}
            onChange={(fill) => changeLayer({ fill })}
          />
          <button
            type="button"
            aria-pressed={layer.fill === 'transparent'}
            onClick={() =>
              changeLayer({
                fill: layer.fill === 'transparent' ? '#0797a7' : 'transparent',
              })
            }
          >
            {t('shapes.transparent')}
          </button>
        </>
      ) : null}
      {layer.kind === 'path' && layer.pathEditable ? (
        <div className="rie-stack">
          <button
            type="button"
            aria-pressed={pathState.editing}
            data-testid="native-path-edit"
            onClick={() => surface.current?.editPath(layer.id)}
          >
            {t('path.edit')}
          </button>
          <button
            type="button"
            aria-pressed={!!layer.pathClosed}
            disabled={(layer.points?.length ?? 0) < 3}
            onClick={() => changeLayer({ pathClosed: !layer.pathClosed })}
          >
            {t('path.closed')}
          </button>
        </div>
      ) : null}
      {!['text', 'image', 'redaction'].includes(layer.kind) ? (
        <details className="rie-advanced">
          <summary>{t('shapes.stroke_style')}</summary>
          <div className="rie-stack">
            <ChoicePicker
              label={t('shapes.pattern')}
              value={
                !layer.strokeDash?.length
                  ? 'solid'
                  : layer.strokeDash[0] <= 2
                    ? 'dotted'
                    : 'dashed'
              }
              choices={['solid', 'dashed', 'dotted'].map((value) => ({
                value,
                label: t(`shapes.pattern_${value}`),
              }))}
              onChange={(value) =>
                changeLayer({
                  strokeDash:
                    value === 'solid'
                      ? []
                      : value === 'dotted'
                        ? [1, Math.max(4, layer.strokeWidth * 2)]
                        : [
                            Math.max(8, layer.strokeWidth * 3),
                            Math.max(4, layer.strokeWidth * 2),
                          ],
                })
              }
              t={t}
            />
            <ChoicePicker
              label={t('shapes.cap')}
              value={layer.strokeCap ?? 'round'}
              choices={['butt', 'round', 'square'].map((value) => ({
                value,
                label: t(`shapes.cap_${value}`),
              }))}
              onChange={(value) =>
                changeLayer({ strokeCap: value as Layer['strokeCap'] })
              }
              t={t}
            />
            <ChoicePicker
              label={t('shapes.join')}
              value={layer.strokeJoin ?? 'round'}
              choices={['miter', 'round', 'bevel'].map((value) => ({
                value,
                label: t(`shapes.join_${value}`),
              }))}
              onChange={(value) =>
                changeLayer({ strokeJoin: value as Layer['strokeJoin'] })
              }
              t={t}
            />
            {layer.kind === 'rectangle' ? (
              <NumberField
                label={t('shapes.corner_radius')}
                value={layer.cornerRadius ?? 0}
                min={0}
                max={Math.min(layer.width, layer.height) / 2}
                onCommit={(cornerRadius) => changeLayer({ cornerRadius })}
              />
            ) : null}
            <SliderField
              label={t('shapes.feather')}
              value={layer.feather ?? 0}
              max={100}
              onChange={(feather) => previewLayer({ feather })}
              {...gesture}
              suffix=" px"
            />
          </div>
        </details>
      ) : null}
      {layer.kind === 'text' ? (
        <details className="rie-advanced">
          <summary>{t('text.effects')}</summary>
          <div className="rie-stack">
            <NumberField
              label={t('text.outline_width')}
              value={layer.textOutline?.width ?? 0}
              min={0}
              max={100}
              onCommit={(width) =>
                changeLayer({
                  textOutline: {
                    color: layer.textOutline?.color ?? '#ffffff',
                    width,
                  },
                })
              }
            />
            <ColorField
              label={t('text.outline_color')}
              value={layer.textOutline?.color ?? '#ffffff'}
              onChange={(color) =>
                changeLayer({
                  textOutline: { width: layer.textOutline?.width || 2, color },
                })
              }
            />
            <button
              type="button"
              aria-pressed={!!layer.textShadow}
              onClick={() =>
                changeLayer({
                  textShadow: layer.textShadow
                    ? undefined
                    : { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
                })
              }
            >
              {t('text.shadow')}
            </button>
            {layer.textShadow ? (
              <>
                <ColorField
                  label={t('text.shadow_color')}
                  value={layer.textShadow.color}
                  onChange={(color) =>
                    changeLayer({ textShadow: { ...layer.textShadow!, color } })
                  }
                />
                <NumberField
                  label={t('text.shadow_blur')}
                  value={layer.textShadow.blur}
                  min={0}
                  max={100}
                  onCommit={(blur) =>
                    changeLayer({ textShadow: { ...layer.textShadow!, blur } })
                  }
                />
                <div className="rie-grid">
                  {(['offsetX', 'offsetY'] as const).map((key) => (
                    <NumberField
                      key={key}
                      label={t(`text.shadow_${key}`)}
                      value={layer.textShadow![key]}
                      min={-100}
                      max={100}
                      onCommit={(value) =>
                        changeLayer({
                          textShadow: { ...layer.textShadow!, [key]: value },
                        })
                      }
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      {['line', 'arrow'].includes(layer.kind) ? (
        <div className="rie-grid">
          {(['arrowStart', 'arrowEnd'] as const).map((key) => (
            <ChoicePicker
              key={key}
              label={t(
                key === 'arrowStart' ? 'shapes.arrow_start' : 'shapes.arrow_end'
              )}
              value={
                layer[key] ??
                (key === 'arrowEnd' && layer.kind === 'arrow'
                  ? 'arrow'
                  : 'none')
              }
              choices={['none', 'arrow', 'circle', 'square'].map((value) => ({
                value,
                label: t(`shapes.end_${value}`),
              }))}
              onChange={(value) => changeLayer({ [key]: value })}
              t={t}
            />
          ))}
        </div>
      ) : null}
      <SliderField
        label={t('draw.opacity')}
        value={Math.round(layer.opacity * 100)}
        onChange={(opacity) => previewLayer({ opacity: opacity / 100 })}
        {...gesture}
        suffix="%"
      />
      <NumberField
        label={t('selection.rotation')}
        value={(Math.atan2(layer.matrix[1], layer.matrix[0]) * 180) / Math.PI}
        min={-360}
        max={360}
        testId="native-selection-rotation"
        onCommit={(angle) =>
          changeLayer(
            rotateLayer(
              layer,
              angle -
                (Math.atan2(layer.matrix[1], layer.matrix[0]) * 180) / Math.PI
            )
          )
        }
      />
      {layer.kind !== 'text' ? (
        <div className="rie-grid">
          <NumberField
            label={t('resize.width')}
            value={layer.width * Math.hypot(layer.matrix[0], layer.matrix[1])}
            onCommit={(width) =>
              changeLayer({
                matrix: multiply(
                  layer.matrix,
                  scale(
                    width /
                      (layer.width *
                        Math.hypot(layer.matrix[0], layer.matrix[1])),
                    1
                  )
                ),
              })
            }
          />
          <NumberField
            label={t('resize.height')}
            value={layer.height * Math.hypot(layer.matrix[2], layer.matrix[3])}
            onCommit={(height) =>
              changeLayer({
                matrix: multiply(
                  layer.matrix,
                  scale(
                    1,
                    height /
                      (layer.height *
                        Math.hypot(layer.matrix[2], layer.matrix[3]))
                  )
                ),
              })
            }
          />
        </div>
      ) : null}
    </div>
  ) : (
    <p className="rie-help">{t('selection.hint')}</p>
  );
  let controls: React.ReactNode = null;
  if (doc && tool === 'crop') {
    const presets: readonly CropPreset[] = cropOptions.presets ?? [
      { id: 'free', label: t('crop.aspect_free'), aspectRatio: null },
      {
        id: 'original',
        label: t('crop.aspect_original'),
        aspectRatio:
          (engine.image?.width ?? doc.width) /
          (engine.image?.height ?? doc.height),
      },
      { id: 'square', label: t('crop.aspect_square'), aspectRatio: 1 },
      ...[
        [4, 3],
        [16, 9],
        [3, 4],
        [9, 16],
        [3, 2],
      ].map(([w, h]) => ({
        id: `${w}:${h}`,
        label: `${w}:${h}`,
        aspectRatio: w / h,
      })),
    ];
    const activeRatio = cropOptions.aspectRatio ?? ratio;
    const output = cropOutput;
    controls = (
      <div className="rie-stack rie-crop-controls">
        <div
          className="rie-crop-mode"
          role="group"
          aria-label={t('crop.focus')}
        >
          {(['image', 'selection'] as const).map((focus) => (
            <button
              type="button"
              key={focus}
              aria-pressed={cropOptions.interactionFocus === focus}
              data-testid={`native-crop-focus-${focus}`}
              onClick={() => {
                surface.current?.finishCropGesture();
                setCropOverrides({ ...cropOverrides, interactionFocus: focus });
              }}
            >
              <Icon name={focus === 'image' ? 'image' : 'crop'} />
              {t(`crop.focus_${focus}`)}
            </button>
          ))}
        </div>
        {cropOptions.interactionFocus === 'image' && cropOptions.enableZoom ? (
          <div
            className="rie-crop-zoom"
            role="group"
            aria-label={t('crop.zoom')}
          >
            <span>{t('crop.zoom')}</span>
            <button
              type="button"
              className="rie-icon-button"
              aria-label={t('crop.zoom_out')}
              title={t('crop.zoom_out')}
              data-testid="native-crop-zoom-out"
              onClick={() => surface.current?.cropZoom(0.9)}
            >
              <Icon name="zoom_out" />
            </button>
            <button
              type="button"
              className="rie-icon-button"
              aria-label={t('crop.zoom_in')}
              title={t('crop.zoom_in')}
              data-testid="native-crop-zoom-in"
              onClick={() => surface.current?.cropZoom(1.1)}
            >
              <Icon name="zoom_in" />
            </button>
            <button
              type="button"
              className="rie-icon-button"
              aria-label={t('crop.center_image')}
              title={t('crop.center_image')}
              data-testid="native-crop-center"
              onClick={() => surface.current?.cropRecenter()}
            >
              <Icon name="fit_to_screen" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="native-crop-center"
            onClick={() =>
              cropOptions.interactionFocus === 'image'
                ? surface.current?.cropRecenter()
                : surface.current?.fitCrop()
            }
          >
            <Icon name="fit_to_screen" />
            {t(
              cropOptions.interactionFocus === 'image'
                ? 'crop.center_image'
                : 'crop.center_selection'
            )}
          </button>
        )}
        {cropOptions.aspectRatio ? (
          <p className="rie-help" data-testid="native-crop-required-ratio">
            {t('crop.fixed_ratio')}:{' '}
            {Number(cropOptions.aspectRatio.toFixed(4))}
          </p>
        ) : cropOptions.presets ? (
          <ChoicePicker
            label={t('crop.preset')}
            value={
              presets.some((item) => item.id === cropPreset)
                ? cropPreset
                : 'custom'
            }
            choices={[
              { value: 'custom', label: t('crop.custom') },
              ...presets.map((item) => ({
                value: item.id,
                label: item.label,
                group: item.group,
              })),
            ]}
            testId="native-crop-preset"
            t={t}
            onChange={(id) => {
              const preset = presets.find((item) => item.id === id);
              if (preset) selectCropPreset(preset);
              else {
                setRatio(null);
                setCropPreset('custom');
                if (cropSession.current) cropSession.current.output = undefined;
                setCropOutput(undefined);
              }
            }}
          />
        ) : (
          <div className="rie-ratios" aria-label={t('crop.aspect_ratio')}>
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                aria-pressed={cropPreset === preset.id}
                onClick={() => selectCropPreset(preset)}
              >
                <span
                  aria-hidden="true"
                  className="rie-ratio-outline"
                  style={{ aspectRatio: preset.aspectRatio || 1.45 }}
                />
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <div className="rie-crop-size">
          <NumberField
            label={t('resize.width')}
            value={crop.width}
            min={1}
            max={8192}
            testId="native-crop-width"
            onCommit={(width) =>
              changeCrop({ ...cropRect.current, width }, 'width')
            }
          />
          <NumberField
            label={t('resize.height')}
            value={crop.height}
            min={1}
            max={8192}
            testId="native-crop-height"
            onCommit={(height) =>
              changeCrop({ ...cropRect.current, height }, 'height')
            }
          />
          {!cropOptions.aspectRatio ? (
            <button
              type="button"
              className="rie-icon-button"
              aria-label={t('crop.orientation')}
              title={t('crop.orientation')}
              data-testid="native-crop-orientation"
              onClick={() => {
                const rect = cropRect.current,
                  nextRatio = activeRatio ? 1 / activeRatio : null;
                if (
                  !changeCrop(
                    {
                      x: rect.x + (rect.width - rect.height) / 2,
                      y: rect.y + (rect.height - rect.width) / 2,
                      width: rect.height,
                      height: rect.width,
                    },
                    undefined,
                    nextRatio
                  )
                )
                  return;
                setRatio(nextRatio);
                setCropPreset('custom');
                if (cropSession.current?.output) {
                  cropSession.current.output = {
                    width: cropSession.current.output.height,
                    height: cropSession.current.output.width,
                  };
                  setCropOutput(cropSession.current.output);
                }
              }}
            >
              <Icon name="rotate_right" />
            </button>
          ) : null}
        </div>
        {output ? (
          <p className="rie-help" data-testid="native-crop-output-size">
            {t('crop.output_size')
              .replace('{width}', String(output.width))
              .replace('{height}', String(output.height))}
          </p>
        ) : null}
        {cropOptions.enableRotation ? (
          <>
            <SliderField
              label={t('crop.straighten')}
              value={angle}
              min={-cropOptions.rotationRange}
              max={cropOptions.rotationRange}
              step={0.5}
              suffix="°"
              testId="native-crop-straighten"
              onStart={() => {
                if (!straightening.current) {
                  straightening.current = engine.getSnapshot().document;
                  straightenStartAngle.current = angle;
                }
              }}
              onChange={(value) => {
                const base =
                  straightening.current ?? engine.getSnapshot().document;
                if (!base) return;
                if (!straightening.current) {
                  straightening.current = base;
                  straightenStartAngle.current = angle;
                }
                previewCropImage(
                  base,
                  centeredCropTransform(
                    rotation(value - straightenStartAngle.current)
                  )
                );
                setAngle(value);
              }}
              onEnd={endStraighten}
            />
            <div className="rie-row" aria-label={t('crop.rotate_flip')}>
              <button
                type="button"
                className="rie-icon-button"
                aria-label={t('rotate.rotate_left')}
                title={t('rotate.rotate_left')}
                onClick={() => rotate(false)}
              >
                <Icon name="rotate_left" />
              </button>
              <button
                type="button"
                className="rie-icon-button"
                aria-label={t('rotate.rotate_right')}
                title={t('rotate.rotate_right')}
                onClick={() => rotate(true)}
              >
                <Icon name="rotate_right" />
              </button>
              <button
                type="button"
                className="rie-icon-button"
                aria-label={t('rotate.flip_horizontal')}
                title={t('rotate.flip_horizontal')}
                onClick={() => flip(true)}
              >
                <Icon name="flip_horizontal" />
              </button>
              <button
                type="button"
                className="rie-icon-button"
                aria-label={t('rotate.flip_vertical')}
                title={t('rotate.flip_vertical')}
                onClick={() => flip(false)}
              >
                <Icon name="flip_vertical" />
              </button>
            </div>
          </>
        ) : null}
        {cropOptions.enableLimitToggle ? (
          <label className="rie-check">
            <input
              type="checkbox"
              data-testid="native-crop-limit"
              checked={!cropOptions.allowOutsideImage}
              onChange={(event) => {
                surface.current?.finishCropGesture();
                const allowOutsideImage = !event.target.checked;
                const current = engine.getSnapshot().document;
                if (current && !allowOutsideImage) {
                  try {
                    if (cropOptions.interactionFocus === 'image') {
                      const covered = constrainImageToCrop(
                        current.imageMatrix,
                        cropSource(current),
                        cropRect.current,
                        false
                      );
                      engine.preview(
                        transformImage(
                          current,
                          multiply(covered, inverse(current.imageMatrix))
                        )
                      );
                    } else {
                      const next = constrainCropRect(
                        cropRect.current,
                        cropSource(current),
                        { ...cropOptions, allowOutsideImage },
                        { aspectRatio: activeRatio }
                      );
                      setCrop(next);
                    }
                  } catch {
                    setError(t('crop.constraints_error'));
                    return;
                  }
                }
                setCropOverrides({ ...cropOverrides, allowOutsideImage });
              }}
            />
            {t('crop.limit')}
          </label>
        ) : null}
        <details className="rie-crop-details">
          <summary>{t('crop.details')}</summary>
          <div className="rie-stack">
            <div className="rie-grid">
              <NumberField
                label={t('crop.region_x')}
                value={crop.x}
                min={-8192}
                max={8192}
                testId="native-crop-x"
                onCommit={(x) => changeCrop({ ...cropRect.current, x })}
              />
              <NumberField
                label={t('crop.region_y')}
                value={crop.y}
                min={-8192}
                max={8192}
                testId="native-crop-y"
                onCommit={(y) => changeCrop({ ...cropRect.current, y })}
              />
            </div>
            <ChoicePicker
              label={t('crop.guides')}
              value={
                typeof cropOptions.guides === 'string'
                  ? cropOptions.guides
                  : 'custom'
              }
              choices={[
                ...['none', 'thirds', 'grid', 'diagonals'].map((value) => ({
                  value,
                  label: t(`crop.guide_${value}`),
                })),
                ...(typeof state.options.crop?.guides === 'object'
                  ? [{ value: 'custom', label: t('crop.guide_custom') }]
                  : []),
              ]}
              t={t}
              testId="native-crop-guides"
              onChange={(value) =>
                setCropOverrides({
                  ...cropOverrides,
                  guides:
                    value === 'custom'
                      ? state.options.crop?.guides
                      : (value as 'none' | 'thirds' | 'grid' | 'diagonals'),
                })
              }
            />
            <ChoicePicker
              label={t('crop.handles')}
              value={cropOptions.handleStyle}
              choices={['circle', 'hook', 'invisible'].map((value) => ({
                value,
                label: t(`crop.handle_${value}`),
              }))}
              t={t}
              testId="native-crop-handles"
              onChange={(value) =>
                setCropOverrides({
                  ...cropOverrides,
                  handleStyle: value as 'circle' | 'hook' | 'invisible',
                })
              }
            />
          </div>
        </details>
        <p className="rie-help">
          {t(
            cropOptions.interactionFocus === 'image'
              ? 'crop.image_hint'
              : 'crop.hint'
          )}
        </p>
      </div>
    );
  }
  if (doc && tool === 'resize')
    controls = (
      <div className="rie-stack" data-testid="native-resize-panel">
        <NumberField
          label={t('resize.width')}
          value={doc.width}
          testId="native-resize-width"
          onCommit={(width) =>
            resize(
              width,
              locked
                ? Math.max(1, Math.round((width * doc.height) / doc.width))
                : doc.height
            )
          }
        />
        <NumberField
          label={t('resize.height')}
          value={doc.height}
          testId="native-resize-height"
          onCommit={(height) =>
            resize(
              locked
                ? Math.max(1, Math.round((height * doc.width) / doc.height))
                : doc.width,
              height
            )
          }
        />
        <button
          type="button"
          data-testid="native-resize-lock"
          aria-pressed={locked}
          onClick={() => setLocked(!locked)}
        >
          <Icon name={locked ? 'lock' : 'unlock'} />
          {t('resize.lock_aspect')}
        </button>
      </div>
    );
  if (tool === 'draw')
    controls = (
      <>
        <div className="rie-row">
          {(['brush', 'highlighter', 'eraser'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={brush.mode === mode}
              onClick={() => setBrush({ ...brush, mode })}
              data-testid={`native-draw-${mode}`}
            >
              <Icon name={mode === 'brush' ? 'draw' : mode} />
              {t(`draw.${mode}`)}
            </button>
          ))}
        </div>
        <ColorField
          label={t('draw.color')}
          value={brush.color}
          onChange={(color) => setBrush({ ...brush, color })}
        />
        <SliderField
          label={t('draw.brush_size')}
          value={brush.size}
          min={1}
          max={200}
          onChange={(size) => setBrush({ ...brush, size })}
          testId="native-draw-size"
        />
        <SliderField
          label={t('draw.opacity')}
          value={Math.round(brush.opacity * 100)}
          min={1}
          max={100}
          suffix="%"
          onChange={(opacity) => setBrush({ ...brush, opacity: opacity / 100 })}
        />
      </>
    );
  if (tool === 'text') {
    const CustomTextInput = renderTextInput;
    const weight = textMarks.fontWeight;
    const inputProps: RichTextInputProps | null =
      layer?.kind === 'text' && !isGroup
        ? {
            value: textValue(layer),
            getValue: () => {
              const current = engine.getSnapshot();
              const item = current.document?.layers.find(
                (item) => item.id === layer.id && item.kind === 'text'
              );
              return current.selected === layer.id && item
                ? textValue(item)
                : null;
            },
            defaults: resolveTextStyle(layer),
            onChange: changeTextContent,
            onSelectionChange: onTextSelection,
            onFocus: onPanelTextFocus,
            onBlur: onPanelTextBlur,
            onCommit: () => engine.end(),
            onCancel: cancelPanelText,
            className: 'rie-panel-text',
            ariaLabel: t('text.content'),
            testId: 'native-text-content',
          }
        : null;
    controls = (
      <>
        {textLayers.length ? (
          <>
            <div className="rie-text-formatting" data-rich-text-toolbar>
              <div
                className="rie-text-toolbar"
                role="toolbar"
                aria-label={t('text.formatting')}
              >
                {(
                  ['bold', 'italic', 'underline', 'strikethrough'] as const
                ).map((name) => {
                  const pressed =
                    name === 'bold'
                      ? weight === null
                        ? null
                        : (weight ?? 400) >= 600
                      : textMarks[name === 'strikethrough' ? 'strike' : name];
                  return (
                    <button
                      key={name}
                      type="button"
                      className="rie-icon-button"
                      aria-label={t(`text.${name}`)}
                      title={t(`text.${name}`)}
                      aria-pressed={pressed === null ? 'mixed' : !!pressed}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (name === 'bold')
                          formatText({
                            fontWeight: pressed === true ? 400 : 700,
                          });
                        else
                          formatText({
                            [name === 'strikethrough' ? 'strike' : name]:
                              pressed !== true,
                          });
                      }}
                    >
                      <Icon name={name} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="rie-icon-button"
                  aria-label={t('text.add')}
                  title={t('text.add')}
                  data-testid="native-text-add"
                  onClick={addText}
                >
                  <Icon name="text" />
                </button>
              </div>
            </div>
            {layer?.kind === 'text' && !isGroup ? (
              CustomTextInput ? (
                <CustomTextInput
                  {...inputProps!}
                  context="panel"
                  editorRef={textField}
                />
              ) : (
                <RichTextInput
                  key={layer!.id}
                  ref={textField}
                  {...inputProps!}
                />
              )
            ) : (
              <p className="rie-help">
                {t('text.selected_objects').replace(
                  '{count}',
                  String(textLayers.length)
                )}
              </p>
            )}
            {layer?.kind === 'text' && !isGroup ? (
              <p
                className="rie-help rie-text-color-hint"
                data-testid="native-text-panel-color-hint"
              >
                {t('text.panel_colors_hint')}
              </p>
            ) : null}
            <div
              className="rie-stack rie-text-formatting"
              data-rich-text-toolbar
            >
              <ChoicePicker
                label={t('text.font_family')}
                value={textMarks.fontFamily ?? null}
                choices={[
                  { value: 'sans-serif', label: t('text.sans') },
                  { value: 'serif', label: t('text.serif') },
                  { value: 'monospace', label: t('text.mono') },
                  { value: 'Arial, sans-serif', label: 'Arial' },
                  { value: 'Georgia, serif', label: 'Georgia' },
                  { value: 'Verdana, sans-serif', label: 'Verdana' },
                  {
                    value: '"Trebuchet MS", sans-serif',
                    label: 'Trebuchet MS',
                  },
                ]}
                onChange={(fontFamily) => formatText({ fontFamily })}
                t={t}
              />
              <div className="rie-grid">
                <NumberField
                  label={t('text.font_size')}
                  value={textMarks.fontSize ?? null}
                  mixedLabel={t('selection.mixed')}
                  max={1000}
                  testId="native-text-size"
                  onCommit={(fontSize) => formatText({ fontSize }, true)}
                  {...gesture}
                />
                <NumberField
                  label={t('text.font_weight')}
                  value={weight ?? null}
                  mixedLabel={t('selection.mixed')}
                  min={1}
                  max={1000}
                  step={1}
                  testId="native-text-weight"
                  onCommit={(fontWeight) => formatText({ fontWeight }, true)}
                  {...gesture}
                />
              </div>
              <ColorField
                label={t('draw.color')}
                value={textMarks.color ?? null}
                mixedLabel={t('selection.mixed')}
                onChange={(color) => formatText({ color })}
              />
              <details className="rie-advanced">
                <summary>{t('text.highlight')}</summary>
                <div className="rie-stack">
                  <ColorField
                    label={t('text.highlight')}
                    value={textMarks.background ?? null}
                    mixedLabel={t('selection.mixed')}
                    onChange={(background) => formatText({ background })}
                  />
                  <button
                    type="button"
                    onClick={() => formatText({ background: 'transparent' })}
                  >
                    {t('text.clear_highlight')}
                  </button>
                </div>
              </details>
              <div className="rie-row">
                {(['left', 'center', 'right'] as const).map((textAlign) => (
                  <button
                    key={textAlign}
                    type="button"
                    className="rie-icon-button"
                    aria-label={t(`text.align_${textAlign}`)}
                    title={t(`text.align_${textAlign}`)}
                    aria-pressed={
                      commonValue(
                        textLayers.map((item) => item.textAlign ?? 'left')
                      ) === textAlign
                    }
                    onClick={() => changeText({ textAlign })}
                  >
                    <Icon name={`align_${textAlign}`} />
                  </button>
                ))}
              </div>
              <div className="rie-grid">
                <NumberField
                  label={t('text.line_height')}
                  value={commonValue(
                    textLayers.map((item) => item.lineHeight ?? 1.2)
                  )}
                  mixedLabel={t('selection.mixed')}
                  min={0.5}
                  max={4}
                  step={0.1}
                  testId="native-text-line-height"
                  onCommit={(lineHeight) => changeText({ lineHeight }, true)}
                  {...gesture}
                />
                <NumberField
                  label={t('text.letter_spacing')}
                  value={textMarks.letterSpacing ?? null}
                  mixedLabel={t('selection.mixed')}
                  min={-512}
                  max={512}
                  step={0.1}
                  testId="native-text-spacing"
                  onCommit={(letterSpacing) =>
                    formatText({ letterSpacing }, true)
                  }
                  {...gesture}
                />
              </div>
              <details
                className="rie-advanced"
                data-testid="native-text-layout-controls"
              >
                <summary>{t('text.layout')}</summary>
                <div className="rie-stack">
                  <ChoicePicker
                    label={t('text.layout')}
                    value={commonValue(
                      textLayers.map((item) => item.textLayout ?? 'auto-width')
                    )}
                    choices={[
                      {
                        value: 'auto-width',
                        label: t('text.layout_auto_width'),
                      },
                      {
                        value: 'auto-height',
                        label: t('text.layout_auto_height'),
                      },
                      { value: 'fixed', label: t('text.layout_fixed') },
                    ]}
                    onChange={(textLayout) =>
                      changeText({
                        textLayout: textLayout as Layer['textLayout'],
                      })
                    }
                    t={t}
                  />
                  {(['auto-width', 'auto-height', 'fixed'] as const).map(
                    (mode) =>
                      commonValue(
                        textLayers.map(
                          (item) => item.textLayout ?? 'auto-width'
                        )
                      ) === mode ? (
                        <p key={mode} className="rie-help">
                          {t(`text.layout_${mode.replace('-', '_')}_hint`)}
                        </p>
                      ) : null
                  )}
                  {textLayers.every(
                    (item) =>
                      item.textLayout === 'auto-height' ||
                      item.textLayout === 'fixed'
                  ) ? (
                    <NumberField
                      label={t('text.box_width')}
                      value={commonValue(textLayers.map((item) => item.width))}
                      mixedLabel={t('selection.mixed')}
                      testId="native-text-box-width"
                      onCommit={(width) => changeText({ width }, true)}
                      {...gesture}
                    />
                  ) : null}
                  {textLayers.every((item) => item.textLayout === 'fixed') ? (
                    <NumberField
                      label={t('text.box_height')}
                      value={commonValue(textLayers.map((item) => item.height))}
                      mixedLabel={t('selection.mixed')}
                      testId="native-text-box-height"
                      onCommit={(height) => changeText({ height }, true)}
                      {...gesture}
                    />
                  ) : null}
                </div>
              </details>
            </div>
            {selectedControls}
          </>
        ) : (
          <button
            type="button"
            className="rie-primary"
            data-testid="native-text-add"
            onClick={addText}
          >
            <Icon name="text" />
            {t('text.add')}
          </button>
        )}
      </>
    );
  }
  if (tool === 'shapes')
    controls = (
      <>
        {pathState.drawing || pathState.editing || shape === 'path' ? (
          <div className="rie-stack" data-testid="native-path-controls">
            <div className="rie-row">
              {pathState.drawing ? (
                <>
                  <button
                    type="button"
                    disabled={!pathState.canFinish}
                    onClick={() => surface.current?.finishPath()}
                  >
                    {t('path.finish')}
                  </button>
                  <button
                    type="button"
                    disabled={!pathState.canClose}
                    onClick={() => surface.current?.finishPath(true)}
                  >
                    {t('path.close')}
                  </button>
                  <button
                    type="button"
                    className="rie-icon-button"
                    aria-label={t('toolbar.cancel')}
                    title={t('toolbar.cancel')}
                    onClick={() => surface.current?.cancel()}
                  >
                    <Icon name="close" />
                  </button>
                </>
              ) : null}
              {pathState.editing ? (
                <button
                  type="button"
                  disabled={!pathState.canRemovePoint}
                  onClick={() => surface.current?.deletePathPoint()}
                >
                  {t('path.delete_point')}
                </button>
              ) : null}
            </div>
            <p className="rie-help">
              {t(pathState.editing ? 'path.edit_hint' : 'path.draw_hint')}
            </p>
          </div>
        ) : null}
        <div className="rie-grid">
          {(['rectangle', 'ellipse', 'triangle', 'line', 'arrow'] as const).map(
            (kind) => (
              <button
                type="button"
                key={kind}
                data-testid={`native-shape-${kind}`}
                onClick={() => addShape(kind)}
              >
                <Icon name={kind} />
                {t(`shapes.${kind}`)}
              </button>
            )
          )}
          <button
            type="button"
            data-testid="native-shape-path"
            aria-pressed={shape === 'path'}
            onClick={() => {
              surface.current?.finishPath();
              setShape('path');
              engine.select(null);
            }}
          >
            <Icon name="path" />
            {t('shapes.path')}
          </button>
        </div>
        {selectedControls}
      </>
    );
  if (doc && tool === 'filter')
    controls = (
      <>
        <div className="rie-presets" data-testid="native-filter-presets">
          {(
            [
              'none',
              'warm',
              'cool',
              'grayscale',
              'noir',
              'sepia',
              'vintage',
              'fade',
              'chrome',
              'pastel',
              'stark',
              'wash',
              'sepiaBlues',
              'sepiaColor',
              'sepiaRust',
              'invert',
            ] as const
          ).map((preset) => (
            <button
              type="button"
              key={preset}
              aria-pressed={doc.effects.preset === preset}
              data-testid={`native-filter-preset-${preset}`}
              onClick={() =>
                engine.commit({ ...doc, effects: { ...doc.effects, preset } })
              }
            >
              <FilterPreview
                engine={engine}
                preset={preset}
                revision={state.sourceRevision}
              />
              <span>{t(`filters.${preset}`)}</span>
            </button>
          ))}
        </div>
      </>
    );
  if (doc && tool === 'adjust')
    controls = (
      <>
        {(
          [
            'brightness',
            'contrast',
            'exposure',
            'saturation',
            'temperature',
            'clarity',
            'gamma',
            'vignette',
          ] as const
        ).map((key) => (
          <SliderField
            key={key}
            label={t(`filters.${key}`)}
            value={doc.effects[key]}
            min={-100}
            max={100}
            testId={`native-filter-${key}`}
            onChange={(value) =>
              engine.preview({
                ...doc,
                effects: { ...doc.effects, [key]: value },
              })
            }
            {...gesture}
          />
        ))}
        <button
          type="button"
          onClick={() =>
            engine.commit({
              ...doc,
              effects: { ...DEFAULT_EFFECTS, preset: doc.effects.preset },
            })
          }
        >
          {t('actions.reset')}
        </button>
      </>
    );
  if (doc && tool === 'stickers')
    controls = (
      <>
        <button
          type="button"
          className="rie-primary"
          disabled={adding}
          data-testid="native-sticker-upload"
          onClick={() => uploadField.current?.click()}
        >
          <Icon name="upload" />
          {t(adding ? 'status.adding_image' : 'stickers.upload')}
        </button>
        <p className="rie-help">{t('stickers.hint')}</p>
        <div className="rie-symbols" aria-label={t('stickers.symbols')}>
          {[
            ['★', 'star'],
            ['♥', 'heart'],
            ['✓', 'check'],
            ['✦', 'spark'],
          ].map(([symbol, key]) => (
            <button
              type="button"
              key={key}
              aria-label={t(`stickers.${key}`)}
              title={t(`stickers.${key}`)}
              onClick={() => addSymbol(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
        {layer ? selectedControls : null}
      </>
    );
  if (doc && tool === 'frame')
    controls = (
      <>
        <div className="rie-frame-presets" aria-label={t('frame.style')}>
          {(
            [
              'none',
              'solid',
              'inset',
              'double',
              'mat',
              'polaroid',
              'bevel',
              'hooks',
              'cross',
              'edge',
            ] as const
          ).map((style) => (
            <button
              type="button"
              key={style}
              aria-pressed={doc.frame.style === style}
              data-testid={`native-frame-${style}`}
              onClick={() =>
                engine.commit({
                  ...doc,
                  frame: {
                    ...doc.frame,
                    style,
                    width:
                      doc.frame.width ||
                      Math.max(
                        8,
                        Math.round(Math.min(doc.width, doc.height) * 0.04)
                      ),
                  },
                })
              }
            >
              <span className="rie-frame-preview" data-frame={style} />
              <span>{t(`frame.${style}`)}</span>
            </button>
          ))}
        </div>
        {doc.frame.style !== 'none' ? (
          <>
            <ColorField
              label={t('draw.color')}
              value={doc.frame.color}
              onChange={(color) =>
                engine.commit({ ...doc, frame: { ...doc.frame, color } })
              }
            />
            <SliderField
              label={t('frame.width')}
              value={doc.frame.width}
              min={1}
              max={Math.floor(Math.min(doc.width, doc.height) / 3)}
              suffix=" px"
              onChange={(width) =>
                engine.preview({ ...doc, frame: { ...doc.frame, width } })
              }
              {...gesture}
            />
          </>
        ) : null}
        {state.options.features?.imageEditor?.tools?.corners !== false ? (
          <SliderField
            label={t('frame.corners')}
            value={doc.cornerRadius}
            min={0}
            max={Math.floor(Math.min(doc.width, doc.height) / 2)}
            suffix=" px"
            testId="native-frame-corners"
            onChange={(cornerRadius) =>
              engine.preview({ ...doc, cornerRadius })
            }
            {...gesture}
          />
        ) : null}
        <button
          type="button"
          onClick={() =>
            engine.commit({ ...doc, frame: DEFAULT_FRAME, cornerRadius: 0 })
          }
        >
          {t('actions.reset')}
        </button>
      </>
    );
  if (doc && tool === 'fill')
    controls = (
      <>
        <p className="rie-help">{t('fill.hint')}</p>
        <ColorField
          label={t('draw.color')}
          value={doc.background}
          onChange={(background) => engine.commit({ ...doc, background })}
        />
        <button
          type="button"
          aria-pressed={doc.background === 'transparent'}
          data-testid="native-fill-transparent"
          onClick={() => engine.commit({ ...doc, background: 'transparent' })}
        >
          <span className="rie-transparent-preview" />
          {t('fill.transparent')}
        </button>
      </>
    );
  if (tool === 'redact')
    controls = (
      <>
        <div className="rie-grid">
          {(['pixelate', 'blur', 'solid'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={redaction.mode === mode}
              onClick={() => {
                setRedaction({ ...redaction, mode });
                if (layer?.kind === 'redaction')
                  changeLayer({ redactionMode: mode });
              }}
            >
              {t(`redact.${mode}`)}
            </button>
          ))}
        </div>
        <SliderField
          label={t('redact.size')}
          value={
            layer?.kind === 'redaction'
              ? (layer.redactionSize ?? redaction.size)
              : redaction.size
          }
          min={2}
          max={80}
          onChange={(size) => {
            setRedaction({ ...redaction, size });
            if (layer?.kind === 'redaction')
              previewLayer({ redactionSize: size });
          }}
          {...gesture}
        />
        <p className="rie-help">{t('redact.hint')}</p>
        {layer?.kind === 'redaction' ? selectedControls : null}
      </>
    );
  if (tool === 'select')
    controls = (
      <>
        {selectedControls}
        {doc?.layers.length ? (
          <div className="rie-layer-list">
            <h3>{t('selection.layers')}</h3>
            <div className="rie-row">
              <button
                type="button"
                aria-pressed={multiSelect}
                onClick={() => setMultiSelect(!multiSelect)}
              >
                {t('selection.multiple')}
              </button>
              <button
                type="button"
                onClick={() => {
                  engine.selectMany(doc.layers.map((item) => item.id));
                  setMultiSelect(true);
                }}
              >
                {t('selection.all')}
              </button>
            </div>
            {[...doc.layers].reverse().map((item) => (
              <div className="rie-layer-row" key={item.id}>
                <button
                  type="button"
                  key={item.id}
                  disabled={item.locked || item.hidden}
                  aria-pressed={selectedIds.includes(item.id)}
                  onClick={(event) =>
                    multiSelect ||
                    event.shiftKey ||
                    event.ctrlKey ||
                    event.metaKey
                      ? engine.toggleSelection(item.id)
                      : engine.select(item.id)
                  }
                >
                  <Icon
                    name={
                      item.kind === 'image'
                        ? 'stickers'
                        : item.kind === 'path'
                          ? 'draw'
                          : item.kind === 'redaction'
                            ? 'redact'
                            : item.kind
                    }
                  />
                  <span>
                    {item.kind === 'text'
                      ? item.text
                      : t(
                          item.kind === 'image' || item.kind === 'path'
                            ? `selection.${item.kind}`
                            : item.kind === 'redaction'
                              ? 'tools.redact'
                              : `shapes.${item.kind}`
                        )}
                  </span>
                </button>
                <button
                  type="button"
                  className="rie-icon-button"
                  aria-label={t('selection.locked')}
                  title={t('selection.locked')}
                  aria-pressed={!!item.locked}
                  onClick={() =>
                    engine.commit(
                      updateLayer(doc, item.id, { locked: !item.locked })
                    )
                  }
                >
                  <Icon name={item.locked ? 'lock' : 'unlock'} />
                </button>
                <button
                  type="button"
                  className="rie-icon-button"
                  aria-label={t('selection.hidden')}
                  title={t('selection.hidden')}
                  aria-pressed={!!item.hidden}
                  onClick={() =>
                    engine.commit(
                      updateLayer(doc, item.id, { hidden: !item.hidden })
                    )
                  }
                >
                  <Icon name="hidden" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  return (
    <div
      ref={shell}
      className="rie-theme"
      data-testid="image-editor-theme"
      data-theme={state.options.theme ?? 'light'}
      data-scheme={state.options.theme ?? 'light'}
      lang={state.options.locale ?? 'en'}
      onKeyDown={(event) => {
        if (
          disabled ||
          (event.target as HTMLElement).matches(
            'input,textarea,select,[contenteditable="true"]'
          )
        )
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) engine.redo();
          else engine.undo();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'y'
        ) {
          event.preventDefault();
          engine.redo();
        }
        if (event.key === 'Escape' && tool === 'crop') {
          cancelCrop();
        }
        if (event.key === 'Escape') {
          setCompare(false);
          setExportOpen(false);
          setHelpOpen(false);
        }
      }}
    >
      <div
        className="rie-toolbar"
        role="toolbar"
        aria-label={t('toolbar.label')}
      >
        <div className="rie-toolbar-group">
          {iconButton(
            'undo',
            'toolbar.undo',
            () => engine.undo(),
            !state.canUndo
          )}
          {iconButton(
            'redo',
            'toolbar.redo',
            () => engine.redo(),
            !state.canRedo
          )}
          <button
            type="button"
            className="rie-icon-button"
            aria-label={t('toolbar.reset')}
            title={t('toolbar.reset')}
            disabled={disabled || !engine.hasChanges()}
            onClick={() => {
              surface.current?.cancel();
              engine.revert();
              setTool('select');
              setPanel(false);
              setCompare(false);
            }}
          >
            <Icon name="reset" />
          </button>
        </div>
        <div className="rie-toolbar-group rie-toolbar-secondary">
          <button
            type="button"
            className="rie-icon-button"
            data-testid="native-compare"
            aria-label={t('toolbar.compare')}
            title={t('toolbar.compare')}
            aria-pressed={compare}
            disabled={disabled}
            onClick={() => {
              surface.current?.cancel();
              setCompare(!compare);
            }}
          >
            <Icon name="compare" />
          </button>
          <button
            type="button"
            className="rie-icon-button"
            data-testid="native-export-settings"
            aria-label={t('export.title')}
            title={t('export.title')}
            aria-expanded={exportOpen}
            disabled={disabled}
            onClick={() => {
              setExportOpen(!exportOpen);
              setHelpOpen(false);
            }}
          >
            <Icon name="export" />
          </button>
        </div>
        {state.options.showActions !== false ? (
          <div className="rie-toolbar-group rie-toolbar-actions">
            <button type="button" disabled={disabled} onClick={onCancel}>
              {t('toolbar.cancel')}
            </button>
            <button
              type="button"
              className="rie-primary"
              disabled={disabled}
              onClick={() => void save()}
            >
              <Icon name="save" />
              {t('toolbar.save')}
            </button>
          </div>
        ) : null}
      </div>
      {exportOpen ? (
        <div className="rie-export-panel" data-testid="native-export-panel">
          <div className="rie-row" role="group" aria-label={t('export.format')}>
            {(['image/png', 'image/jpeg', 'image/webp'] as const).map(
              (type) => (
                <button
                  type="button"
                  key={type}
                  aria-pressed={
                    (state.options.export?.type ?? 'image/png') === type
                  }
                  onClick={() =>
                    engine.updateOptions({
                      export: { ...state.options.export, type },
                    })
                  }
                >
                  {type.slice(6).toUpperCase()}
                </button>
              )
            )}
          </div>
          {(state.options.export?.type ?? 'image/png') !== 'image/png' ? (
            <SliderField
              label={t('export.quality')}
              min={1}
              max={100}
              value={Math.round((state.options.export?.quality ?? 0.92) * 100)}
              suffix="%"
              onChange={(quality) =>
                engine.updateOptions({
                  export: { ...state.options.export, quality: quality / 100 },
                })
              }
            />
          ) : null}
          {iconButton('close', 'toolbar.close', () => setExportOpen(false))}
        </div>
      ) : null}
      {helpOpen ? (
        <p className="rie-help rie-shortcuts">
          {t('canvas.instructions')} {t('canvas.edit_text_hint')}
        </p>
      ) : null}
      <input
        hidden
        ref={uploadField}
        type="file"
        accept="image/*"
        data-testid="native-sticker-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) void importImage(file);
        }}
      />
      {error ? (
        <p role="alert" className="rie-error">
          {error}
        </p>
      ) : null}
      <div
        className="rie-body"
        data-testid="native-editor"
        data-ready={state.phase === 'ready'}
        data-dock={state.options.features?.imageEditor?.dock ?? 'left'}
      >
        <div className="rie-nav-wrap" data-horizontal={overflow.horizontal}>
          <nav
            ref={nav}
            onScroll={measureNav}
            className="rie-nav"
            data-testid="native-tool-nav"
            aria-label={t('toolbar.label')}
          >
            {toolNames
              .filter(
                (name) =>
                  state.options.features?.imageEditor?.tools?.[name] !== false
              )
              .map((name) => (
                <button
                  type="button"
                  key={name}
                  data-testid={`native-tool-${name}`}
                  disabled={disabled}
                  aria-pressed={tool === name}
                  onClick={() => {
                    choose(name);
                    if (name === 'select') setPanel(true);
                  }}
                >
                  <Icon name={name} />
                  <span>{t(`tools.${name}`)}</span>
                </button>
              ))}
          </nav>
          {overflow.before ? (
            <button
              type="button"
              className="rie-nav-scroll rie-nav-previous"
              aria-label={t('toolbar.previous_tools')}
              title={t('toolbar.previous_tools')}
              onClick={() =>
                nav.current?.scrollBy({
                  left: overflow.horizontal ? -180 : 0,
                  top: overflow.horizontal ? 0 : -180,
                  behavior: 'smooth',
                })
              }
            >
              <Icon name="chevron_down" />
            </button>
          ) : null}
          {overflow.after ? (
            <button
              type="button"
              className="rie-nav-scroll rie-nav-next"
              aria-label={t('toolbar.more_tools')}
              title={t('toolbar.more_tools')}
              onClick={() =>
                nav.current?.scrollBy({
                  left: overflow.horizontal ? 180 : 0,
                  top: overflow.horizontal ? 0 : 180,
                  behavior: 'smooth',
                })
              }
            >
              <Icon name="chevron_down" />
            </button>
          ) : null}
        </div>
        {panel || (tool === 'select' && layer) ? (
          <section
            className="rie-options"
            data-testid="native-tool-options"
            aria-label={t(`tools.${tool}`)}
          >
            <div className="rie-options-heading">
              <h2>{t(`tools.${tool}`)}</h2>
              {tool === 'crop' ? (
                <div className="rie-crop-heading-actions">
                  <button
                    type="button"
                    className="rie-icon-button"
                    aria-label={t('crop.cancel')}
                    title={t('crop.cancel')}
                    data-testid="native-crop-cancel"
                    onClick={cancelCrop}
                  >
                    <Icon name="close" />
                  </button>
                  <button
                    type="button"
                    className="rie-primary"
                    data-testid="native-crop-apply"
                    onClick={closePanel}
                  >
                    <Icon name="check" />
                    {t('actions.apply')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rie-icon-button"
                  aria-label={t('toolbar.close_tool_panel')}
                  title={t('toolbar.close_tool_panel')}
                  onClick={closePanel}
                  disabled={disabled}
                  data-testid="native-tool-options-close"
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
            <div className="rie-options-content">{controls}</div>
          </section>
        ) : null}
        {doc ? (
          <CanvasSurface
            ref={surface}
            engine={engine}
            doc={doc}
            selected={state.selected}
            selectedIds={selectedIds}
            tool={tool}
            brush={brush}
            crop={crop}
            cropRatio={ratio}
            cropOptions={cropOptions}
            onCrop={setCrop}
            onText={editText}
            renderTextInput={renderTextInput}
            onTextEditor={onTextEditor}
            onTextSelectionChange={onTextSelection}
            compare={compare}
            onViewChange={setView}
            onCropApply={closePanel}
            onCropCancel={cancelCrop}
            shape={shape}
            onPathStateChange={setPathState}
            redaction={redaction}
            onImportImage={
              state.options.features?.imageEditor?.tools?.stickers === false
                ? undefined
                : (file) => void importImage(file)
            }
            t={t}
          />
        ) : (
          <div className="rie-canvas-wrap" />
        )}
      </div>
      <div className="rie-statusbar">
        <div className="rie-status-context">
          <span className="rie-dimensions" aria-label={t('toolbar.dimensions')}>
            {doc ? `${doc.width} × ${doc.height}` : ''}
          </span>
          {compare ? (
            <span className="rie-original-label">{t('toolbar.original')}</span>
          ) : (
            <span className="rie-tool-hint">
              {tool === 'crop' && cropOptions.interactionFocus === 'image'
                ? t('crop.image_hint')
                : pathState.editing
                  ? t('path.edit_hint')
                  : tool === 'shapes' && shape === 'path'
                    ? t('path.draw_hint')
                    : [
                          'crop',
                          'draw',
                          'text',
                          'shapes',
                          'redact',
                          'stickers',
                        ].includes(tool)
                      ? t(`${tool === 'text' ? 'text' : tool}.hint`)
                      : ''}
            </span>
          )}
        </div>
        <div className="rie-toolbar-group">
          <button
            type="button"
            className="rie-icon-button"
            aria-label={t('toolbar.zoom_out')}
            title={t('toolbar.zoom_out')}
            disabled={disabled}
            onClick={() => surface.current?.zoom(0.8)}
          >
            <Icon name="zoom_out" />
          </button>
          <button
            type="button"
            className="rie-zoom-level"
            title={t('toolbar.actual_size')}
            aria-label={`${t('toolbar.actual_size')}: ${Math.round(view.zoom * 100)}%`}
            onClick={() => surface.current?.actualSize()}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button
            type="button"
            className="rie-icon-button"
            aria-label={t('toolbar.zoom_in')}
            title={t('toolbar.zoom_in')}
            disabled={disabled}
            onClick={() => surface.current?.zoom(1.25)}
          >
            <Icon name="zoom_in" />
          </button>
          <button
            type="button"
            className="rie-icon-button"
            aria-label={t('toolbar.fit_to_screen')}
            title={t('toolbar.fit_to_screen')}
            disabled={disabled}
            onClick={() => surface.current?.fit()}
          >
            <Icon name="fit_to_screen" />
          </button>
          <button
            type="button"
            className="rie-icon-button rie-help-button"
            aria-label={t('toolbar.shortcuts')}
            title={t('toolbar.shortcuts')}
            aria-expanded={helpOpen}
            onClick={() => {
              setHelpOpen(!helpOpen);
              setExportOpen(false);
            }}
          >
            <Icon name="help" />
          </button>
        </div>
      </div>
    </div>
  );
}
