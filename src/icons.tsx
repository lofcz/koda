/**
 * One icon family: 24px grid, 2px safe margin, 1.6px round-capped strokes,
 * 2px corner radii on boxes, shared baselines (trays sit on y=20, boxes span
 * 3..21). Rendered at 20px by default; CSS may size them down to 16px.
 */
const box = (x: number, y: number, w: number, h: number, r = 2) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}Z`;
const circle = (x: number, y: number, r: number) =>
  `M${x + r} ${y}a${r} ${r} 0 1 1-${2 * r} 0 ${r} ${r} 0 0 1 ${2 * r} 0Z`;
const tray = 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3';

const paths: Record<string, string> = {
  select: 'M5.5 4 19 10.3l-6.2 2-2.9 6.2Z',
  crop: 'M7 3v12a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12',
  image: `${box(3, 4, 18, 16)}M3.5 16.5l4.6-4.6a1.5 1.5 0 0 1 2.1 0l4.3 4.3M13.5 14.5l1.6-1.6a1.5 1.5 0 0 1 2.1 0l3.3 3.3${circle(15.5, 8.5, 1.5)}`,
  resize: `${box(3, 13, 8, 8, 1.5)}M3 9V5a2 2 0 0 1 2-2h4M14 3h5a2 2 0 0 1 2 2v5M21 15v4a2 2 0 0 1-2 2h-4M13.5 10.5 20 4M15.5 4H20v4.5`,
  draw: 'M4 20l.9-4.1L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.1 19.1ZM13.6 7.2l3.2 3.2',
  text: 'M5 7V5h14v2M12 5v14M9.5 19h5',
  text_add: 'M4 7V5h11v2M9.5 5v14M7.5 19h4M18 12v7M14.5 15.5h7',
  bold: 'M7.5 5H13a3.5 3.5 0 0 1 0 7H7.5ZM7.5 12H14a3.5 3.5 0 0 1 0 7H7.5Z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  underline: 'M7 4.5V10a5 5 0 0 0 10 0V4.5M5 20h14',
  strikethrough:
    'M16.5 7.5c-.5-1.9-2.2-3-4.5-3-2.6 0-4.5 1.4-4.5 3.4 0 1.5.9 2.5 2.7 3.1M4 12h16M7.5 16.2c.5 2 2.3 3.3 4.7 3.3 2.7 0 4.6-1.4 4.6-3.5 0-.8-.3-1.5-.8-2',
  shapes: `${box(3, 11, 10, 10, 2)}${circle(16, 8, 5)}`,
  filter: `${circle(12, 8.5, 5)}${circle(8.5, 14.5, 5)}${circle(15.5, 14.5, 5)}`,
  adjust: `M6 4v3.5M6 12.5V20M12 4v8.5M12 17.5V20M18 4v1.5M18 10.5V20${circle(6, 10, 2.5)}${circle(12, 15, 2.5)}${circle(18, 8, 2.5)}`,
  stickers:
    'M20 12.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.5ZM20 12.5h-4.5a3 3 0 0 0-3 3V20M9 9.5h.01M14.5 9.5h.01M8.7 13.6a4 4 0 0 0 2.8 1.4',
  frame: `${box(3, 3, 18, 18, 2.5)}${box(7, 7, 10, 10, 1)}`,
  fill: 'M5.2 11.6 11.6 5.2l6.4 6.4-5.7 5.7a2 2 0 0 1-2.8 0l-4.3-4.3a1 1 0 0 1 0-1.4ZM8.5 3l3.1 3.1M5 12.3h12.3M20 15s1.6 1.9 1.6 3a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-3 1.6-3Z',
  redact: `${box(3, 4, 18, 16, 2)}M3.5 13.5 13 4M7 19.5 20.5 6M15 19.5l5.5-5.5`,
  compare: `M12 3v18M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 5h.5M18.5 5a2 2 0 0 1 2.4 2M21 10.5v3M21 17a2 2 0 0 1-2.4 2M15 19h.5`,
  reset: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4.2v4.4h4.4',
  upload: `M12 15V4M7.5 8.5 12 4l4.5 4.5${tray}`,
  export: `M12 4v11M7.5 10.5 12 15l4.5-4.5${tray}`,
  chevron_down: 'm6.5 9.5 5.5 5.5 5.5-5.5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  save: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  align_left: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  align_center: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  align_right: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  lock: `${box(5, 11, 14, 10, 2)}M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2`,
  unlock: `${box(5, 11, 14, 10, 2)}M8 11V7.5a4 4 0 0 1 7.7-1.6M12 15v2`,
  rights:
    'M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2ZM9 12l2 2 4-4',
  layers:
    'M12 4 3.5 8.5 12 13l8.5-4.5ZM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5',
  help: `${circle(12, 12, 9)}M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.1-2.5 3.6M12 17h.01`,
  hidden: `M3 12s3.3-6.5 9-6.5S21 12 21 12s-3.3 6.5-9 6.5S3 12 3 12Z${circle(12, 12, 2.75)}M4 4l16 16`,
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  delete:
    'M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7M10.5 11v5M13.5 11v5',
  zoom_in: `${circle(10.5, 10.5, 6.5)}M15.5 15.5 20 20M10.5 8v5M8 10.5h5`,
  zoom_out: `${circle(10.5, 10.5, 6.5)}M15.5 15.5 20 20M8 10.5h5`,
  fit_to_screen:
    'M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3',
  rotate_left: `${box(4, 12, 10, 8, 1.5)}M8.5 8H14a5 5 0 0 1 5 5v1.5M11 5.5 8.5 8l2.5 2.5`,
  rotate_right: `${box(10, 12, 10, 8, 1.5)}M15.5 8H10a5 5 0 0 0-5 5v1.5M13 5.5 15.5 8 13 10.5`,
  flip_horizontal:
    'M12 3v2.5M12 9v2M12 14.5v2M12 20v1M9 7 4 17h5ZM15 7l5 10h-5Z',
  flip_vertical: 'M3 12h2.5M9 12h2M14.5 12h2M20 12h1M7 9 17 4v5ZM7 15l10 5v-5Z',
  rectangle: box(3.5, 5, 17, 14, 2),
  ellipse: 'M21 12c0 3.9-4 7-9 7s-9-3.1-9-7 4-7 9-7 9 3.1 9 7Z',
  triangle:
    'M10.3 5a2 2 0 0 1 3.4 0l7.2 12.5a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3Z',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M10 5h9v9',
  path: `M6.5 16.5 10 8.5M12.5 9l3.5 6.5${circle(5.5, 18.5, 2)}${circle(11, 6.5, 2)}${circle(17.5, 17.5, 2)}`,
  objects_left: 'M4 3v18M8 6h11v5H8ZM8 14h7v5H8Z',
  objects_center: 'M12 3v18M5 6h14v5H5ZM8 14h8v5H8Z',
  objects_right: 'M20 3v18M5 6h11v5H5ZM9 14h7v5H9Z',
  objects_top: 'M3 4h18M6 8h5v11H6ZM14 8h5v7h-5Z',
  objects_middle: 'M3 12h18M6 5h5v14H6ZM14 8h5v8h-5Z',
  objects_bottom: 'M3 20h18M6 5h5v11H6ZM14 9h5v7h-5Z',
  distribute_horizontal: 'M3 3v18M21 3v18M7 7h3v10H7ZM14 4h3v16h-3Z',
  distribute_vertical: 'M3 3h18M3 21h18M7 7h10v3H7ZM4 14h16v3H4Z',
  eraser:
    'M8 20h12M4.6 13.4l8.8-8.8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19a3 3 0 0 1-4.2 0l-2.2-2.2a2.4 2.4 0 0 1 0-3.4ZM9.5 8.5l6 6',
  highlighter:
    'M14.5 4.5 19.5 9.5 12 17l-3.5.5-2-2L7 12ZM6.5 15.5 4 18v2h4l1.5-1.5M13 21h7',
  duplicate: `${box(8, 8, 13, 13, 2)}M4.5 15.5h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10.5a1 1 0 0 1 1 1v.5`,
  forward: 'M12 19V5M6.5 10.5 12 5l5.5 5.5',
  backward: 'M12 5v14M6.5 13.5 12 19l5.5-5.5',
};
/** Optical weight corrections: text marks carry their own weight. */
const strokes: Record<string, number> = { bold: 2.2 };
export function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokes[name] ?? 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
    >
      <path d={paths[name] ?? paths.select} />
    </svg>
  );
}
