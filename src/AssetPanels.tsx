import React, {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CanvasEngine } from './engine';
import {
  applyFrame,
  clamp,
  type BackgroundFit,
  type Frame,
  type ImageDocument,
} from './model';
import {
  DEFAULT_BACKGROUND_IMAGE,
  paintBackgroundImage,
  type ImageEditorBackground,
} from './backgrounds';
import {
  paintImageFrame,
  validSlice,
  type FrameImage,
  type ImageEditorFrame,
  type SliceInsets,
} from './frames';
import {
  DEFAULT_FONTS,
  fontFamilyKey,
  fontRegistry,
  nearestWeight,
  type ImageEditorFont,
} from './fonts';
import { Icon } from './icons';

type T = (key: string) => string;

/* ------------------------------------------------------------------ fonts */

const BUILTIN_FONT_LABELS: Record<string, string> = {
  'sans-serif': 'text.sans',
  serif: 'text.serif',
  monospace: 'text.mono',
};
/** Font choices for the shared searchable picker, each previewed in its own face once loaded. */
export function useFontChoices(fonts: readonly ImageEditorFont[], t: T) {
  useSyncExternalStore(
    fontRegistry.subscribe,
    fontRegistry.getVersion,
    fontRegistry.getVersion
  );
  const choices = fonts.map((font) => {
    const status = fontRegistry.status(font),
      builtin = BUILTIN_FONT_LABELS[font.id];
    return {
      value: font.family,
      label:
        builtin && DEFAULT_FONTS.some((item) => item.family === font.family)
          ? t(builtin)
          : font.label,
      group: font.group,
      // Until the face is ready the label uses the UI font, never a misleading fallback preview.
      style: status === 'loaded' ? { fontFamily: font.family } : undefined,
      status:
        status === 'loading' || status === 'unloaded' ? (
          <span className="rie-font-status" data-status="loading">
            {t('text.font_loading')}
          </span>
        ) : status === 'failed' ? (
          <span
            className="rie-font-status"
            data-status="failed"
            title={t('text.font_failed_hint')}
          >
            {t('text.font_failed')}
          </span>
        ) : undefined,
    };
  });
  return {
    choices,
    /** Load every catalog face so the open list previews them. */
    loadAll: () => {
      for (const font of fonts) void fontRegistry.load(font);
    },
  };
}
/** A family change snaps the weight to one the new font provides. */
export function fontPatch(
  fonts: readonly ImageEditorFont[],
  family: string,
  weight: number | null | undefined
): { fontFamily: string; fontWeight?: number } {
  const font = fonts.find(
    (item) => fontFamilyKey(item.family) === fontFamilyKey(family)
  );
  if (!font?.weights || weight == null) return { fontFamily: family };
  const snapped = nearestWeight(font, weight);
  return snapped === weight
    ? { fontFamily: family }
    : { fontFamily: family, fontWeight: snapped };
}

/* ------------------------------------------------------------ backgrounds */

/** Embed a dropped, pasted or uploaded file as the document background image. */
export async function setBackgroundFromUrl(
  engine: CanvasEngine,
  url: string,
  patch: Partial<NonNullable<ImageDocument['backgroundImage']>> = {},
  cache = false
) {
  const embedded = await engine.embedImage(url, cache),
    doc = engine.getSnapshot().document;
  if (!doc) return;
  engine.commit({
    ...doc,
    backgroundImage: {
      ...DEFAULT_BACKGROUND_IMAGE,
      ...doc.backgroundImage,
      ...patch,
      source: embedded.source,
    },
  });
}
export async function setBackgroundFromFile(engine: CanvasEngine, file: File) {
  const url = URL.createObjectURL(file);
  try {
    await setBackgroundFromUrl(engine, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Natural pixel size; restored assets may be image elements rather than canvases. */
function sourceSize(image: CanvasImageSource) {
  const source = image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width: number;
    height: number;
  };
  return {
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height,
  };
}
function Thumbnail({
  draw,
  width = 64,
  height = 48,
  revision,
}: {
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  width?: number;
  height?: number;
  revision: unknown;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    paint = useRef(draw);
  useEffect(() => {
    paint.current = draw;
  });
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    paint.current(ctx, width, height);
  }, [revision, width, height]);
  return (
    <canvas
      ref={ref}
      width={width * 2}
      height={height * 2}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

const FITS: readonly BackgroundFit[] = [
  'cover',
  'contain',
  'stretch',
  'repeat',
];
const POSITIONS = [
  ['top_left', 0, 0],
  ['top', 0.5, 0],
  ['top_right', 1, 0],
  ['left', 0, 0.5],
  ['center', 0.5, 0.5],
  ['right', 1, 0.5],
  ['bottom_left', 0, 1],
  ['bottom', 0.5, 1],
  ['bottom_right', 1, 1],
] as const;

type CatalogState = Record<string, 'loading' | 'ready' | 'failed'>;
/** Load catalog URLs through the engine once each and track per-item readiness. */
function useCatalogImages(
  engine: CanvasEngine,
  items: readonly { id: string; url: string }[]
) {
  const [state, setState] = useState<{
    status: CatalogState;
    images: Record<string, { source: string; canvas: HTMLCanvasElement }>;
  }>({ status: {}, images: {} });
  const key = items.map((item) => `${item.id}\u0000${item.url}`).join('\n');
  useEffect(() => {
    let live = true;
    for (const item of items) {
      void engine.embedImage(item.url).then(
        (embedded) => {
          if (live)
            setState((current) => ({
              status: { ...current.status, [item.id]: 'ready' },
              images: { ...current.images, [item.id]: embedded },
            }));
        },
        () => {
          if (live)
            setState((current) => ({
              ...current,
              status: { ...current.status, [item.id]: 'failed' },
            }));
        }
      );
    }
    return () => {
      live = false;
    };
    // `key` captures every id/url pair; `items` identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);
  return state;
}

export function BackgroundImageSection({
  engine,
  doc,
  catalog,
  t,
  children,
}: {
  engine: CanvasEngine;
  doc: ImageDocument;
  catalog: readonly ImageEditorBackground[];
  t: T;
  children?: React.ReactNode;
}) {
  const field = useRef<HTMLInputElement>(null),
    id = useId(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const images = useCatalogImages(engine, catalog);
  const background = doc.backgroundImage,
    current = background && engine.assets.get(background.source);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch {
      setError(t('status.import_failed'));
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<NonNullable<typeof background>>) => {
    if (background)
      engine.commit({ ...doc, backgroundImage: { ...background, ...patch } });
  };
  const activeCatalog = catalog.find(
    (item) => images.images[item.id]?.source === background?.source
  );
  return (
    <section
      className="rie-stack rie-asset-section"
      aria-labelledby={`${id}-heading`}
      data-testid="native-fill-image"
    >
      <h3 id={`${id}-heading`} className="rie-section-heading">
        {t('fill.image')}
      </h3>
      {background ? (
        <div className="rie-asset-current">
          <span className="rie-asset-thumb rie-checker">
            <Thumbnail
              revision={`${background.source.length}:${background.source.slice(-32)}:${!!current}`}
              draw={(ctx, width, height) => {
                if (current)
                  paintBackgroundImage(
                    ctx,
                    {
                      ...background,
                      fit: 'cover',
                      position: { x: 0.5, y: 0.5 },
                      opacity: 1,
                    },
                    current,
                    sourceSize(current),
                    { width, height }
                  );
              }}
            />
          </span>
          <span className="rie-asset-name">
            {activeCatalog?.label ?? t('fill.image_custom')}
          </span>
          <button
            type="button"
            className="rie-icon-button"
            aria-label={t('fill.image_remove')}
            title={t('fill.image_remove')}
            data-testid="native-fill-image-remove"
            onClick={() => {
              const { backgroundImage: _removed, ...rest } = doc;
              engine.commit(rest);
            }}
          >
            <Icon name="delete" />
          </button>
        </div>
      ) : null}
      {catalog.length ? (
        <div
          className="rie-asset-grid"
          role="group"
          aria-label={t('fill.image_choices')}
        >
          {catalog.map((item) => {
            const status = images.status[item.id] ?? 'loading',
              image = images.images[item.id];
            return (
              <button
                type="button"
                key={item.id}
                className="rie-asset-option"
                aria-pressed={activeCatalog?.id === item.id}
                aria-busy={status === 'loading' || undefined}
                disabled={status === 'failed' || busy}
                title={
                  status === 'failed' ? t('status.load_failed') : item.label
                }
                data-testid={`native-fill-image-${item.id}`}
                onClick={() =>
                  void run(() =>
                    setBackgroundFromUrl(
                      engine,
                      item.url,
                      {
                        fit: item.fit ?? background?.fit ?? 'cover',
                        ...(item.scale === undefined
                          ? {}
                          : { scale: item.scale }),
                      },
                      true
                    )
                  )
                }
              >
                <span className="rie-asset-thumb rie-checker">
                  {image ? (
                    <Thumbnail
                      width={56}
                      height={40}
                      revision={image.source.length}
                      draw={(ctx, width, height) =>
                        paintBackgroundImage(
                          ctx,
                          {
                            ...DEFAULT_BACKGROUND_IMAGE,
                            fit: item.fit === 'repeat' ? 'repeat' : 'cover',
                            scale: Math.min(
                              1,
                              24 / sourceSize(image.canvas).height
                            ),
                            source: image.source,
                          },
                          image.canvas,
                          sourceSize(image.canvas),
                          { width, height }
                        )
                      }
                    />
                  ) : null}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy}
        data-testid="native-fill-image-upload"
        onClick={() => field.current?.click()}
      >
        <Icon name="upload" />
        {t(
          busy
            ? 'status.adding_image'
            : background
              ? 'fill.image_replace'
              : 'fill.image_upload'
        )}
      </button>
      <input
        hidden
        ref={field}
        type="file"
        accept="image/*"
        data-testid="native-fill-image-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file?.type.startsWith('image/'))
            void run(() => setBackgroundFromFile(engine, file));
        }}
      />
      {error ? (
        <p role="alert" className="rie-help rie-inline-error">
          {error}
        </p>
      ) : null}
      {background ? (
        <>
          <div
            className="rie-segmented"
            role="group"
            aria-label={t('fill.fit')}
            data-testid="native-fill-fit"
          >
            {FITS.map((fit) => (
              <button
                type="button"
                key={fit}
                aria-pressed={background.fit === fit}
                data-testid={`native-fill-fit-${fit}`}
                onClick={() => update({ fit })}
              >
                {t(`fill.fit_${fit}`)}
              </button>
            ))}
          </div>
          {background.fit !== 'stretch' ? (
            <div className="rie-label">
              <span id={`${id}-position`}>{t('fill.position')}</span>
              <div
                className="rie-anchor-grid"
                role="group"
                aria-labelledby={`${id}-position`}
              >
                {POSITIONS.map(([name, x, y]) => (
                  <button
                    type="button"
                    key={name}
                    aria-label={t(`position.${name}`)}
                    title={t(`position.${name}`)}
                    aria-pressed={
                      background.position.x === x && background.position.y === y
                    }
                    data-testid={`native-fill-position-${name}`}
                    onClick={() => update({ position: { x, y } })}
                  >
                    <span />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {children}
        </>
      ) : (
        <p className="rie-help">{t('fill.image_hint')}</p>
      )}
    </section>
  );
}
export const tileScalePercent = (doc: ImageDocument) =>
  Math.round((doc.backgroundImage?.scale ?? 1) * 100);
export const clampTileScale = (percent: number) =>
  clamp(percent / 100, 0.01, 100);

/* ----------------------------------------------------------------- frames */

const defaultFrameWidth = (doc: ImageDocument) =>
  Math.max(8, Math.round(Math.min(doc.width, doc.height) * 0.04));
const sliceInsets = (slice: number | SliceInsets): SliceInsets =>
  typeof slice === 'number'
    ? { top: slice, right: slice, bottom: slice, left: slice }
    : slice;

function FramePreview({
  image,
  frame,
  revision,
}: {
  image: CanvasImageSource;
  frame: FrameImage;
  revision: unknown;
}) {
  return (
    <Thumbnail
      width={42}
      height={34}
      revision={revision}
      draw={(ctx, width, height) => {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#97d6da');
        gradient.addColorStop(1, '#47758e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        const widest = Math.max(
          frame.slice.top,
          frame.slice.right,
          frame.slice.bottom,
          frame.slice.left
        );
        paintImageFrame(
          ctx,
          {
            style: 'image',
            color: '#000',
            width: Math.min(9, widest),
            image: frame,
          },
          image,
          sourceSize(image),
          { width, height }
        );
      }}
    />
  );
}

/** Host image frames, rendered as extra buttons inside the frame preset grid. */
export function ImageFrameButtons({
  engine,
  doc,
  catalog,
  t,
  onError,
}: {
  engine: CanvasEngine;
  doc: ImageDocument;
  catalog: readonly ImageEditorFrame[];
  t: T;
  onError(message: string): void;
}) {
  const images = useCatalogImages(engine, catalog);
  const current = doc.frame.style === 'image' ? doc.frame.image : undefined,
    currentAsset = current && engine.assets.get(current.source);
  const definition = (item: ImageEditorFrame): FrameImage | null => {
    const image = images.images[item.id];
    if (!image) return null;
    const size = sourceSize(image.canvas),
      slice = sliceInsets(item.slice);
    if (!validSlice(slice, size.width, size.height)) return null;
    return {
      id: item.id,
      source: image.source,
      sourceWidth: size.width,
      sourceHeight: size.height,
      slice,
      repeat: item.repeat ?? 'stretch',
    };
  };
  const inCatalog =
    current?.id && catalog.some((item) => item.id === current.id);
  return (
    <>
      {catalog.map((item) => {
        const status = images.status[item.id] ?? 'loading',
          image = images.images[item.id],
          frame = definition(item),
          unusable = status === 'failed' || (status === 'ready' && !frame);
        return (
          <button
            type="button"
            key={item.id}
            aria-pressed={current?.id === item.id}
            aria-busy={status === 'loading' || undefined}
            disabled={unusable}
            title={unusable ? t('frame.unavailable') : undefined}
            data-testid={`native-frame-image-${item.id}`}
            onClick={() => {
              if (!frame) return;
              try {
                engine.commit(
                  applyFrame(doc, {
                    ...doc.frame,
                    style: 'image',
                    width: item.width ?? defaultFrameWidth(doc),
                    image: frame,
                  })
                );
              } catch {
                onError(t('status.size_invalid'));
              }
            }}
          >
            {image && frame ? (
              <FramePreview
                image={image.canvas}
                frame={frame}
                revision={image.source.length}
              />
            ) : (
              <span
                className="rie-frame-preview"
                data-frame={unusable ? 'unavailable' : 'loading'}
              />
            )}
            <span>{item.label}</span>
          </button>
        );
      })}
      {current && !inCatalog ? (
        // A restored frame that the current catalog does not list.
        <button
          type="button"
          aria-pressed
          data-testid="native-frame-image-custom"
        >
          {currentAsset ? (
            <FramePreview
              image={currentAsset}
              frame={current}
              revision={current.source.length}
            />
          ) : (
            <span className="rie-frame-preview" data-frame="loading" />
          )}
          <span>{t('frame.custom')}</span>
        </button>
      ) : null}
    </>
  );
}

/** Placement for every frame, plus edge behavior for image frames. */
export function FrameOptions({
  engine,
  doc,
  t,
  onError,
}: {
  engine: CanvasEngine;
  doc: ImageDocument;
  t: T;
  onError(message: string): void;
}) {
  const frame = doc.frame,
    id = useId();
  const change = (next: Frame) => {
    try {
      engine.commit(applyFrame(doc, next));
    } catch {
      onError(t('status.size_invalid'));
    }
  };
  const outside = frame.placement === 'outside';
  return (
    <>
      <div className="rie-label">
        <span id={`${id}-placement`}>{t('frame.placement')}</span>
        <div
          className="rie-segmented"
          role="group"
          aria-labelledby={`${id}-placement`}
        >
          {(['inside', 'outside'] as const).map((placement) => (
            <button
              type="button"
              key={placement}
              aria-pressed={(frame.placement ?? 'inside') === placement}
              data-testid={`native-frame-placement-${placement}`}
              onClick={() => change({ ...frame, placement })}
            >
              {t(`frame.${placement}`)}
            </button>
          ))}
        </div>
        {outside ? (
          <p className="rie-help rie-field-hint">{t('frame.outside_hint')}</p>
        ) : null}
      </div>
      {frame.style === 'image' && frame.image ? (
        <div className="rie-label">
          <span id={`${id}-edges`}>{t('frame.edges')}</span>
          <div
            className="rie-segmented"
            role="group"
            aria-labelledby={`${id}-edges`}
          >
            {(['stretch', 'round'] as const).map((repeat) => (
              <button
                type="button"
                key={repeat}
                aria-pressed={
                  repeat === 'stretch'
                    ? frame.image!.repeat === 'stretch'
                    : frame.image!.repeat !== 'stretch'
                }
                data-testid={`native-frame-edges-${repeat}`}
                onClick={() => {
                  if (repeat === 'round' && frame.image!.repeat !== 'stretch')
                    return;
                  change({ ...frame, image: { ...frame.image!, repeat } });
                }}
              >
                {t(`frame.edges_${repeat}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
