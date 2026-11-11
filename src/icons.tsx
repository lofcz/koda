const paths: Record<string, string> = {
  select: 'm5 3 14 9-7 1-3 7Z',
  crop: 'M6 3v15h15M3 6h15v15',
  resize: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5M4 4l6 6m10 10-6-6',
  draw: 'm4 16 12-12 4 4L8 20H4Zm10-10 4 4',
  text: 'M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3',
  shapes: 'M3 13h8v8H3Zm12-9 6 10H9Zm4 12a3 3 0 1 1-3 3',
  filter: 'M4 7h16M4 17h16M8 4v6m8 4v6',
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
