import React, {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { CanvasEngine, isAbort } from './engine';
import { EditorUI } from './EditorUI';
import { translator } from './locale';
import { stableKey } from './stableKey';
import { styles } from './styles';
import type { ImageEditorProps, ImageEditorRef } from './types';

function ImageEditorInner(
  props: ImageEditorProps,
  ref: React.Ref<ImageEditorRef>
) {
  const [engine] = useState(() => new CanvasEngine());
  const state = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot
  );
  const latest = useRef(props),
    loaded = useRef(false),
    generatedId = useId();
  useEffect(() => {
    latest.current = props;
  });
  useImperativeHandle(
    ref,
    () => ({
      editor:
        state.phase === 'idle' || state.phase === 'destroyed' ? null : engine,
    }),
    [engine, state.phase]
  );
  useEffect(() => {
    engine.activate();
    return () => engine.destroy();
  }, [engine]);
  const optionsKey = stableKey(props.options ?? {});
  useEffect(() => {
    engine.updateOptions({
      ...latest.current.options,
      imageLoader: latest.current.options?.imageLoader,
    });
  }, [engine, optionsKey, props.options?.imageLoader]);
  useEffect(
    () =>
      engine.subscribeChanges((change) => {
        try {
          latest.current.onChange?.(change);
        } catch (error) {
          console.error('[react-image-editor] onChange callback threw', error);
        }
      }),
    [engine]
  );
  useEffect(() => {
    void engine.reset(props.image).catch((error) => {
      if (!isAbort(error)) {
        /* Engine state drives the error UI and callbacks. */
      }
    });
  }, [engine, props.image]);
  useEffect(() => {
    if (state.phase === 'ready' && !loaded.current) {
      loaded.current = true;
      try {
        latest.current.onLoad?.(engine);
      } catch (error) {
        console.error('[react-image-editor] onLoad callback threw', error);
      }
    }
  }, [engine, state.phase]);
  useEffect(() => {
    if (!state.error) return;
    try {
      latest.current.onLoadError?.();
      latest.current.onError?.(state.error);
    } catch (error) {
      console.error('[react-image-editor] error callback threw', error);
    }
  }, [state.error]);
  const t = translator(state.options),
    retry = () => {
      void engine.reset(props.image).catch(() => {
        /* Error state remains available for another retry. */
      });
    };
  const failed = state.phase === 'error',
    loading = state.phase === 'idle' || state.phase === 'loading';
  const fallback = failed
    ? typeof props.errorFallback === 'function'
      ? props.errorFallback(state.error!, retry)
      : (props.errorFallback ?? (
          <div role="alert">
            <p>{t('status.load_failed')}</p>
            <button type="button" onClick={retry}>
              {t('status.retry')}
            </button>
          </div>
        ))
    : loading
      ? (props.loadingFallback ?? (
          <span role="status">{t('status.loading_image')}</span>
        ))
      : null;
  return (
    <div
      className={props.wrapperClassName}
      style={{
        flex: 1,
        display: 'flex',
        minWidth: 0,
        minHeight: props.minHeight ?? 500,
        position: 'relative',
        ...props.wrapperStyle,
      }}
    >
      <div
        id={props.editorId ?? `image-editor-${generatedId}`}
        className={props.className}
        role="region"
        aria-label={props.ariaLabel ?? t('title')}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          ...props.style,
        }}
      >
        <div
          className="image-editor-root"
          data-editor-engine="local-canvas"
          data-scheme={state.options.theme ?? 'light'}
        >
          <style>{styles}</style>
          {state.phase !== 'destroyed' ? (
            <EditorUI
              key={state.imageRevision}
              engine={engine}
              state={state}
              onSave={props.onSave}
              onCancel={props.onCancel}
              onError={props.onError}
            />
          ) : null}
          {state.error && state.phase === 'ready' ? (
            <p role="alert" className="rie-error">
              {t('status.load_failed')}
            </p>
          ) : null}
          {fallback ? (
            <div className="rie-fallback" aria-busy={loading}>
              {fallback}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
export const ImageEditor = React.forwardRef<ImageEditorRef, ImageEditorProps>(
  ImageEditorInner
);
ImageEditor.displayName = 'ImageEditor';
