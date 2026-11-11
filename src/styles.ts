/** Scoped CSS is bundled with the engine; no external stylesheet/font request. */
export const styles = `
.image-editor-root{--rie-bg:#fff;--rie-panel:#fff;--rie-muted:#f4f6f8;--rie-line:#e3e8ee;--rie-fg:#202a38;--rie-secondary:#64748b;--rie-accent:#0797a7;--rie-tint:#e4f5f6;position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;width:100%;container-type:inline-size;color:var(--rie-fg);background:var(--rie-bg);font:inherit;isolation:isolate;color-scheme:light}
.image-editor-root[data-scheme="dark"]{--rie-bg:#151b24;--rie-panel:#1c2531;--rie-muted:#111722;--rie-line:#344152;--rie-fg:#edf3fa;--rie-secondary:#a7b7c9;--rie-accent:#49c4d0;--rie-tint:#153b43;color-scheme:dark}
.image-editor-root *{box-sizing:border-box}
.image-editor-root button,.image-editor-root input,.image-editor-root select,.image-editor-root textarea{font:inherit;color:inherit}
.image-editor-root button{appearance:none;border:1px solid transparent;border-radius:8px;background:transparent;padding:6px 10px;min-height:34px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12px;font-weight:500;line-height:1.25;touch-action:manipulation}
.image-editor-root button:hover:not(:disabled){background:var(--rie-muted)}
.image-editor-root button[aria-pressed="true"]{background:var(--rie-tint);border-color:var(--rie-accent);color:var(--rie-accent)}
.image-editor-root button:disabled{opacity:.38;cursor:default}
.image-editor-root :focus-visible{outline:2px solid var(--rie-accent);outline-offset:2px}
.image-editor-root .rie-theme{display:flex;flex-direction:column;flex:1;min-height:0}
.image-editor-root .rie-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid var(--rie-line);flex-shrink:0;background:var(--rie-panel)}
.image-editor-root .rie-toolbar-group{display:flex;gap:2px;align-items:center}
.image-editor-root .rie-icon-button{width:34px;height:34px;padding:6px;flex-shrink:0}
.image-editor-root .rie-primary{background:var(--rie-accent);color:var(--rie-bg)}
.image-editor-root .rie-primary:hover:not(:disabled){background:var(--rie-accent);filter:brightness(1.08)}
.image-editor-root .rie-body{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
.image-editor-root .rie-nav{display:flex;flex-direction:column;gap:4px;padding:6px;width:68px;flex-shrink:0;overflow:auto;border-right:1px solid var(--rie-line);background:var(--rie-panel)}
.image-editor-root .rie-nav button{display:flex;flex-direction:column;padding:7px 3px;gap:4px;min-height:52px;font-size:10px;flex-shrink:0}
.image-editor-root .rie-options{width:228px;max-width:calc(100% - 68px);min-height:0;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--rie-line);background:var(--rie-panel)}
.image-editor-root .rie-options-heading{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--rie-line);padding:5px 8px 5px 14px;min-height:42px;flex-shrink:0}
.image-editor-root .rie-options-heading h2{font-size:13px;font-weight:600;margin:0}
.image-editor-root .rie-options-content{padding:12px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.image-editor-root .rie-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.image-editor-root .rie-stack{display:flex;flex-direction:column;gap:10px}
.image-editor-root .rie-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.image-editor-root .rie-label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:11px;color:var(--rie-secondary)}
.image-editor-root .rie-label>span{display:flex;justify-content:space-between;gap:4px}
.image-editor-root input:not([type="range"]):not([type="color"]),.image-editor-root textarea,.image-editor-root select{min-width:0;width:100%;border:1px solid var(--rie-line);border-radius:7px;padding:6px 8px;background:var(--rie-bg);color:var(--rie-fg);font-size:12px;line-height:1.4}
.image-editor-root input[type="number"]{height:32px}
.image-editor-root input[type="range"]{width:100%;accent-color:var(--rie-accent);margin:4px 0}
.image-editor-root input[type="color"]{padding:2px;width:100%;height:32px;border:1px solid var(--rie-line);border-radius:7px;background:var(--rie-bg)}
.image-editor-root textarea{resize:vertical;min-height:70px}
.image-editor-root .rie-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.image-editor-root .rie-presets button{border-color:var(--rie-line);min-height:36px}
.image-editor-root .rie-help{font-size:12px;line-height:1.55;color:var(--rie-secondary);margin:0}
.image-editor-root .rie-error{font-size:12px;line-height:1.5;color:#df4352;padding:8px;margin:0}
.image-editor-root .rie-canvas-wrap{position:relative;flex:1;min-width:0;min-height:0;background:var(--rie-muted)}
.image-editor-root .rie-canvas{position:absolute;inset:0;overflow:hidden;touch-action:none;outline-offset:-3px;overscroll-behavior:contain}
.image-editor-root .rie-canvas canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.image-editor-root .lower-canvas{pointer-events:none}
.image-editor-root .rie-artboard{position:absolute;pointer-events:none;box-shadow:0 2px 12px #0002;background-color:#fff;background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.image-editor-root .rie-fallback{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:var(--rie-bg);padding:16px;text-align:center;font-size:13px}
.image-editor-root .rie-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.image-editor-root .rie-body[data-dock="right"] .rie-nav{order:3;border-right:0;border-left:1px solid var(--rie-line)}
.image-editor-root .rie-body[data-dock="right"] .rie-options{order:2;border-right:0;border-left:1px solid var(--rie-line)}
@container (max-width:620px){
 .image-editor-root .rie-toolbar{padding:4px 8px;gap:2px}
 .image-editor-root .rie-icon-button{width:30px;height:32px;padding:5px}
 .image-editor-root .rie-toolbar-actions button{padding:5px 7px;font-size:11px}
 .image-editor-root .rie-body{flex-direction:column}
 .image-editor-root .rie-body .rie-nav{order:0;flex-direction:row;gap:2px;width:100%;border:0;border-bottom:1px solid var(--rie-line);padding:4px;overflow-x:auto;overflow-y:hidden}
 .image-editor-root .rie-nav button{flex:1 0 42px;min-height:46px;padding:4px 2px;gap:3px;font-size:10px}
 .image-editor-root .rie-body .rie-canvas-wrap{order:1;min-height:120px}
 .image-editor-root .rie-body .rie-options{order:2;width:100%;max-width:100%;max-height:130px;border:0;border-top:1px solid var(--rie-line)}
 .image-editor-root .rie-options-heading{padding:3px 8px 3px 12px;min-height:36px}
 .image-editor-root .rie-options-content{padding:8px;gap:8px}
 .image-editor-root [data-testid="native-resize-panel"]{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 .image-editor-root [data-testid="native-resize-lock"]{grid-column:1/-1}
 .image-editor-root .rie-presets{grid-template-columns:repeat(5,minmax(0,1fr))}
}
`;
