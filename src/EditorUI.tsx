import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CanvasEngine, EngineState } from './engine';
import { CanvasSurface, SurfaceActions } from './CanvasSurface';
import {
  clamp,
  cropDocument,
  DEFAULT_EFFECTS,
  flipDocument,
  Layer,
  multiply,
  Rect,
  resizeDocument,
  rotateDocument,
  rotateLayer,
  scale,
  ShapeKind,
  translate,
  updateLayer,
} from './model';
import { textSize } from './render';
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
    <label className="rie-label">
      <span>{label}</span>
      <input
        type="color"
        value={value === 'transparent' ? '#0797a7' : value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  testId,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  testId?: string;
}) {
  return (
    <label className="rie-label">
      <span>
        {label}
        <output>{value}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
const toolNames: EditorTool[] = [
  'select',
  'filter',
  'crop',
  'resize',
  'draw',
  'text',
  'shapes',
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
    surface = useRef<SurfaceActions>(null),
    textField = useRef<HTMLTextAreaElement>(null);
  const [tool, setTool] = useState<EditorTool>('select'),
    [panel, setPanel] = useState(false),
    [locked, setLocked] = useState(true);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 1, height: 1 }),
    [ratio, setRatio] = useState<number | null>(null);
  const [brush, setBrush] = useState<{
    color: string;
    size: number;
    mode: 'brush' | 'highlighter' | 'eraser';
  }>({ color: '#e5484d', size: 8, mode: 'brush' });
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
    setError('');
  };
  const closePanel = () => {
    if (tool === 'crop') applyCrop();
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
  const addShape = (kind: ShapeKind) => {
    if (!doc) return;
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
    requestAnimationFrame(() => textField.current?.focus());
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
  };
  const changeText = (patch: Partial<Layer>, preview = false) => {
    if (!doc || !layer || layer.kind !== 'text') return;
    const item = { ...layer, ...patch };
    const size = textSize(
      item.text ?? '',
      item.fontSize ?? 40,
      item.fontFamily ?? 'sans-serif',
      item.bold,
      item.italic
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
  };
  const flip = (horizontal: boolean) => {
    const current = applyCrop();
    if (!current) return;
    engine.commit(flipDocument(current, horizontal));
    setCrop({ x: 0, y: 0, width: current.width, height: current.height });
  };
  const reorder = (direction: number) => {
    if (!doc || !layer) return;
    const layers = [...doc.layers],
      index = layers.indexOf(layer),
      target = clamp(index + direction, 0, layers.length - 1);
    layers.splice(index, 1);
    layers.splice(target, 0, layer);
    engine.commit({ ...doc, layers });
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
            const copy = {
              ...layer,
              id: crypto.randomUUID(),
              matrix: multiply(translate(12, 12), layer.matrix),
            };
            engine.commit({ ...doc, layers: [...doc.layers, copy] });
            engine.select(copy.id);
          })}
          {iconButton('forward', 'actions.forward', () => reorder(1))}
          {iconButton('backward', 'actions.backward', () => reorder(-1))}
          {iconButton('delete', 'actions.delete', () =>
            engine.removeSelected()
          )}
        </div>
        <ColorField
          label={t('draw.color')}
          value={layer.color}
          onChange={(color) => changeLayer({ color })}
        />
        {layer.kind !== 'text' ? (
          <NumberField
            label={t('shapes.stroke_width')}
            value={layer.strokeWidth}
            min={0}
            max={300}
            onCommit={(strokeWidth) => changeLayer({ strokeWidth })}
          />
        ) : null}
        {!['path', 'text', 'line', 'arrow'].includes(layer.kind) ? (
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
        <SliderField
          label={t('draw.opacity')}
          value={Math.round(layer.opacity * 100)}
          onChange={(opacity) => changeLayer({ opacity: opacity / 100 })}
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
        <div className="rie-row" aria-label={t('crop.aspect_ratio')}>
          {[
            [null, 'crop.aspect_free'],
            [doc.width / doc.height, 'crop.aspect_original'],
            [1, 'crop.aspect_square'],
            [4 / 3, '4:3'],
            [16 / 9, '16:9'],
            [3 / 4, '3:4'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={String(label)}
              aria-pressed={ratio === value}
              onClick={() => presetRatio(value as number | null)}
            >
              {String(label).startsWith('crop.') ? t(String(label)) : label}
            </button>
          ))}
        </div>
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
            onCommit={(width) => setCrop({ ...crop, width })}
          />
          <NumberField
            label={t('resize.height')}
            value={crop.height}
            max={doc.height - crop.y}
            onCommit={(height) => setCrop({ ...crop, height })}
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
        <button
          type="button"
          className="rie-primary"
          data-testid="native-crop-apply"
          onClick={closePanel}
        >
          {t('actions.apply')}
        </button>
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
            <label className="rie-label">
              <span>{t('text.font_family')}</span>
              <select
                value={layer.fontFamily ?? 'sans-serif'}
                onChange={(event) =>
                  changeText({ fontFamily: event.target.value })
                }
              >
                <option value="sans-serif">{t('text.sans')}</option>
                <option value="serif">{t('text.serif')}</option>
                <option value="monospace">{t('text.mono')}</option>
              </select>
            </label>
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
            </div>
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
          {(['none', 'grayscale', 'sepia', 'invert', 'vintage'] as const).map(
            (preset) => (
              <button
                type="button"
                key={preset}
                aria-pressed={doc.effects.preset === preset}
                data-testid={`native-filter-preset-${preset}`}
                onClick={() =>
                  engine.commit({ ...doc, effects: { ...doc.effects, preset } })
                }
              >
                {t(`filters.${preset}`)}
              </button>
            )
          )}
        </div>
        {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
          <SliderField
            key={key}
            label={t(`filters.${key}`)}
            value={doc.effects[key]}
            min={-100}
            max={100}
            testId={`native-filter-${key}`}
            onChange={(value) =>
              engine.commit({
                ...doc,
                effects: { ...doc.effects, [key]: value },
              })
            }
          />
        ))}
        <button
          type="button"
          onClick={() => engine.commit({ ...doc, effects: DEFAULT_EFFECTS })}
        >
          {t('actions.reset')}
        </button>
      </>
    );
  if (tool === 'select') controls = selectedControls;
  return (
    <div
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
          setTool('select');
          setPanel(false);
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
          {iconButton(
            'delete',
            'actions.delete',
            () => engine.removeSelected(),
            !layer
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
        <nav
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
        {panel ? (
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
            t={t}
          />
        ) : (
          <div className="rie-canvas-wrap" />
        )}
      </div>
    </div>
  );
}
