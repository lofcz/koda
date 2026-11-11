import React, { useEffect, useRef, useState } from 'react';

import ImageEditor, {
  ImageEditorRef,
  ImageEditorSaveResult,
  type ImageEditorLocale,
} from '@lofcz/react-image-editor';

import Sidebar, { TOOL_NAMES, ToolName } from './Sidebar';
import { demoCopy } from './copy';

const SAMPLE_IMAGES = [
  'https://picsum.photos/id/1015/1200/800',
  'https://picsum.photos/id/1025/1200/800',
  'https://picsum.photos/id/1040/1200/800',
];

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const allToolsEnabled = () =>
  Object.fromEntries(TOOL_NAMES.map((tool) => [tool, true])) as Record<
    ToolName,
    boolean
  >;

export default function App() {
  const editorRef = useRef<ImageEditorRef>(null);

  const [image, setImage] = useState(SAMPLE_IMAGES[0]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [locale, setLocale] = useState<ImageEditorLocale>('en');
  const [dock, setDock] = useState<'left' | 'right'>('left');
  const [tools, setTools] =
    useState<Record<ToolName, boolean>>(allToolsEnabled);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [saved, setSaved] = useState<ImageEditorSaveResult | null>(null);
  const [status, setStatus] = useState('loading');
  const t = demoCopy(locale);

  // Drive the page chrome off the same theme the editor gets, so the
  // control demonstrates the real thing rather than a dark shell that never
  // changes.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Invalidates in-flight file reads so a slow read can never overwrite a
  // newer image choice (upload or sample) after the fact.
  const readTokenRef = useRef(0);
  const readerRef = useRef<FileReader | null>(null);

  const nextImage = () => {
    readTokenRef.current++;
    readerRef.current?.abort();
    const index = SAMPLE_IMAGES.indexOf(image);
    setImage(SAMPLE_IMAGES[(index + 1) % SAMPLE_IMAGES.length]);
    setStatus('changed');
  };

  const uploadImage = (file: File) => {
    // accept="image/*" is only a picker hint — enforce type and size here.
    if (!file.type.startsWith('image/')) {
      setStatus('not_image');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus('too_large');
      return;
    }
    readerRef.current?.abort();
    const token = ++readTokenRef.current;
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onload = () => {
      if (token !== readTokenRef.current) return;
      setImage(reader.result as string);
      setStatus('changed');
    };
    reader.onerror = () => {
      if (token !== readTokenRef.current) return;
      console.error('[demo] file read failed', reader.error);
      setStatus('read_failed');
    };
    reader.readAsDataURL(file);
  };

  const checkChanges = () => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    setStatus(editor.hasChanges() ? 'unsaved' : 'no_changes');
  };

  const snapshot = () => {
    const dataUrl = editorRef.current?.editor?.getImage();
    if (dataUrl) {
      setSaved({ dataUrl, blob: new Blob() });
      setStatus('preview_ready');
    }
  };

  const changeDock = (next: 'left' | 'right') => {
    setDock(next);
    setStatus('settings_changed');
  };

  const toggleTool = (tool: ToolName) => {
    setTools((previous) => ({ ...previous, [tool]: !previous[tool] }));
    setStatus('settings_changed');
  };

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="sidebar-toggle"
          aria-label={t('controls')}
          title={t('controls')}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
        <h1>React Image Editor</h1>
        <span className="status" role="status">
          {t(status)}
        </span>
      </header>

      <div className="body">
        {sidebarOpen && (
          <button
            type="button"
            className="backdrop"
            aria-label={t('close_controls')}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {sidebarOpen && (
          <Sidebar
            theme={theme}
            onThemeChange={setTheme}
            locale={locale}
            onLocaleChange={setLocale}
            dock={dock}
            onDockChange={changeDock}
            tools={tools}
            onToolToggle={toggleTool}
            onChangeImage={nextImage}
            onUploadImage={uploadImage}
            onCheckChanges={checkChanges}
            onSnapshot={snapshot}
          />
        )}

        <main className="editor">
          <ImageEditor
            ref={editorRef}
            image={image}
            options={{
              theme,
              locale,
              features: { imageEditor: { dock, tools } },
            }}
            onLoad={() => setStatus('ready')}
            onSave={(result) => {
              setSaved(result);
              setStatus('saved');
            }}
            onCancel={() => setStatus('cancelled')}
            onLoadError={() => setStatus('load_failed')}
            onError={() => setStatus('load_failed')}
          />
        </main>
      </div>

      {saved && (
        <aside className="preview">
          <div className="preview-header">
            <h2>{t('result')}</h2>
            <a
              href={saved.dataUrl}
              download={`edited-image.${saved.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : saved.dataUrl.startsWith('data:image/webp') ? 'webp' : 'png'}`}
            >
              {t('download')}
            </a>
            <button onClick={() => setSaved(null)}>{t('close')}</button>
          </div>
          <img src={saved.dataUrl} alt={t('result')} />
        </aside>
      )}
    </div>
  );
}
