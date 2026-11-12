import React, { useEffect, useRef, useState } from 'react';

import ImageEditor, {
  ImageEditorSaveResult,
  type ImageEditorLocale,
} from 'koda-editor';

import { demoCopy } from './copy';

const EXAMPLES = [
  'fjord',
  'aurora',
  'cabin',
  'lighthouse',
  'still-life',
] as const;
type Example = (typeof EXAMPLES)[number];

const exampleUrl = (name: Example) =>
  `${import.meta.env.BASE_URL}examples/${name}.webp`;

const INSTALL = 'npm i koda-editor';
const REPO = 'https://github.com/lofcz/koda';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const LOCALES: { value: ImageEditorLocale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'cs', label: 'CS' },
  { value: 'sk', label: 'SK' },
  { value: 'pl', label: 'PL' },
];

type Theme = 'light' | 'dark';
type Status = 'idle' | 'not_image' | 'too_large' | 'load_failed';

const isInsideEditor = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('.image-editor-root');

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA');

const firstImage = (files: FileList | null | undefined) =>
  files ? [...files].find((file) => file.type.startsWith('image/')) : undefined;

export default function App() {
  const [active, setActive] = useState<Example | 'custom'>('fjord');
  const [image, setImage] = useState(exampleUrl('fjord'));
  const [theme, setTheme] = useState<Theme>('dark');
  const [locale, setLocale] = useState<ImageEditorLocale>('en');
  const [dock, setDock] = useState<'left' | 'right'>('left');
  const [status, setStatus] = useState<Status>('idle');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<ImageEditorSaveResult | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = demoCopy(locale);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const showImage = (src: string, next: Example | 'custom') => {
    const previous = objectUrlRef.current;
    objectUrlRef.current = next === 'custom' ? src : null;
    if (previous && previous !== src) URL.revokeObjectURL(previous);
    setImage(src);
    setActive(next);
    setStatus('idle');
  };

  const openFile = (file: File | undefined) => {
    if (!file) return;
    // accept="image/*" is only a picker hint, so check type and size here.
    if (!file.type.startsWith('image/')) return setStatus('not_image');
    if (file.size > MAX_UPLOAD_BYTES) return setStatus('too_large');
    showImage(URL.createObjectURL(file), 'custom');
  };
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  // The whole page accepts a dropped or pasted image. Drops and pastes the
  // canvas already handled (it adds them as layers) are left alone.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      !!event.dataTransfer?.types.includes('Files');
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      openFileRef.current(firstImage(event.dataTransfer?.files) ?? file);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      if (isInsideEditor(event.target)) return;
      const file = firstImage(event.clipboardData?.files);
      if (!file) return;
      event.preventDefault();
      openFileRef.current(file);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the command stays selectable.
    }
  };

  const savedExtension = saved?.dataUrl.startsWith('data:image/jpeg')
    ? 'jpg'
    : saved?.dataUrl.startsWith('data:image/webp')
      ? 'webp'
      : 'png';

  return (
    <div className="page">
      <header className="masthead">
        <h1 className="brand">
          <Mark />
          <span className="wordmark">koda</span>
        </h1>
        <p className="tagline">{t('tagline')}</p>
        <div className="masthead-actions">
          <div className="install">
            <code>
              <span className="prompt" aria-hidden="true">
                $
              </span>
              {INSTALL}
            </code>
            <button
              type="button"
              className="install-copy"
              onClick={copyInstall}
              aria-label={copied ? t('copied') : t('copy')}
              title={copied ? t('copied') : t('copy')}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          <a className="github" href={REPO}>
            <GitHubIcon />
            <span>GitHub</span>
          </a>
        </div>
      </header>

      <section className="deck">
        <div className="picker">
          <h2 className="eyebrow">{t('examples')}</h2>
          <ul className="examples">
            {EXAMPLES.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="example"
                  aria-pressed={active === name}
                  onClick={() => showImage(exampleUrl(name), name)}
                >
                  <img src={exampleUrl(name)} alt="" loading="lazy" />
                  <span>{t(name)}</span>
                </button>
              </li>
            ))}
            <li className="drop-slot">
              <button
                type="button"
                className="drop"
                data-dragging={dragging || undefined}
                data-active={active === 'custom' || undefined}
                data-error={status !== 'idle' || undefined}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
                <span className="drop-text">
                  <strong>{dragging ? t('drop_now') : t('own_image')}</strong>
                  <small role="status">
                    {status !== 'idle' ? t(status) : t('drop_hint')}
                  </small>
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Clear first so picking the same file again still fires.
                  event.target.value = '';
                  openFile(file);
                }}
              />
            </li>
          </ul>
        </div>

        <div className="settings">
          <div className="segmented" role="group" aria-label={t('language')}>
            {LOCALES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={locale === option.value}
                onClick={() => setLocale(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label={t('position')}>
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={dock === side}
                aria-label={t(side)}
                title={t(side)}
                onClick={() => setDock(side)}
              >
                <DockIcon side={side} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t('to_light') : t('to_dark')}
            title={theme === 'dark' ? t('to_light') : t('to_dark')}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </section>

      <main className="stage">
        <ImageEditor
          image={image}
          minHeight={0}
          wrapperClassName="stage-editor"
          options={{
            theme,
            locale,
            features: { imageEditor: { dock } },
          }}
          onLoad={() => setStatus('idle')}
          onSave={setSaved}
          onLoadError={() => setStatus('load_failed')}
          onError={() => setStatus('load_failed')}
        />
      </main>

      {saved && (
        <aside className="result" aria-label={t('result')}>
          <img src={saved.dataUrl} alt={t('result')} />
          <div className="result-bar">
            <span>{t('result')}</span>
            <a
              className="result-download"
              href={saved.dataUrl}
              download={`koda-edit.${savedExtension}`}
            >
              {t('download')}
            </a>
            <button
              type="button"
              className="icon-button"
              aria-label={t('close')}
              title={t('close')}
              onClick={() => setSaved(null)}
            >
              <CloseIcon />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="koda-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fe3ea" />
          <stop offset="1" stopColor="#8a86f0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#koda-mark)" />
      <path
        d="M9 13V9h4M23 19v4h-4"
        fill="none"
        stroke="#0a1019"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="#0a1019" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg {...iconProps} width={22} height={22} className="drop-icon">
      <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 14.5v2A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-2" />
    </svg>
  );
}

function DockIcon({ side }: { side: 'left' | 'right' }) {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d={side === 'left' ? 'M9 5v14' : 'M15 5v14'} />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}
