import React, { useRef } from 'react';

import type { ImageEditorLocale } from '@lofcz/react-image-editor';
import { translator } from '../../src/locale';
import { demoCopy } from './copy';

export const TOOL_NAMES = [
  'crop',
  'resize',
  'filter',
  'draw',
  'text',
  'shapes',
  'select',
  'adjust',
  'stickers',
  'redact',
  'frame',
  'fill',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const LOCALES: { value: ImageEditorLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'cs', label: 'Čeština' },
  { value: 'sk', label: 'Slovenčina' },
  { value: 'pl', label: 'Polski' },
];

interface SidebarProps {
  theme: 'light' | 'dark';
  onThemeChange(theme: 'light' | 'dark'): void;
  locale: ImageEditorLocale;
  onLocaleChange(locale: ImageEditorLocale): void;
  dock: 'left' | 'right';
  onDockChange(dock: 'left' | 'right'): void;
  tools: Record<ToolName, boolean>;
  onToolToggle(tool: ToolName): void;
  onChangeImage(): void;
  onUploadImage(file: File): void;
  onCheckChanges(): void;
  onSnapshot(): void;
}

export default function Sidebar(props: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = demoCopy(props.locale),
    editorText = translator({ locale: props.locale });

  return (
    <aside className="sidebar">
      <section className="section">
        <h2 className="section-label">{t('actions')}</h2>
        <button onClick={props.onChangeImage}>{t('change_image')}</button>
        <button onClick={() => fileInputRef.current?.click()}>
          {t('upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Clear before the callback so re-selecting the same file always
            // fires onChange, even if the handler throws.
            event.target.value = '';
            if (file) props.onUploadImage(file);
          }}
        />
        <button onClick={props.onCheckChanges}>{t('check_changes')}</button>
        <button onClick={props.onSnapshot}>{t('preview')}</button>
      </section>

      <section className="section">
        <h2 className="section-label">{t('appearance')}</h2>
        <label className="field">
          {t('theme')}
          <select
            value={props.theme}
            onChange={(event) =>
              props.onThemeChange(event.target.value as 'light' | 'dark')
            }
          >
            <option value="light">{t('light')}</option>
            <option value="dark">{t('dark')}</option>
          </select>
        </label>
        <label className="field">
          {t('language')}
          <select
            value={props.locale}
            onChange={(event) =>
              props.onLocaleChange(event.target.value as ImageEditorLocale)
            }
          >
            {LOCALES.map((locale) => (
              <option key={locale.value} value={locale.value}>
                {locale.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="section">
        <h2 className="section-label">{t('layout')}</h2>
        <label className="field">
          {t('position')}
          <select
            value={props.dock}
            onChange={(event) =>
              props.onDockChange(event.target.value as 'left' | 'right')
            }
          >
            <option value="left">{t('left')}</option>
            <option value="right">{t('right')}</option>
          </select>
        </label>
      </section>

      <section className="section">
        <h2 className="section-label">{t('tools')}</h2>
        <div className="tool-grid">
          {TOOL_NAMES.map((tool) => (
            <label key={tool} className="tool-toggle">
              <input
                type="checkbox"
                checked={props.tools[tool]}
                onChange={() => props.onToolToggle(tool)}
              />
              {editorText(`tools.${tool}`)}
            </label>
          ))}
        </div>
      </section>
    </aside>
  );
}
