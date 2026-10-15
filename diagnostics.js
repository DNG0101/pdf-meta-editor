/* Local, bounded diagnostics. Metadata values/file bytes are never logged here. */
(function(){
'use strict';
const events=[],limit=200;
function record(stage,details={}){
 const safe={};
 for(const key of ['message','stack','operation','verification','changedFields','durationMs','format','size','status'])if(details[key]!==undefined)safe[key]=typeof details[key]==='string'?details[key].slice(0,3000):details[key];
 events.push({time:new Date().toISOString(),stage,details:safe});if(events.length>limit)events.shift();
 const view=document.getElementById('debug-events');if(view)view.textContent=JSON.stringify(events,null,2);
}
function report(){return {version:'0.8.0',generatedAt:new Date().toISOString(),environment:{userAgent:navigator.userAgent,secureContext:window.isSecureContext,webAssembly:typeof WebAssembly!=='undefined',crypto:!!window.crypto?.subtle},engines:{pdf:!!window.PDFLib,zip:!!window.JSZip,exif:!!window.FileMetaExifTool},events:events.slice(),scope:'Local diagnostics only. May include error paths; review before sharing. No selected file bytes or parsed metadata values are intentionally recorded.'};}
window.FileMetaDiagnostics={record,report};
window.addEventListener('error',e=>record('uncaught-error',{message:e.message,stack:e.error?.stack}));
window.addEventListener('unhandledrejection',e=>record('unhandled-rejection',{message:String(e.reason?.message||e.reason),stack:e.reason?.stack}));
document.addEventListener('DOMContentLoaded',()=>{
 const panel=document.createElement('details');panel.style.cssText='max-width:1080px;margin:20px auto;padding:16px;border:1px solid #aac;border-radius:10px';
 panel.innerHTML='<summary>Diagnostics & troubleshooting</summary><p>Local event log, engine availability and error details. Review the report before sharing it.</p><button type="button" id="debug-save">Download debug report</button> <button type="button" id="debug-clear">Clear debug log</button><pre id="debug-events" style="max-height:300px;overflow:auto;white-space:pre-wrap"></pre>';
 document.body.appendChild(panel);
 document.getElementById('debug-clear').onclick=()=>{events.length=0;document.getElementById('debug-events').textContent='[]';};
 document.getElementById('debug-save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='metadata-debug.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 record('ready',{status:'Diagnostic logging active'});
});
})();
