const paths: Record<string, string> = {
  select: 'm5 3 14 9-7 1-3 7Z',
  crop: 'M6 3v15h15M3 6h15v15',
  resize: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5M4 4l6 6m10 10-6-6',
  draw: 'm4 16 12-12 4 4L8 20H4Zm10-10 4 4',
  text: 'M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3',
  shapes: 'M3 13h8v8H3Zm12-9 6 10H9Zm4 12a3 3 0 1 1-3 3',
  filter: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  adjust: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  stickers: 'M4 4h16v10l-6 6H4ZM14 20v-6h6M8 9h.01M15 9h.01M8 12q4 4 8 0',
  frame: 'M3 3h18v18H3ZM7 7h10v10H7Z',
  fill: 'm12 3 9 9-9 9-9-9Zm-8 9h16M8 2l5 5',
  redact: 'M4 4h16v16H4ZM4 10h16M10 4v16m4-16v16M4 14h16',
  compare: 'M12 3v18M9 5H4v14h5m6-14h5v14h-5',
  reset: 'M4 9a8 8 0 1 1 0 6M4 3v6h6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  chevron_down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  align_left: 'M4 5h16M4 10h10M4 15h16M4 20h10',
  align_center: 'M4 5h16M7 10h10M4 15h16M7 20h10',
  align_right: 'M4 5h16M10 10h10M4 15h16M10 20h10',
  lock: 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3',
  unlock: 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0',
  layers: 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5',
  export: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  hidden:
    'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0M3 3l18 18',
  undo: 'M4 8h10a6 6 0 0 1 0 12M4 8l5-5M4 8l5 5',
  redo: 'M20 8H10a6 6 0 0 0 0 12m10-12-5-5m5 5-5 5',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7',
  zoom_in: 'M10 5v10M5 10h10m3 8 4 4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  zoom_out: 'M5 10h10m3 8 4 4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  fit_to_screen: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5',
  close: 'm6 6 12 12M6 18 18 6',
  save: 'm5 12 4 4L19 6',
  rotate_left: 'M4 9a8 8 0 1 1 0 6M4 3v6h6',
  rotate_right: 'M20 9a8 8 0 1 0 0 6m0-12v6h-6',
  flip_horizontal: 'M12 3v18M8 6 3 18h5Zm8 0 5 12h-5Z',
  flip_vertical: 'M3 12h18M6 8l12-5v5Zm0 8 12 5v-5Z',
  rectangle: 'M4 5h16v14H4Z',
  ellipse: 'M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0',
  triangle: 'm12 3 10 18H2Z',
  line: 'M4 20 20 4',
  arrow: 'M4 20 20 4M10 4h10v10',
  eraser: 'm4 14 10-10 7 7-10 10H7Zm5-5 7 7',
  highlighter: 'm5 15 9-11 7 7-11 9H5Zm-2 6h10',
  duplicate: 'M8 8h12v12H8ZM4 16V4h12',
  forward: 'm5 12 7-7 7 7M12 5v15',
  backward: 'm5 12 7 7 7-7M12 19V4',
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.select} />
    </svg>
  );
}
