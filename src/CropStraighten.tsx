import { useId, useState } from 'react';
import { Icon } from './icons';

const MINUS = '−';

/** Locale-aware angle text with a true minus sign, e.g. "−3.5" or "−3,5". */
export function formatAngle(value: number, locale?: string): string {
  const rounded = Math.round(value * 100) / 100 || 0;
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(Math.abs(rounded));
  } catch {
    text = String(Math.abs(rounded));
  }
  return rounded < 0 ? MINUS + text : text;
}

/** Accept "-3.5", "−3,5", "3.5°" and similar typed angles; anything else is rejected. */
export function parseAngle(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/°$/, '')
    .trim()
    .replace(/^[−–—]/, '-')
    .replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Straighten slider with an editable absolute-angle readout and a reset-to-zero button. */
export function CropStraighten({
  label,
  inputLabel,
  resetLabel,
  value,
  range,
  locale,
  testId,
  onChange,
}: {
  label: string;
  inputLabel: string;
  resetLabel: string;
  value: number;
  range: number;
  locale?: string;
  testId: string;
  onChange(value: number): void;
}) {
  const id = useId(),
    [draft, setDraft] = useState<string | null>(null),
    shown = formatAngle(value, locale),
    clamp = (next: number) => Math.max(-range, Math.min(range, next));
  const commit = () => {
    if (draft === null) return;
    const typed = parseAngle(draft);
    setDraft(null);
    if (typed !== null && clamp(typed) !== value) onChange(clamp(typed));
  };
  return (
    <div className="rie-label rie-crop-straighten">
      <span>
        <span id={`${id}-label`}>{label}</span>
        <span className="rie-crop-angle">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label={inputLabel}
            value={draft ?? shown}
            data-testid={`${testId}-angle`}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape' && draft !== null) {
                event.stopPropagation();
                setDraft(null);
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const step =
                  (event.shiftKey ? 1 : 0.1) *
                  (event.key === 'ArrowUp' ? 1 : -1);
                setDraft(null);
                const next = clamp(Math.round((value + step) * 100) / 100);
                if (next !== value) onChange(next);
              }
            }}
          />
          <span aria-hidden="true">°</span>
          <button
            type="button"
            className="rie-icon-button"
            aria-label={resetLabel}
            title={resetLabel}
            data-idle={value === 0 || undefined}
            data-testid={`${testId}-reset`}
            onClick={() => {
              setDraft(null);
              if (value !== 0) onChange(0);
            }}
          >
            <Icon name="reset" />
          </button>
        </span>
      </span>
      <input
        type="range"
        min={-range}
        max={range}
        step={0.5}
        value={value}
        aria-labelledby={`${id}-label`}
        aria-valuetext={`${shown}°`}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
