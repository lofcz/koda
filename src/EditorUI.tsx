import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CanvasEngine, EngineState } from './engine';
import { CanvasSurface, SurfaceActions } from './CanvasSurface';
import {
  cropDocument,
  DEFAULT_EFFECTS,
  DEFAULT_FRAME,
  duplicateLayer,
  Effects,
  flipDocument,
  flipLayer,
  ImageDocument,
  Layer,
  multiply,
  Rect,
  resizeDocument,
  rotateDocument,
  rotateLayer,
  reorderLayer,
  scale,
  ShapeKind,
  straightenDocument,
  translate,
  updateLayer,
} from './model';
import { filterPixels, textSize } from './render';
import { Icon } from './icons';
import { translator } from './locale';
import type { EditorTool, ImageEditorProps } from './types';

function NumberField({
  label,
  value,
  onCommit,
  testId,
  min = 1,
  max = 8192,
}: {
  label: string;
  value: number;
  onCommit(value: number): void;
  testId?: string;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = String(Math.round(value * 100) / 100);
  }, [value]);
  return (
    <label className="rie-label">
      <span>{label}</span>
      <input
        ref={ref}
        type="number"
        defaultValue={Math.round(value * 100) / 100}
        min={min}
        max={max}
        data-testid={testId}
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
          else event.currentTarget.value = String(value);
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
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <fieldset className="rie-color-field">
      <legend>{label}</legend>
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
            aria-pressed={value.toLowerCase() === color}
            onClick={() => onChange(color)}
          />
        ))}
        <input
          aria-label={label}
          type="color"
          value={value === 'transparent' ? '#0797a7' : value}
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
}: {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange(value: string): void;
  t(key: string): string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null),
    id = useId();
  const filtered = choices.filter((item) =>
    item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
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
          {choices.find((item) => item.value === value)?.label ?? value}
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
            {filtered.map((item) => (
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
}: {
  engine: CanvasEngine;
  state: EngineState;
  onSave: ImageEditorProps['onSave'];
  onCancel: ImageEditorProps['onCancel'];
  onError: ImageEditorProps['onError'];
}) {
  const doc = state.document,
    t = translator(state.options),
    shell = useRef<HTMLDivElement>(null),
    nav = useRef<HTMLElement>(null),
    surface = useRef<SurfaceActions>(null),
    textField = useRef<HTMLTextAreaElement>(null),
    uploadField = useRef<HTMLInputElement>(null),
    straightening = useRef<ImageDocument | null>(null);
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
    [shape, setShape] = useState<ShapeKind | null>(null),
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
      element.dataset.short = String(entry.contentRect.height < 330);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 1, height: 1 }),
    [ratio, setRatio] = useState<number | null>(null);
  const [brush, setBrush] = useState<{
    color: string;
    size: number;
    mode: 'brush' | 'highlighter' | 'eraser';
    opacity: number;
  }>({ color: '#e5484d', size: 8, mode: 'brush', opacity: 1 });
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  useLayoutEffect(
    () =>
      engine.beforeExport(
        tool === 'crop' && doc
          ? () => {
              engine.commit(cropDocument(doc, crop));
              setTool('select');
              setPanel(false);
            }
          : null
      ),
    [engine, tool, doc, crop]
  );
  const disabled = state.phase !== 'ready' || saving;
  const layer = doc?.layers.find((item) => item.id === state.selected);
  const fullCrop = () =>
    doc
      ? { x: 0, y: 0, width: doc.width, height: doc.height }
      : { x: 0, y: 0, width: 1, height: 1 };
  const applyCrop = () => {
    if (!doc) return null;
    const next = tool === 'crop' ? cropDocument(doc, crop) : doc;
    engine.commit(next);
    return next;
  };
  const choose = (next: EditorTool) => {
    if (disabled) return;
    const current = tool === 'crop' ? applyCrop() : doc;
    if (next === 'crop' && current) {
      setCrop({ x: 0, y: 0, width: current.width, height: current.height });
      setRatio(null);
    }
    setTool(next);
    setPanel(next !== 'select');
    setCompare(false);
    setError('');
  };
  const closePanel = () => {
    if (tool === 'crop') applyCrop();
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
    if (!doc || !layer || layer.kind !== 'text') return;
    const item = { ...layer, ...patch };
    const size = textSize(
      item.text ?? '',
      item.fontSize ?? 40,
      item.fontFamily ?? 'sans-serif',
      item.bold,
      item.italic,
      item.lineHeight
    );
    const next = updateLayer(doc, layer.id, { ...patch, ...size });
    if (preview) engine.preview(next);
    else engine.commit(next);
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
    if (!doc) return;
    setRatio(value);
    if (!value) {
      setCrop(fullCrop());
      return;
    }
    const width = Math.min(doc.width, doc.height * value),
      height = width / value;
    setCrop({
      x: (doc.width - width) / 2,
      y: (doc.height - height) / 2,
      width,
      height,
    });
  };
  const rotate = (clockwise: boolean) => {
    const current = applyCrop();
    if (!current) return;
    const next = rotateDocument(current, clockwise);
    engine.commit(next);
    setCrop({ x: 0, y: 0, width: next.width, height: next.height });
    if (ratio) setRatio(1 / ratio);
  };
  const flip = (horizontal: boolean) => {
    const current = applyCrop();
    if (!current) return;
    engine.commit(flipDocument(current, horizontal));
    setCrop({ x: 0, y: 0, width: current.width, height: current.height });
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
    setTool('select');
    setPanel(false);
  };
  const endStraighten = () => {
    if (!straightening.current) return;
    engine.end();
    straightening.current = null;
    setAngle(0);
  };
  const save = async () => {
    if (disabled) return;
    if (tool === 'crop') applyCrop();
    setSaving(true);
    try {
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
  const selectedControls =
    layer && doc ? (
      <div className="rie-stack" data-testid="native-selection-controls">
        <div className="rie-row">
          {iconButton('duplicate', 'actions.duplicate', () => {
            const next = duplicateLayer(doc, layer.id);
            engine.commit(next);
            engine.select(
              next.layers.find(
                (item) =>
                  !doc.layers.some((existing) => existing.id === item.id)
              )?.id ?? null
            );
          })}
          {iconButton('forward', 'actions.forward', () => reorder(1))}
          {iconButton('backward', 'actions.backward', () => reorder(-1))}
          {iconButton('delete', 'actions.delete', () =>
            engine.removeSelected()
          )}
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
        {layer.kind !== 'image' ? (
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
        {!['path', 'text', 'line', 'arrow', 'image', 'redaction'].includes(
          layer.kind
        ) ? (
          <>
            <ColorField
              label={t('shapes.fill')}
              value={layer.fill}
              onChange={(fill) => changeLayer({ fill })}
            />
            <button
              type="button"
              aria-pressed={layer.fill === 'transparent'}
              onClick={() =>
                changeLayer({
                  fill:
                    layer.fill === 'transparent' ? '#0797a7' : 'transparent',
                })
              }
            >
              {t('shapes.transparent')}
            </button>
          </>
        ) : null}
        {['line', 'arrow'].includes(layer.kind) ? (
          <div className="rie-grid">
            {(['arrowStart', 'arrowEnd'] as const).map((key) => (
              <ChoicePicker
                key={key}
                label={t(
                  key === 'arrowStart'
                    ? 'shapes.arrow_start'
                    : 'shapes.arrow_end'
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
      </div>
    ) : (
      <p className="rie-help">{t('selection.hint')}</p>
    );
  let controls: React.ReactNode = null;
  if (doc && tool === 'crop')
    controls = (
      <>
        <div className="rie-ratios" aria-label={t('crop.aspect_ratio')}>
          {[
            [null, 'crop.aspect_free'],
            [doc.width / doc.height, 'crop.aspect_original'],
            [1, 'crop.aspect_square'],
            [4 / 3, '4:3'],
            [16 / 9, '16:9'],
            [3 / 4, '3:4'],
            [9 / 16, '9:16'],
            [3 / 2, '3:2'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={String(label)}
              aria-pressed={ratio === value}
              onClick={() => presetRatio(value as number | null)}
            >
              <span
                aria-hidden="true"
                className="rie-ratio-outline"
                style={{ aspectRatio: value || 1.45 }}
              />
              {String(label).startsWith('crop.') ? t(String(label)) : label}
            </button>
          ))}
        </div>
        <SliderField
          label={t('crop.straighten')}
          value={angle}
          min={-45}
          max={45}
          step={0.5}
          suffix="°"
          testId="native-crop-straighten"
          onStart={() => {
            if (!straightening.current) {
              straightening.current = applyCrop();
              engine.begin();
            }
          }}
          onChange={(value) => {
            const base = straightening.current ?? doc;
            if (!straightening.current) {
              straightening.current = base;
              engine.begin();
            }
            const next = straightenDocument(base, value);
            engine.preview(next);
            setAngle(value);
            setCrop({ x: 0, y: 0, width: next.width, height: next.height });
          }}
          onEnd={endStraighten}
        />
        <div className="rie-grid">
          <NumberField
            label={t('crop.region_x')}
            value={crop.x}
            min={0}
            max={doc.width - 1}
            onCommit={(x) =>
              setCrop({
                ...crop,
                x,
                width: Math.min(crop.width, doc.width - x),
              })
            }
          />
          <NumberField
            label={t('crop.region_y')}
            value={crop.y}
            min={0}
            max={doc.height - 1}
            onCommit={(y) =>
              setCrop({
                ...crop,
                y,
                height: Math.min(crop.height, doc.height - y),
              })
            }
          />
          <NumberField
            label={t('resize.width')}
            value={crop.width}
            max={doc.width - crop.x}
            onCommit={(width) => {
              const w = ratio
                ? Math.min(width, (doc.height - crop.y) * ratio)
                : width;
              setCrop({
                ...crop,
                width: w,
                height: ratio ? w / ratio : crop.height,
              });
            }}
          />
          <NumberField
            label={t('resize.height')}
            value={crop.height}
            max={doc.height - crop.y}
            onCommit={(height) => {
              const h = ratio
                ? Math.min(height, (doc.width - crop.x) / ratio)
                : height;
              setCrop({
                ...crop,
                height: h,
                width: ratio ? h * ratio : crop.width,
              });
            }}
          />
        </div>
        <div className="rie-row" aria-label={t('crop.rotate_flip')}>
          {iconButton('rotate_left', 'rotate.rotate_left', () => rotate(false))}
          {iconButton('rotate_right', 'rotate.rotate_right', () =>
            rotate(true)
          )}
          {iconButton('flip_horizontal', 'rotate.flip_horizontal', () =>
            flip(true)
          )}
          {iconButton('flip_vertical', 'rotate.flip_vertical', () =>
            flip(false)
          )}
        </div>
        <div className="rie-row rie-actions-row">
          <button type="button" onClick={cancelCrop}>
            {t('crop.cancel')}
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
      </>
    );
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
  if (tool === 'text')
    controls = (
      <>
        <button
          type="button"
          className="rie-primary"
          data-testid="native-text-add"
          onClick={addText}
        >
          <Icon name="text" />
          {t('text.add')}
        </button>
        {layer?.kind === 'text' ? (
          <>
            <label className="rie-label">
              <span>{t('text.content')}</span>
              <textarea
                ref={textField}
                data-testid="native-text-content"
                value={layer.text ?? ''}
                onFocus={() => engine.begin()}
                onBlur={() => engine.end()}
                onChange={(event) =>
                  changeText({ text: event.target.value }, true)
                }
              />
            </label>
            <NumberField
              label={t('text.font_size')}
              value={layer.fontSize ?? 40}
              max={1000}
              testId="native-text-size"
              onCommit={(fontSize) => changeText({ fontSize })}
            />
            <ChoicePicker
              label={t('text.font_family')}
              value={layer.fontFamily ?? 'sans-serif'}
              choices={[
                { value: 'sans-serif', label: t('text.sans') },
                { value: 'serif', label: t('text.serif') },
                { value: 'monospace', label: t('text.mono') },
                { value: 'Arial, sans-serif', label: 'Arial' },
                { value: 'Georgia, serif', label: 'Georgia' },
                { value: 'Verdana, sans-serif', label: 'Verdana' },
                { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
              ]}
              onChange={(fontFamily) => changeText({ fontFamily })}
              t={t}
            />
            <div className="rie-row">
              <button
                type="button"
                aria-pressed={!!layer.bold}
                onClick={() => changeText({ bold: !layer.bold })}
              >
                {t('text.bold')}
              </button>
              <button
                type="button"
                aria-pressed={!!layer.italic}
                onClick={() => changeText({ italic: !layer.italic })}
              >
                {t('text.italic')}
              </button>
              <button
                type="button"
                aria-pressed={!!layer.underline}
                onClick={() => changeText({ underline: !layer.underline })}
              >
                {t('text.underline')}
              </button>
            </div>
            <div className="rie-row">
              {(['left', 'center', 'right'] as const).map((textAlign) => (
                <button
                  key={textAlign}
                  type="button"
                  className="rie-icon-button"
                  aria-label={t(`text.align_${textAlign}`)}
                  title={t(`text.align_${textAlign}`)}
                  aria-pressed={(layer.textAlign ?? 'left') === textAlign}
                  onClick={() => changeText({ textAlign })}
                >
                  <Icon name={`align_${textAlign}`} />
                </button>
              ))}
            </div>
            <SliderField
              label={t('text.line_height')}
              min={0.8}
              max={2.4}
              step={0.1}
              value={layer.lineHeight ?? 1.2}
              onChange={(lineHeight) => changeText({ lineHeight }, true)}
              {...gesture}
            />
            {selectedControls}
          </>
        ) : null}
      </>
    );
  if (tool === 'shapes')
    controls = (
      <>
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
                revision={state.imageRevision}
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
            {[...doc.layers].reverse().map((item) => (
              <div className="rie-layer-row" key={item.id}>
                <button
                  type="button"
                  key={item.id}
                  disabled={item.locked || item.hidden}
                  aria-pressed={item.id === state.selected}
                  onClick={() => engine.select(item.id)}
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
              {iconButton(
                'close',
                'toolbar.close_tool_panel',
                closePanel,
                false,
                'native-tool-options-close'
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
            tool={tool}
            brush={brush}
            crop={crop}
            cropRatio={ratio}
            onCrop={setCrop}
            onText={editText}
            compare={compare}
            onViewChange={setView}
            onCropApply={closePanel}
            onCropCancel={cancelCrop}
            shape={shape}
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
              {[
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
