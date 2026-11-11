/** Browser-only test harness. Source pixels and every engine asset are local. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImageEditor, {
  type ImageEditorChange,
  type ImageEditorInstance,
} from '@lofcz/react-image-editor';

const source = document.createElement('canvas');
source.width = 600;
source.height = 400;
const context = source.getContext('2d')!;
context.fillStyle = '#ff0000';
context.fillRect(0, 0, 300, 400);
context.fillStyle = '#0000ff';
context.fillRect(300, 0, 300, 200);
const sourceUrl = source.toDataURL('image/png');
declare global {
  interface Window {
    localEditor: ImageEditorInstance;
    sourceUrl: string;
    changes: ImageEditorChange[];
    saved: string | null;
    unmountEditor: () => void;
  }
}
window.sourceUrl = sourceUrl;
window.changes = [];
window.saved = null;
function Harness() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    <>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        Theme
      </button>
      <div className="fixture">
        <ImageEditor
          image={sourceUrl}
          minHeight={0}
          options={{ theme }}
          onLoad={(editor) => {
            window.localEditor = editor;
          }}
          onChange={(change) => window.changes.push(change)}
          onSave={(result) => {
            window.saved = result.dataUrl;
          }}
        />
      </div>
    </>
  );
}
const root = createRoot(document.getElementById('root')!);
window.unmountEditor = () => root.unmount();
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
