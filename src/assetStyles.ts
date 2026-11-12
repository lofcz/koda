/** Scoped CSS for font, background and image-frame controls. */
export const assetStyles = `
.image-editor-root .rie-choice-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.image-editor-root .rie-picker-popup button{gap:8px}
.image-editor-root .rie-picker-popup button svg{width:16px;height:16px;flex:none}
.image-editor-root .rie-font-status{flex:none;font-size:10px;color:var(--rie-secondary)}
.image-editor-root .rie-font-status[data-status="loading"]::before{content:"";display:inline-block;width:8px;height:8px;margin-right:5px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-1px;animation:rie-spin .8s linear infinite}
.image-editor-root .rie-font-status[data-status="failed"]{color:#c2410c}
.image-editor-root[data-scheme="dark"] .rie-font-status[data-status="failed"]{color:#fb923c}
@keyframes rie-spin{to{transform:rotate(360deg)}}
.image-editor-root .rie-asset-section{border-top:1px solid var(--rie-line);padding-top:12px}
.image-editor-root .rie-section-heading{font-size:11px;font-weight:600;color:var(--rie-secondary);margin:0}
.image-editor-root .rie-checker{background:repeating-conic-gradient(#c8cdd3 0% 25%,#fff 0% 50%) 0 0/10px 10px}
.image-editor-root[data-scheme="dark"] .rie-checker{background:repeating-conic-gradient(#3a4656 0% 25%,#252f3c 0% 50%) 0 0/10px 10px}
.image-editor-root .rie-asset-current{display:flex;align-items:center;gap:10px;min-width:0;padding:6px;border:1px solid var(--rie-line);border-radius:9px;background:var(--rie-bg)}
.image-editor-root .rie-asset-thumb{display:block;flex:none;border-radius:6px;overflow:hidden;line-height:0;box-shadow:inset 0 0 0 1px var(--rie-line)}
.image-editor-root .rie-asset-thumb canvas{display:block}
.image-editor-root .rie-asset-name{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.image-editor-root .rie-asset-current .rie-icon-button{width:30px;height:30px;min-height:30px;padding:6px}
.image-editor-root .rie-asset-current svg,.image-editor-root .rie-asset-section>button svg{width:16px;height:16px}
.image-editor-root .rie-asset-section>button{border-color:var(--rie-line)}
.image-editor-root .rie-asset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.image-editor-root .rie-asset-option{flex-direction:column;gap:5px;padding:4px 3px 6px;min-width:0;font-size:10px;border-color:transparent}
.image-editor-root .rie-asset-option>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.image-editor-root .rie-asset-option .rie-asset-thumb{width:56px;height:40px}
.image-editor-root .rie-asset-option[aria-busy="true"] .rie-asset-thumb{animation:rie-pulse 1.2s ease-in-out infinite}
@keyframes rie-pulse{50%{opacity:.45}}
.image-editor-root .rie-segmented{display:flex;gap:2px;padding:2px;border:1px solid var(--rie-line);border-radius:9px;background:var(--rie-bg)}
.image-editor-root .rie-segmented button{flex:1 1 0;min-width:0;min-height:30px;padding:4px 3px;font-size:11px;border-radius:7px}
.image-editor-root .rie-segmented button[aria-pressed="true"]{border-color:transparent}
.image-editor-root .rie-anchor-grid{display:grid;grid-template-columns:repeat(3,28px);gap:3px;padding:3px;width:max-content;border:1px solid var(--rie-line);border-radius:9px;background:var(--rie-bg)}
.image-editor-root .rie-anchor-grid button{width:28px;height:28px;min-height:28px;padding:0;border-radius:6px}
.image-editor-root .rie-anchor-grid button span{display:block;width:6px;height:6px;border-radius:50%;background:var(--rie-secondary);opacity:.55}
.image-editor-root .rie-anchor-grid button[aria-pressed="true"] span{width:10px;height:10px;background:var(--rie-accent);opacity:1}
.image-editor-root .rie-field-hint{margin:0;color:var(--rie-secondary);line-height:1.45}
.image-editor-root .rie-inline-error{margin:0;color:#c2410c}
.image-editor-root[data-scheme="dark"] .rie-inline-error{color:#fb923c}
.image-editor-root .rie-frame-presets canvas{display:block;width:42px;height:34px;border-radius:1px}
.image-editor-root .rie-frame-preview[data-frame="loading"]{border:0;background:var(--rie-muted);animation:rie-pulse 1.2s ease-in-out infinite}
.image-editor-root .rie-frame-preview[data-frame="unavailable"]{border:1px dashed var(--rie-secondary);background:transparent}
@container (max-width:760px){
 .image-editor-root .rie-asset-grid{display:flex;overflow-x:auto;flex-shrink:0}
 .image-editor-root .rie-asset-option{flex:0 0 68px}
}
`;
