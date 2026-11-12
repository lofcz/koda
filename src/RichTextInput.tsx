import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import type { TextStyle } from './model';
import {
  clampTextSelection,
  equalRichText,
  formatRichText,
  htmlToRichText,
  normalizeRichText,
  readRichText,
  replaceRichText,
  richTextToHtml,
  selectedTextStyle,
  type RichTextValue,
  type TextSelection,
  type TextStyleState,
} from './richText';

export interface RichTextInputHandle {
  focus(): void;
  /** Omitted range selects all text. */
  select(range?: TextSelection): void;
  getSelection(): TextSelection;
  applyFormat(patch: Partial<TextStyle>): void;
  /** Publish pending DOM/composition content before a host export. */
  flush(): void;
}
export interface RichTextInputProps {
  value: RichTextValue;
  /** Synchronous owner read prevents a pending DOM edit from replaying over a restored document. */
  getValue?(): RichTextValue | null;
  defaults: TextStyle;
  onChange(value: RichTextValue): void;
  onSelectionChange?(selection: TextSelection, marks: TextStyleState): void;
  onFocus?(): void;
  onBlur?(event?: { relatedTarget: EventTarget | null }): void;
  onCommit?(): void;
  onCancel?(): void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel: string;
  testId?: string;
  /** Content cannot change; selection (and formatting, if allowed) still works. */
  readOnly?: boolean;
  /** When false, Enter inserts nothing and pasted line breaks become spaces. */
  allowNewlines?: boolean;
  /** When false, formatting shortcuts do nothing and pasted markup keeps the current style. */
  allowFormatting?: boolean;
}
export interface RichTextRendererProps extends RichTextInputProps {
  editorRef: React.Ref<RichTextInputHandle>;
  context: 'canvas' | 'panel';
}
export type RichTextRenderer = (
  props: RichTextRendererProps
) => React.ReactNode;

function domSelection(root: HTMLElement): TextSelection | null {
  const selection = window.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return null;
  const offset = (node: Node, index: number) => {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, index);
    return readRichText(range.cloneContents()).text.length;
  };
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    focus: offset(selection.focusNode, selection.focusOffset),
  };
}

function restoreDomSelection(root: HTMLElement, range: TextSelection) {
  const point = (index: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (index <= length) return [node, index];
      index -= length;
      node = walker.nextNode();
    }
    return [root, root.childNodes.length];
  };
  const [anchor, anchorOffset] = point(range.anchor),
    [focus, focusOffset] = point(range.focus);
  window
    .getSelection()
    ?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
}

const equal = equalRichText;

/** A single controlled text/selection contract for the canvas, panel and host adapters. */
export const RichTextInput = forwardRef<
  RichTextInputHandle,
  RichTextInputProps
>(function RichTextInput(props, ref) {
  const root = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const current = useRef(normalizeRichText(props.value));
  const range = useRef<TextSelection>({ anchor: 0, focus: 0 });
  const typing = useRef<TextStyle | null>(null),
    composing = useRef(false);
  // The marks typed text would get, captured when an IME session starts: the
  // session moves the DOM caret before the composed text exists.
  const composition = useRef<{
    text: string;
    start: number;
    end: number;
    marks: TextStyle;
  } | null>(null);
  const past = useRef<{ value: RichTextValue; selection: TextSelection }[]>([]);
  const future = useRef<{ value: RichTextValue; selection: TextSelection }[]>(
    []
  );
  const api = useRef<RichTextInputHandle | null>(null);
  const defaultKey = useRef('');

  const notifySelection = () => {
    const next =
      root.current &&
      document.activeElement === root.current &&
      domSelection(root.current);
    if (next) {
      if (
        next.anchor !== range.current.anchor ||
        next.focus !== range.current.focus
      )
        typing.current = null;
      range.current = next;
    }
    latest.current.onSelectionChange?.(
      range.current,
      typing.current ??
        selectedTextStyle(
          current.current,
          range.current,
          latest.current.defaults
        )
    );
  };
  const publish = (
    next: RichTextValue,
    selection: TextSelection,
    rewrite = true,
    history = true
  ) => {
    next = normalizeRichText(next);
    if (!equal(current.current, next, latest.current.defaults)) {
      if (history) {
        past.current.push({ value: current.current, selection: range.current });
        if (past.current.length > 100) past.current.shift();
        future.current = [];
      }
      current.current = next;
      latest.current.onChange(next);
    }
    range.current = clampTextSelection(next, selection);
    if (rewrite && root.current) {
      const html = richTextToHtml(next, latest.current.defaults);
      if (root.current.innerHTML !== html) root.current.innerHTML = html;
      if (document.activeElement === root.current)
        restoreDomSelection(root.current, range.current);
    }
    notifySelection();
  };
  const flush = () => {
    if (!root.current) return;
    if (latest.current.getValue) {
      const owned = latest.current.getValue();
      if (!owned) return;
      if (!equal(owned, current.current, latest.current.defaults)) {
        current.current = normalizeRichText(owned);
        range.current = clampTextSelection(current.current, range.current);
        root.current.innerHTML = richTextToHtml(
          current.current,
          latest.current.defaults
        );
        composing.current = false;
        past.current = [];
        future.current = [];
        if (document.activeElement === root.current)
          restoreDomSelection(root.current, range.current);
        return;
      }
    }
    const selection =
      (document.activeElement === root.current
        ? domSelection(root.current)
        : null) ?? range.current;
    publish(readRichText(root.current, true), selection, !composing.current);
  };
  const insert = (value: RichTextValue) => {
    if (latest.current.readOnly) return;
    if (latest.current.allowNewlines === false && value.text.includes('\n'))
      value = {
        text: value.text.replace(/\n/g, ' '),
        runs: value.runs?.map((run) => ({
          ...run,
          text: run.text.replace(/\n/g, ' '),
        })),
      };
    const selection = root.current && domSelection(root.current);
    if (selection) range.current = selection;
    const start = Math.min(range.current.anchor, range.current.focus);
    const next = replaceRichText(current.current, range.current, value);
    publish(next, {
      anchor: start + value.text.length,
      focus: start + value.text.length,
    });
  };
  const history = (redo: boolean) => {
    const from = redo ? future.current : past.current,
      to = redo ? past.current : future.current;
    const state = from.pop();
    if (!state) return;
    to.push({ value: current.current, selection: range.current });
    publish(state.value, state.selection, true, false);
  };
  api.current = {
    focus: () => {
      const selection = range.current;
      root.current?.focus({ preventScroll: true });
      range.current = selection;
      if (root.current) restoreDomSelection(root.current, selection);
      notifySelection();
    },
    select: (selection) => {
      const next = clampTextSelection(
        current.current,
        selection ?? { anchor: 0, focus: current.current.text.length }
      );
      root.current?.focus({ preventScroll: true });
      range.current = next;
      if (root.current) restoreDomSelection(root.current, range.current);
      typing.current = null;
      notifySelection();
    },
    getSelection: () => ({
      ...((root.current &&
        document.activeElement === root.current &&
        domSelection(root.current)) ||
        range.current),
    }),
    applyFormat: (patch) => {
      if (latest.current.allowFormatting === false) return;
      flush();
      if (range.current.anchor === range.current.focus) {
        const style = selectedTextStyle(
          current.current,
          range.current,
          latest.current.defaults
        );
        typing.current = {
          ...Object.fromEntries(
            Object.entries(style).filter(([, value]) => value !== null)
          ),
          ...typing.current,
          ...patch,
        };
      } else
        publish(
          formatRichText(current.current, range.current, patch),
          range.current
        );
      if (root.current && document.activeElement === root.current)
        restoreDomSelection(root.current, range.current);
      notifySelection();
    },
    flush,
  };
  useImperativeHandle(
    ref,
    () => ({
      focus: () => api.current!.focus(),
      select: (selection) => api.current!.select(selection),
      getSelection: () => api.current!.getSelection(),
      applyFormat: (patch) => api.current!.applyFormat(patch),
      flush: () => api.current!.flush(),
    }),
    []
  );
  useLayoutEffect(() => {
    if (!root.current || composing.current) return;
    const next = normalizeRichText(props.value);
    const key = JSON.stringify(props.defaults);
    if (
      !equal(next, current.current, props.defaults) ||
      defaultKey.current !== key ||
      !root.current.childNodes.length
    ) {
      const active = document.activeElement === root.current;
      const selection = domSelection(root.current) ?? range.current;
      current.current = next;
      root.current.innerHTML = richTextToHtml(next, props.defaults);
      defaultKey.current = key;
      range.current = clampTextSelection(next, selection);
      if (active) restoreDomSelection(root.current, range.current);
    }
  }, [props.value, props.defaults]);
  const handlers = useRef({ insert, history, notifySelection });
  handlers.current = { insert, history, notifySelection };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const beforeInput = (event: InputEvent) => {
      if (latest.current.readOnly) {
        event.preventDefault();
        return;
      }
      if (event.isComposing || composing.current) return;
      if (
        event.inputType === 'historyUndo' ||
        event.inputType === 'historyRedo'
      ) {
        event.preventDefault();
        handlers.current.history(event.inputType === 'historyRedo');
        return;
      }
      if (
        event.inputType === 'insertText' ||
        event.inputType === 'insertParagraph' ||
        event.inputType === 'insertLineBreak'
      ) {
        event.preventDefault();
        const text =
          event.inputType === 'insertText' ? (event.data ?? '') : '\n';
        if (text === '\n' && latest.current.allowNewlines === false) return;
        const selected = domSelection(element) ?? range.current;
        const marks =
          typing.current ??
          selectedTextStyle(current.current, selected, latest.current.defaults);
        const style = Object.fromEntries(
          Object.entries(marks).filter(([, value]) => value !== null)
        );
        handlers.current.insert({ text, runs: [{ text, style }] });
      }
    };
    const selected = () => {
      if (document.activeElement === element)
        handlers.current.notifySelection();
    };
    element.addEventListener('beforeinput', beforeInput);
    document.addEventListener('selectionchange', selected);
    return () => {
      element.removeEventListener('beforeinput', beforeInput);
      document.removeEventListener('selectionchange', selected);
    };
  }, []);
  return (
    <div
      ref={root}
      // A read-only box keeps focus and selection, but no IME or spellcheck can mutate it.
      contentEditable={!props.readOnly}
      tabIndex={props.readOnly ? 0 : undefined}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={props.allowNewlines !== false}
      aria-readonly={props.readOnly || undefined}
      aria-label={props.ariaLabel}
      data-testid={props.testId}
      className={props.className}
      spellCheck
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        outline: 'none',
        ...props.style,
      }}
      onFocus={() => {
        props.onFocus?.();
        notifySelection();
      }}
      onBlur={(event) => {
        flush();
        props.onBlur?.({ relatedTarget: event.relatedTarget });
      }}
      onInput={() => flush()}
      onCompositionStart={() => {
        composing.current = true;
        const selected =
          (root.current && domSelection(root.current)) ?? range.current;
        composition.current = {
          text: current.current.text,
          start: Math.min(selected.anchor, selected.focus),
          end: Math.max(selected.anchor, selected.focus),
          marks:
            typing.current ??
            (Object.fromEntries(
              Object.entries(
                selectedTextStyle(
                  current.current,
                  selected,
                  latest.current.defaults
                )
              ).filter(([, value]) => value !== null)
            ) as TextStyle),
        };
      }}
      onCompositionEnd={() => {
        composing.current = false;
        const pending = composition.current;
        composition.current = null;
        flush();
        if (!pending) return;
        // IME commits bypass beforeinput. Give the composed text the marks
        // typed text gets: pending caret marks (Italic toggled with nothing
        // selected) or the style of the selection it replaced.
        const before = pending.text,
          after = current.current.text,
          length = after.length - before.length + pending.end - pending.start;
        if (
          length > 0 &&
          after.startsWith(before.slice(0, pending.start)) &&
          after.endsWith(before.slice(pending.end))
        ) {
          if (typing.current === null && pending.start === pending.end)
            typing.current = pending.marks;
          publish(
            formatRichText(
              current.current,
              { anchor: pending.start, focus: pending.start + length },
              pending.marks
            ),
            range.current,
            true,
            false
          );
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const html =
          props.allowFormatting === false
            ? ''
            : event.clipboardData.getData('text/html');
        const plain = event.clipboardData
          .getData('text/plain')
          .replace(/\r\n?/g, '\n');
        if (html) insert(htmlToRichText(html));
        else {
          const style =
            typing.current ??
            Object.fromEntries(
              Object.entries(
                selectedTextStyle(
                  current.current,
                  range.current,
                  props.defaults
                )
              ).filter(([, value]) => value !== null)
            );
          insert({ text: plain, runs: [{ text: plain, style }] });
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const html =
            props.allowFormatting === false
              ? ''
              : event.dataTransfer.getData('text/html'),
          text = event.dataTransfer.getData('text/plain');
        if (html || text) insert(html ? htmlToRichText(html) : { text });
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composing.current) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onCancel?.();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          flush();
          props.onCommit?.();
          return;
        }
        if (
          event.key === 'Enter' &&
          (props.readOnly || props.allowNewlines === false)
        ) {
          event.preventDefault();
          return;
        }
        if (
          props.readOnly &&
          (event.key === 'Backspace' || event.key === 'Delete')
        ) {
          event.preventDefault();
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          const key = event.key.toLowerCase();
          if (key === 'z' || key === 'y') {
            event.preventDefault();
            history(key === 'y' || event.shiftKey);
          } else if (key === 'x' && props.readOnly) {
            event.preventDefault();
          } else if (key === 'b' || key === 'i' || key === 'u') {
            event.preventDefault();
            const style =
              typing.current ??
              selectedTextStyle(current.current, range.current, props.defaults);
            api.current!.applyFormat(
              key === 'b'
                ? { fontWeight: (style.fontWeight ?? 400) >= 600 ? 400 : 700 }
                : key === 'i'
                  ? { italic: !style.italic }
                  : { underline: !style.underline }
            );
          }
        }
      }}
    />
  );
});
