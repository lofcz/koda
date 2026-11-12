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
.image-editor-root input:disabled{opacity:.45;cursor:default}
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
.image-editor-root .rie-artboard,.image-editor-root .rie-crop-artboard{position:absolute;pointer-events:none;box-shadow:0 2px 12px #0002;background-color:#fff;background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.image-editor-root .rie-artboard[data-cropping="true"]{background:none;box-shadow:none}
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
.image-editor-root{--rie-bg:#fff;--rie-panel:#fff;--rie-muted:#edf0f3;--rie-line:#e5e8ed;--rie-fg:#242d3b;--rie-secondary:#6b7585;--rie-accent:#087f8c;--rie-tint:#e6f4f5;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
.image-editor-root[data-scheme="dark"]{--rie-bg:#171b22;--rie-panel:#1d222b;--rie-muted:#11151b;--rie-line:#303744;--rie-fg:#edf0f5;--rie-secondary:#a1aabc;--rie-accent:#6dd5de;--rie-tint:#203d43}
.image-editor-root button{min-height:36px;padding:8px 11px;gap:7px;transition:transform .12s;flex-shrink:0}
.image-editor-root button[aria-pressed="true"],.image-editor-root button[aria-selected="true"]{background:var(--rie-tint);border-color:transparent;color:var(--rie-accent)}
.image-editor-root svg{flex-shrink:0}
.image-editor-root .rie-theme{min-width:0}
.image-editor-root .rie-toolbar{justify-content:flex-start;gap:10px;padding:8px 12px;min-height:52px}
.image-editor-root .rie-toolbar-group{flex-shrink:0}
.image-editor-root .rie-toolbar-secondary{padding-left:10px;border-left:1px solid var(--rie-line)}
.image-editor-root .rie-toolbar-actions{margin-left:auto;gap:5px}
.image-editor-root .rie-icon-button{width:36px;height:36px;padding:8px}
.image-editor-root .rie-primary{font-weight:600}
.image-editor-root .rie-nav{gap:3px;padding:8px 6px;width:78px;scrollbar-width:thin;scrollbar-color:var(--rie-line) transparent;overscroll-behavior:contain}
.image-editor-root .rie-nav button{padding:8px 2px;gap:5px;min-height:54px;border-radius:10px;color:var(--rie-secondary);font-weight:550;scroll-margin:8px}
.image-editor-root .rie-nav button[aria-pressed="true"]{color:var(--rie-accent);background:var(--rie-tint)}
.image-editor-root .rie-nav-wrap{position:relative;flex-shrink:0;width:78px;min-height:0;background:var(--rie-panel)}
.image-editor-root .rie-nav-wrap .rie-nav{height:100%;padding-block:12px}
.image-editor-root .rie-nav-scroll{position:absolute;z-index:2;left:0;width:100%;height:26px;min-height:26px;border:0;border-radius:0;padding:3px;color:var(--rie-secondary);background:var(--rie-panel);box-shadow:0 0 15px 7px var(--rie-panel)}
.image-editor-root .rie-nav-scroll svg{width:15px;height:15px}
.image-editor-root .rie-nav-previous{top:0}
.image-editor-root .rie-nav-previous svg{transform:rotate(180deg)}
.image-editor-root .rie-nav-next{bottom:0}
.image-editor-root .rie-body[data-dock="right"] .rie-nav-wrap{order:3}
.image-editor-root .rie-options{width:244px;max-width:calc(100% - 78px);animation:rie-reveal .15s ease-out}
.image-editor-root .rie-options-heading{padding:9px 10px 6px 16px;min-height:47px;border:0}
.image-editor-root .rie-options-heading h2{font-weight:650;letter-spacing:-.01em}
.image-editor-root .rie-options-content{padding:8px 16px 18px;gap:16px;scrollbar-width:thin;scrollbar-color:var(--rie-line) transparent}
.image-editor-root .rie-stack{gap:14px}
.image-editor-root .rie-mixed-label{margin-inline-start:6px;color:var(--rie-secondary);font-style:italic;font-weight:400}
.image-editor-root .rie-text-toolbar{display:flex;align-items:center;gap:4px}
.image-editor-root .rie-text-toolbar .rie-icon-button{flex:1;justify-content:center;min-width:32px;min-height:36px}
.image-editor-root .rie-panel-text{min-width:0;min-height:72px;max-height:150px;overflow:auto;border:1px solid var(--rie-line);border-radius:7px;background:var(--rie-bg);color:var(--rie-fg);padding:8px;outline:none}
.image-editor-root .rie-panel-text:focus{border-color:var(--rie-accent);box-shadow:0 0 0 1px var(--rie-accent)}
.image-editor-root .rie-panel-text[contenteditable="true"],.image-editor-root .rie-panel-text[contenteditable="true"] *,.image-editor-root .rie-panel-text [contenteditable="true"],.image-editor-root .rie-panel-text [contenteditable="true"] *{color:var(--rie-fg)!important;background-color:transparent!important}
.image-editor-root .rie-panel-text[aria-readonly="true"]{color:var(--rie-fg);background:var(--rie-muted);cursor:default}
.image-editor-root .rie-panel-text[aria-readonly="true"] *{color:var(--rie-fg)!important;background-color:transparent!important}
.image-editor-root .rie-text-formatting{min-width:0}
.image-editor-root .rie-text-color-hint{margin-top:-8px;font-size:10px;line-height:1.3}
.image-editor-root [data-mixed="true"]{background-image:linear-gradient(135deg,transparent 44%,var(--rie-line) 45%,var(--rie-line) 55%,transparent 56%)}
.image-editor-root button[aria-pressed="mixed"]{border-color:var(--rie-accent);background:repeating-linear-gradient(135deg,var(--rie-tint),var(--rie-tint) 4px,transparent 4px,transparent 8px);color:var(--rie-accent)}
.image-editor-root .rie-selection-count{margin:0;font-weight:600;color:var(--rie-fg)}
.image-editor-root .rie-rights-notice{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--rie-line);border-radius:8px;background:var(--rie-muted);color:var(--rie-fg);line-height:1.45}
.image-editor-root .rie-rights-notice svg{width:16px;height:16px;flex:none;margin-top:1px;color:var(--rie-accent)}
.image-editor-root .rie-layer-rights{display:inline-flex;align-items:center;justify-content:center;width:28px;min-height:32px;flex:none;color:var(--rie-secondary)}
.image-editor-root .rie-layer-rights svg{width:16px;height:16px}
.image-editor-root .rie-control-group{min-width:0;border:0;padding:0;margin:0}
.image-editor-root .rie-control-group legend{font-size:11px;color:var(--rie-secondary);margin-bottom:6px}
.image-editor-root .rie-alignment-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.image-editor-root .rie-alignment-grid .rie-icon-button{width:100%;min-height:36px;justify-content:center}
.image-editor-root .rie-advanced{border-block:1px solid var(--rie-line);padding-block:4px}
.image-editor-root .rie-advanced summary{padding:8px 0;cursor:pointer;font-weight:600;font-size:12px}
.image-editor-root .rie-advanced summary:focus-visible{outline:2px solid var(--rie-accent);outline-offset:3px}
.image-editor-root .rie-advanced>.rie-stack{padding:8px 0}
.image-editor-root .rie-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.image-editor-root .rie-grid>button{padding-inline:6px;font-size:11px;border-color:var(--rie-line);flex-wrap:wrap;min-height:42px}
.image-editor-root .rie-label{gap:7px}
.image-editor-root .rie-label output{font-variant-numeric:tabular-nums;color:var(--rie-fg);font-size:11px;min-width:30px;text-align:right}
.image-editor-root input[type="number"]{height:36px;font-variant-numeric:tabular-nums}
.image-editor-root input[type="range"]{height:22px;margin:0;cursor:ew-resize;touch-action:pan-y}
.image-editor-root input[type="color"]{padding:0;width:30px;height:30px;min-width:30px;border-radius:50%;background:conic-gradient(#e5484d,#facc15,#30a46c,#3b82f6,#8b5cf6,#e5484d);overflow:hidden;cursor:pointer}
.image-editor-root input[type="color"]::-webkit-color-swatch-wrapper{padding:5px}
.image-editor-root input[type="color"]::-webkit-color-swatch{border:2px solid var(--rie-panel);border-radius:50%}
.image-editor-root textarea{min-height:78px}
.image-editor-root .rie-color-field{border:0;padding:0;margin:0;min-width:0}
.image-editor-root .rie-color-field legend{font-size:11px;color:var(--rie-secondary);margin-bottom:8px;padding:0}
.image-editor-root .rie-swatches{display:grid;grid-template-columns:repeat(5,1fr);justify-items:center;align-items:center;gap:7px}
.image-editor-root .rie-swatch{width:28px;height:28px;min-height:28px;padding:0;border:1px solid #80808040;border-radius:50%;box-shadow:inset 0 0 0 2px var(--rie-panel)}
.image-editor-root .rie-swatch[aria-pressed="true"]{outline:2px solid var(--rie-accent);outline-offset:2px}
.image-editor-root .rie-swatch:hover{transform:scale(1.08)}
.image-editor-root .rie-presets{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 8px}
.image-editor-root .rie-presets button{display:flex;flex-direction:column;gap:6px;padding:3px 3px 7px;min-width:0;border:1px solid transparent;border-radius:9px;overflow:hidden;font-size:11px}
.image-editor-root .rie-presets button[aria-pressed="true"]{border-color:var(--rie-accent)}
.image-editor-root .rie-presets canvas{display:block;width:100%;height:auto;aspect-ratio:3/2;border-radius:6px;background:var(--rie-muted)}
.image-editor-root .rie-crop-mode{display:flex;gap:3px;border:1px solid var(--rie-line);border-radius:9px;padding:3px;background:var(--rie-bg)}
.image-editor-root .rie-crop-heading-actions{display:flex;align-items:center;gap:4px}
.image-editor-root .rie-crop-heading-actions .rie-primary{min-height:28px;padding:4px 8px;font-size:12px}
.image-editor-root .rie-crop-mode button{flex:1;min-width:0;min-height:34px;font-size:12px;gap:6px}
.image-editor-root .rie-crop-zoom{display:flex;align-items:center;gap:4px;min-width:0}
.image-editor-root .rie-crop-zoom>span{flex:1;font-size:12px;color:var(--rie-secondary)}
.image-editor-root .rie-crop-zoom .rie-icon-button{width:32px;min-height:32px;height:32px}
.image-editor-root .rie-crop-size{display:flex;gap:8px;align-items:flex-end;min-width:0}
.image-editor-root .rie-crop-size>.rie-label{flex:1;min-width:0}
.image-editor-root .rie-crop-size>.rie-icon-button{flex:none;height:36px;width:30px;min-height:36px;margin-bottom:1px}
.image-editor-root .rie-crop-details{min-width:0;border-top:1px solid var(--rie-line);padding-top:8px}
.image-editor-root .rie-crop-details>summary{cursor:pointer;font-size:12px;color:var(--rie-fg);padding:5px 0}
.image-editor-root .rie-crop-details>.rie-stack{padding-top:10px}
.image-editor-root .rie-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--rie-fg);min-height:32px;cursor:pointer}
.image-editor-root .rie-check input{width:16px;height:16px;flex:none;accent-color:var(--rie-accent)}
.image-editor-root .rie-picker-group{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:var(--rie-secondary);padding:8px 9px 4px}
.image-editor-root .rie-ratios{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
.image-editor-root .rie-ratios button{min-width:0;min-height:62px;flex-direction:column;padding:7px 2px;gap:6px;font-size:10px;overflow-wrap:anywhere}
.image-editor-root .rie-ratio-outline{display:block;height:19px;max-width:29px;border:1.5px solid currentColor;border-radius:2px}
.image-editor-root .rie-actions-row{justify-content:flex-end}
.image-editor-root .rie-picker{position:relative}
.image-editor-root .rie-picker-trigger{width:100%;justify-content:space-between;border:1px solid var(--rie-line);background:var(--rie-bg);color:var(--rie-fg);font-size:12px;text-align:left}
.image-editor-root .rie-picker-trigger>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.image-editor-root .rie-picker-trigger svg{width:16px;height:16px}
.image-editor-root .rie-picker-popup{position:relative;z-index:7;margin-top:2px;border:1px solid var(--rie-line);border-radius:9px;background:var(--rie-bg);padding:6px;box-shadow:0 6px 20px #0001}
.image-editor-root .rie-picker-popup [role="listbox"]{max-height:170px;overflow:auto;margin-top:5px;scrollbar-width:thin}
.image-editor-root .rie-picker-popup button{width:100%;justify-content:space-between;text-align:left;min-height:34px;padding:7px}
.image-editor-root .rie-symbols{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.image-editor-root .rie-symbols button{font-size:30px;line-height:1;min-height:48px;padding:4px;color:var(--rie-accent);border-color:var(--rie-line)}
.image-editor-root .rie-frame-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.image-editor-root .rie-frame-presets button{flex-direction:column;padding:6px 3px;min-width:0;font-size:10px;gap:7px}
.image-editor-root .rie-frame-preview{display:block;width:42px;height:34px;background:linear-gradient(140deg,#97d6da,#47758e);border:5px solid var(--rie-fg);border-radius:1px}
.image-editor-root .rie-frame-preview[data-frame="none"]{border:0}
.image-editor-root .rie-frame-preview[data-frame="inset"]{border-width:2px;box-shadow:inset 0 0 0 4px var(--rie-panel)}
.image-editor-root .rie-frame-preview[data-frame="double"]{border:4px double var(--rie-fg)}
.image-editor-root .rie-frame-preview[data-frame="mat"]{border:7px solid var(--rie-fg)}
.image-editor-root .rie-frame-preview[data-frame="polaroid"]{border-bottom-width:12px}
.image-editor-root .rie-frame-preview[data-frame="bevel"]{border-style:ridge}
.image-editor-root .rie-frame-preview[data-frame="hooks"]{border-style:dashed}
.image-editor-root .rie-frame-preview[data-frame="cross"]{border-width:3px 8px}
.image-editor-root .rie-frame-preview[data-frame="edge"]{border-width:0 0 5px}
.image-editor-root .rie-transparent-preview{width:20px;height:20px;border:1px solid var(--rie-line);border-radius:4px;background:repeating-conic-gradient(#bbb 0% 25%,#fff 0% 50%) 0 0/10px 10px}
.image-editor-root .rie-layer-list{display:flex;flex-direction:column;gap:4px;padding-top:12px;border-top:1px solid var(--rie-line)}
.image-editor-root .rie-layer-list h3{font-size:11px;font-weight:600;color:var(--rie-secondary);margin:0 0 6px}
.image-editor-root .rie-layer-list button{justify-content:flex-start;min-width:0;min-height:38px}
.image-editor-root .rie-layer-list button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
.image-editor-root .rie-layer-list button svg{width:16px;height:16px}
.image-editor-root .rie-layer-row{display:flex;align-items:center;gap:2px;min-width:0}
.image-editor-root .rie-layer-row>button:first-child{flex:1;flex-shrink:1}
.image-editor-root .rie-layer-row .rie-icon-button{width:28px;min-height:32px;padding:5px;justify-content:center}
.image-editor-root .rie-help{font-size:11px;line-height:1.6}
.image-editor-root .rie-shortcuts{padding:10px 16px;background:var(--rie-tint);border-bottom:1px solid var(--rie-line)}
.image-editor-root .rie-error{padding:9px 14px}
.image-editor-root .rie-canvas[data-drag-over="true"]{outline:3px dashed var(--rie-accent);outline-offset:-12px;background:var(--rie-tint)}
.image-editor-root .rie-canvas .rie-canvas-text{padding:0;resize:none;outline:2px solid var(--rie-accent);outline-offset:4px;box-shadow:0 0 0 5px var(--rie-bg);border-radius:0;min-height:0}
.image-editor-root .rie-artboard{box-shadow:0 2px 5px #0001,0 12px 30px #0002}
.image-editor-root .rie-statusbar{display:flex;align-items:center;justify-content:space-between;min-height:40px;gap:8px;padding:3px 10px;border-top:1px solid var(--rie-line);background:var(--rie-panel);flex-shrink:0}
.image-editor-root .rie-status-context{display:flex;align-items:center;gap:14px;min-width:0}
.image-editor-root .rie-dimensions{font-size:10px;color:var(--rie-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.image-editor-root .rie-tool-hint{font-size:10px;color:var(--rie-secondary);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.image-editor-root .rie-original-label{font-size:10px;border-radius:4px;background:var(--rie-tint);color:var(--rie-accent);padding:3px 7px}
.image-editor-root .rie-statusbar .rie-icon-button{width:30px;height:30px;min-height:30px;padding:6px}
.image-editor-root .rie-statusbar svg{width:17px;height:17px}
.image-editor-root .rie-zoom-level{min-width:48px;min-height:30px;font-size:10px;padding:4px;font-variant-numeric:tabular-nums}
.image-editor-root .rie-export-panel{display:flex;align-items:center;gap:16px;padding:8px 12px;border-bottom:1px solid var(--rie-line);background:var(--rie-panel);flex-shrink:0}
.image-editor-root .rie-export-panel>.rie-label{flex:1;min-width:75px;max-width:220px;gap:0}
.image-editor-root .rie-export-panel>.rie-icon-button{margin-left:auto}
@keyframes rie-reveal{from{opacity:0}to{opacity:1}}
@container (max-width:760px){
 .image-editor-root .rie-toolbar{padding:5px 8px;gap:6px;min-height:44px}
 .image-editor-root .rie-toolbar-secondary{padding-left:6px}
 .image-editor-root .rie-body{flex-direction:column}
 .image-editor-root .rie-body .rie-nav{order:3;flex-direction:row;gap:4px;width:100%;border:0;border-top:1px solid var(--rie-line);padding:5px 6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
 .image-editor-root .rie-body .rie-nav-wrap{order:3;width:100%;height:60px}
 .image-editor-root .rie-nav-wrap .rie-nav{padding-inline:12px}
 .image-editor-root .rie-nav-scroll{top:1px;bottom:0;width:25px;height:calc(100% - 1px);box-shadow:0 0 10px 4px var(--rie-panel)}
 .image-editor-root .rie-nav-previous{left:0;right:auto}
 .image-editor-root .rie-nav-previous svg{transform:rotate(90deg)}
 .image-editor-root .rie-nav-next{left:auto;right:0}
 .image-editor-root .rie-nav-next svg{transform:rotate(-90deg)}
 .image-editor-root .rie-nav button{flex:1 0 58px;min-height:48px;padding:5px 4px;gap:4px;font-size:10px;border-radius:8px}
 .image-editor-root .rie-body .rie-canvas-wrap{order:0;min-height:100px}
 .image-editor-root .rie-body .rie-options{order:1;width:100%;max-width:100%;max-height:var(--rie-options-max-height,170px);border:0;border-top:1px solid var(--rie-line)}
 .image-editor-root .rie-options-heading{padding:3px 8px 2px 12px;min-height:33px}
 .image-editor-root .rie-options-heading h2{font-size:12px}
 .image-editor-root .rie-options-heading .rie-icon-button{width:28px;height:28px;min-height:28px;padding:5px}
 .image-editor-root .rie-options-content{padding:5px 12px 12px;gap:12px}
 .image-editor-root .rie-presets{display:flex;overflow-x:auto;gap:8px;flex-shrink:0;padding:2px 0 4px}
 .image-editor-root .rie-presets button{width:86px;flex-shrink:0}
 .image-editor-root .rie-ratios{display:flex;gap:4px;overflow-x:auto;flex-shrink:0}
 .image-editor-root .rie-ratios button{flex:1 0 48px;min-height:53px}
 .image-editor-root .rie-swatches{display:flex;flex-wrap:wrap;gap:10px}
 .image-editor-root .rie-frame-presets{grid-template-columns:repeat(6,minmax(0,1fr))}
 .image-editor-root [data-testid="native-resize-panel"]{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 .image-editor-root [data-testid="native-resize-lock"]{grid-column:1/-1;justify-self:start}
 .image-editor-root .rie-statusbar{min-height:34px;padding:1px 8px}
 .image-editor-root .rie-tool-hint{display:none}
 .image-editor-root .rie-stack{gap:12px}
}
@container (max-width:400px){
 .image-editor-root .rie-toolbar{gap:3px;padding-inline:5px}
 .image-editor-root .rie-toolbar-secondary{padding-left:3px}
 .image-editor-root .rie-toolbar .rie-icon-button{width:32px;height:34px;min-height:34px;padding:6px}
 .image-editor-root .rie-toolbar-actions{gap:1px}
 .image-editor-root .rie-toolbar-actions button{font-size:11px;padding:7px}
 .image-editor-root .rie-toolbar-actions .rie-primary svg{display:none}
 .image-editor-root .rie-export-panel{gap:7px;padding:6px}
 .image-editor-root .rie-export-panel .rie-row{gap:1px;flex-wrap:nowrap}
 .image-editor-root .rie-export-panel .rie-row button{padding:7px;font-size:10px}
 .image-editor-root .rie-frame-presets{grid-template-columns:repeat(3,minmax(0,1fr))}
 .image-editor-root .rie-help-button{display:none}
}
@container (max-width:760px){
 .image-editor-root .rie-theme[data-short="true"] .rie-statusbar{display:none}
 .image-editor-root .rie-theme[data-short="true"] .rie-toolbar{min-height:38px;padding-block:2px}
 .image-editor-root .rie-theme[data-short="true"] .rie-nav{padding-block:3px}
 .image-editor-root .rie-theme[data-short="true"] .rie-nav button{min-height:42px;padding-block:3px}
 .image-editor-root .rie-theme[data-short="true"] .rie-nav-wrap{height:49px}
 .image-editor-root .rie-theme[data-short="true"] .rie-canvas-wrap{min-height:64px}
 .image-editor-root .rie-theme[data-short="true"] .rie-options{max-height:max(86px,var(--rie-options-max-height))}
 .image-editor-root .rie-theme[data-short="true"] .rie-options-heading{min-height:24px;padding-block:0}
 .image-editor-root .rie-theme[data-short="true"] .rie-options-heading .rie-icon-button{width:24px;height:24px;min-height:24px;padding:3px}
 .image-editor-root .rie-theme[data-short="true"] .rie-options-content{padding:3px 10px 4px;gap:8px}
 .image-editor-root .rie-theme[data-short="true"] .rie-presets button{width:68px;padding:2px 2px 4px;gap:3px;font-size:10px}
 .image-editor-root .rie-theme[data-short="true"] .rie-presets canvas{height:30px;aspect-ratio:auto}
 .image-editor-root .rie-theme[data-short="true"] .rie-frame-presets{display:flex;overflow:auto;flex-shrink:0}
 .image-editor-root .rie-theme[data-short="true"] .rie-frame-presets button{min-width:58px;padding:3px;gap:4px}
 .image-editor-root .rie-theme[data-short="true"] .rie-frame-preview{height:24px;width:34px}
}
@media(pointer:coarse){.image-editor-root .rie-icon-button{min-height:40px}.image-editor-root .rie-swatch{width:32px;height:32px;min-height:32px}.image-editor-root input[type="range"]{height:30px}}
@media(prefers-reduced-motion:reduce){.image-editor-root *{animation:none!important;transition:none!important}}
`;
