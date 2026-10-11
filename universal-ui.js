/* Universal local-file metadata UI, preserving the legacy advanced PDF editor. */
(function(){
"use strict";
var css=[
".u-shell{max-width:1120px;margin:24px auto 70px;padding:0 18px;color:#172b48}",
".u-nav{max-width:1120px;margin:16px auto 0;padding:0 18px;display:flex;gap:10px;flex-wrap:wrap}",
".u-nav button,.u-button{border:1px solid #a5b8cf;border-radius:9px;padding:11px 15px;font-weight:700;cursor:pointer;background:#e9f0f9;color:#123257}",
".u-nav button[aria-pressed=true],.u-button.primary{background:#155eef;border-color:#155eef;color:white}",
".u-hero{padding:27px;background:linear-gradient(120deg,#162849,#245294);color:white;border-radius:18px}",
".u-hero h2{color:white;margin:0 0 8px;font-size:26px}.u-hero p{color:#e3ecff;line-height:1.6;margin:0}",
".u-drop{margin-top:20px;padding:32px;text-align:center;background:#f4f8ff;border:2px dashed #98b4db;border-radius:13px;cursor:pointer}",
".u-drop.drag{background:#deedff}.u-drop strong{display:block;font-size:17px;margin-bottom:8px}",
".u-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.u-button:disabled{opacity:.48;cursor:not-allowed}",
".u-note{font-size:13px;color:#43516a;line-height:1.6}.u-panel{border:1px solid #d4deeb;border-radius:12px;overflow:hidden;background:white;margin-top:18px}",
".u-panel h3{padding:15px;margin:0;background:#f1f5fa;font-size:16px}",
".u-table{width:100%;border-collapse:collapse;font-size:13px}.u-table th,.u-table td{border-bottom:1px solid #dbe3ed;padding:11px 9px;text-align:left;overflow-wrap:anywhere}",
".u-table th{background:#f6f9fc}.u-report{padding:14px;max-height:360px;overflow:auto;white-space:pre-wrap;font-size:12px}",
".u-status{padding:4px 8px;border-radius:15px;background:#f0e8d4;color:#65501a;display:inline-block}.u-status.ok{background:#dff6e8;color:#145c35}.u-status.error{background:#fce3e3;color:#912424}",
".u-fields{padding:14px 16px;border-top:1px solid #dbe3ed}.u-fields summary{cursor:pointer;font-weight:700}.u-fields table{width:100%;border-collapse:collapse;margin-top:12px}.u-fields th,.u-fields td{text-align:left;vertical-align:top;border-bottom:1px solid #e4e9f3;padding:9px;font-size:12px;overflow-wrap:anywhere}.u-fields th{width:24%}.u-fields td:nth-child(2){max-width:500px;white-space:pre-wrap}.u-warning{padding:8px 0;color:#70551d;font-size:12px}",
"@media(max-width:700px){.u-table{font-size:11px}.u-table th,.u-table td{padding:8px 4px}.u-hero{padding:18px}}"
].join("");
var style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
var header=document.querySelector("header"),main=document.querySelector("main");
var nav=document.createElement("div");nav.className="u-nav";nav.setAttribute("aria-label","Application mode");
nav.innerHTML='<button id="u-mode" aria-pressed="true" type="button">All files · Inspect & clean</button><button id="u-pdf-mode" aria-pressed="false" type="button">Advanced PDF editor</button>';
header.insertAdjacentElement("afterend",nav);
var shell=document.createElement("section");shell.className="u-shell";shell.setAttribute("aria-label","Local metadata workspace");
shell.innerHTML=[
'<div class="u-hero"><h2>Universal File Metadata Inspector & Cleaner</h2><p>Inspect any local file. Remove supported metadata from JPEG, PNG, WebP, GIF, FLAC, MP3, WAV, PDF and Office files. Other recognized file formats are inspection-only. Unsupported types are inspection-only. SynthID and other embedded content watermarks are not certified removable or detectable.</p></div>',
'<div class="u-drop" id="u-drop" role="button" tabindex="0" aria-label="Choose local files"><strong>Drop files here or choose files</strong><p class="u-note">Local processing · No file upload · Up to 100 files · 256 MiB per file · 384 MiB per batch</p><button id="u-choose" type="button" class="u-button primary">Choose files</button><input id="u-files" type="file" multiple hidden/></div>',
'<div class="u-toolbar"><button class="u-button primary" id="u-inspect" disabled>Inspect files</button><button class="u-button" id="u-clean" disabled>Remove supported metadata & download</button><button class="u-button" id="u-cancel" disabled>Cancel after current file</button><button class="u-button" id="u-report" disabled>Export JSON report</button><button class="u-button" id="u-clear">Clear</button></div>',
'<p class="u-note"><strong>Limits:</strong> Format-aware cleanup does not prove absence of all metadata, invisible watermarks, or SynthID. Existing signatures are protected; keep the original file. No file is sent to a backend.</p>',
'<p class="u-note" id="u-progress" role="status" aria-live="polite">Select files to begin.</p>',
'<section class="u-panel"><h3>File inspection and cleaning</h3><div style="overflow-x:auto"><table class="u-table"><thead><tr><th>File</th><th>Format</th><th>Known metadata blocks</th><th>Status</th></tr></thead><tbody id="u-rows"></tbody></table></div></section>',
'<section class="u-panel"><h3>Extracted metadata fields</h3><div class="u-note" style="padding:10px 16px">Expand a file to view parsed metadata names, values and source structures. Coverage is partial; compressed or unknown metadata may remain.</div><div id="u-fields"></div></section>',
'<section class="u-panel"><h3>Detailed results & warnings</h3><pre class="u-report" id="u-details">No files selected.</pre></section>'
].join("");
header.parentNode.insertBefore(shell,main);main.style.display="none";
var $=id=>document.getElementById(id);
var selected=[],results=[],busy=false,cancelRequested=false,maxBytes=256*1024*1024,maxBatchBytes=384*1048576;
function mode(v){shell.style.display=v?"":"none";main.style.display=v?"none":"";$("u-mode").setAttribute("aria-pressed",String(v));$("u-pdf-mode").setAttribute("aria-pressed",String(!v));}
$("u-mode").onclick=()=>mode(true);$("u-pdf-mode").onclick=()=>mode(false);
var drop=$("u-drop"),input=$("u-files");
drop.onclick=e=>{if(e.target!==$("u-choose"))input.click();};
drop.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.click();}};
$("u-choose").onclick=e=>{e.stopPropagation();input.click();};
drop.ondragover=e=>{e.preventDefault();drop.classList.add("drag");};
drop.ondragleave=()=>drop.classList.remove("drag");
drop.ondrop=e=>{e.preventDefault();drop.classList.remove("drag");setFiles(Array.from(e.dataTransfer.files));};
input.onchange=()=>setFiles(Array.from(input.files));
function setFiles(fs){if(busy)return;selected=fs.slice(0,100);results=selected.map(f=>({file:f,name:f.name,size:f.size,format:"Pending",count:"—",status:"Ready",notes:[]}));$("u-progress").textContent=selected.length+" files selected."+(fs.length>100?" Maximum first 100 accepted.":"");refresh();}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function refresh(){
 $("u-inspect").disabled=busy||!selected.length;$("u-clean").disabled=busy||!selected.length;$("u-report").disabled=busy||!results.length;$("u-clear").disabled=busy;$("u-cancel").disabled=!busy||cancelRequested;
 $("u-rows").innerHTML=results.length?results.map(r=>'<tr><td>'+esc(r.name)+'<div class="u-note">'+(r.size/1048576).toFixed(2)+' MiB</div></td><td>'+esc(r.format)+'</td><td>'+esc(r.count)+'</td><td><span class="u-status '+(r.status==="Known tags rechecked"?"ok":(r.status.startsWith("Error")||r.status.startsWith("Unsupported")?"error":""))+'">'+esc(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="4">No files selected</td></tr>';
 $("u-fields").innerHTML=results.length?results.map((r,i)=>{
  const fields=r.metadataFields||[],warnings=r.metadataWarnings||[],diff=r.metadataDiff;
  const rowHtml=fields.map(f=>'<tr><th scope="row">'+esc(f.name)+'</th><td>'+esc(f.value)+'</td><td>'+esc(f.source)+'</td></tr>').join("");
  const warningHtml=warnings.map(w=>'<div class="u-warning">'+esc(w)+'</div>').join("");
  return '<details class="u-fields" '+(results.length===1?'open':'')+'><summary>'+esc(r.name)+' — '+fields.length+' extracted field(s) · '+esc(r.format)+'</summary>'+
  (fields.length?'<table><thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead><tbody>'+rowHtml+'</tbody></table>':'<p class="u-note">No field values extracted by the available parsers. This does not prove metadata absence.</p>')+
  (diff?'<h4>Before / after metadata</h4><p class="u-note">Extracted fields removed: '+diff.removed.length+' · Retained: '+diff.retained.length+' · New: '+diff.added.length+'</p>'+
  (diff.removed.length?'<div class="u-warning"><strong>Removed parsed values:</strong> '+diff.removed.map(f=>esc(f.name)+': '+esc(f.value)).join('; ')+'</div>':''):'')+
  (r.contentVerification?'<div class="u-note">Content verification: '+esc(r.contentVerification.level)+' — '+esc(r.contentVerification.checks.join("; "))+'</div>':'')+
  warningHtml+'</details>';
 }).join(""):'<p class="u-note" style="padding:14px">Select and inspect files to see their real metadata fields.</p>';
 $("u-details").textContent=JSON.stringify(results.map(({file,...data})=>data),null,2);
}
async function bytesOf(r){if(r.size>maxBytes)throw Error("File exceeds 256 MiB browser safety limit");if(!r.size)throw Error("Empty file");return new Uint8Array(await r.file.arrayBuffer());}
async function hash(a){if(a.length>32*1024*1024)return "Skipped for large file";const h=await crypto.subtle.digest("SHA-256",a);return Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,"0")).join("");}
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type:type||"application/octet-stream"}));const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();setTimeout(()=>{URL.revokeObjectURL(url);link.remove();},20000);}
async function run(clean){
 if(busy)return;
 if(selected.reduce((n,f)=>n+f.size,0)>maxBatchBytes){
  $("u-progress").textContent="The batch exceeds 384 MiB. Choose fewer files to limit browser memory use.";return;
 }
 cancelRequested=false;busy=true;refresh();
 const outputs=[],usedOutputNames=new Set(),zipLib=window.JSZip,pdfLib=window.PDFLib;
 for(let i=0;i<results.length;i++){
  await new Promise(resolve=>setTimeout(resolve,0));
  if(cancelRequested){
   for(let j=i;j<results.length;j++)results[j].status="Canceled";
   break;
  }
  const r=results[i];r.status=clean?"Cleaning":"Inspecting";$("u-progress").textContent=(i+1)+"/"+results.length+": "+r.name;refresh();
  try{
   const data=await bytesOf(r);
   const out=await FileMetaEngine.process(data,r.name,{remove:clean,zipLib,pdfLib});
   if(typeof FileMetaInspector==="undefined"||typeof FileMetaVerifier==="undefined")throw Error("Metadata inspector/verifier unavailable; refusing to certify results");
   const inspected=await FileMetaInspector.inspect(data,r.name,{zipLib,pdfLib});
   r.metadataFields=inspected.fields;
   r.metadataWarnings=inspected.warnings;
   r.metadataCoverage=inspected.coverage;
   r.format=out.format;r.count=out.count;r.notes=out.notes||[];r.removed=out.removed;r.verification=out.verification;
   r.sha256=await hash(data);
   r.synthIdDetection="Not assessed: no trusted content watermark detector is integrated";
   if(!out.supported){r.status="Unsupported / inspect only";refresh();continue;}
   if(clean&&out.changed){
    const recheck=await FileMetaEngine.process(out.bytes,r.name,{remove:false,zipLib,pdfLib});
    if(!recheck.supported||recheck.count!==0)throw Error("Post-clean validation failed; refusing download");
    const integrity=await FileMetaVerifier.verify(data,out.bytes,out.format,{zipLib,pdfLib});
    if(!integrity.preserved)throw Error("Preserved file content was not verified; refusing download");
    r.contentVerification=integrity;
    const after=await FileMetaInspector.inspect(out.bytes,r.name,{zipLib,pdfLib});
    if(after.format!==inspected.format)throw Error("Output format changed unexpectedly; refusing download");
    const fingerprints=["Width","Height","Channels","Sample rate","Pages"];
    for(const key of fingerprints){
     const beforeField=inspected.fields.find(f=>f.name===key),afterField=after.fields.find(f=>f.name===key);
     if(beforeField&&(!afterField||afterField.value!==beforeField.value))throw Error("Output structural property changed: "+key);
    }
    r.remainingFields=after.fields;r.remainingFieldWarnings=after.warnings;
    const originalFields=inspected.fields;
    const originalSet=new Set(originalFields.map(f=>JSON.stringify([f.name,f.value,f.source])));
    const remainingSet=new Set(after.fields.map(f=>JSON.stringify([f.name,f.value,f.source])));
    r.metadataDiff={
     removed:originalFields.filter(f=>!remainingSet.has(JSON.stringify([f.name,f.value,f.source]))),
     retained:originalFields.filter(f=>remainingSet.has(JSON.stringify([f.name,f.value,f.source]))),
     added:after.fields.filter(f=>!originalSet.has(JSON.stringify([f.name,f.value,f.source])))
    };
    r.status="Known tags rechecked";r.changed=true;r.outputSize=out.bytes.length;
    r.verification="Known removable blocks absent, retained content "+integrity.level+" and selected structure rechecked; hidden metadata and SynthID NOT certified absent";
    r.outputSha256=await hash(out.bytes);
    const safeName=r.name.replace(/[\\/\x00-\x1f]/g,"_").slice(0,180)||"unnamed";
    const base=safeName.replace(/([.][^.]+)?$/,(_,extension)=>"_metadata-removed"+(extension||""));
    let fileName=base,number=2;
    while(usedOutputNames.has(fileName)){fileName=base.replace(/([.][^.]+)?$/,(_,ext)=>"_"+number+++(ext||""));}
    usedOutputNames.add(fileName);
    outputs.push({filename:fileName,bytes:out.bytes});
   }else r.status=clean?"No known removable blocks":"Inspected";
  }catch(e){r.status="Error: "+(e.message||String(e));r.notes=[r.status];}
  refresh();
 }
 let packageError="";
 if(clean&&outputs.length){
  try{
   if(outputs.length===1)download(outputs[0].bytes,outputs[0].filename);
   else if(zipLib){const zip=new zipLib();outputs.forEach(x=>zip.file(x.filename,x.bytes));const data=await zip.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:3}});download(data,"cleaned_files.zip","application/zip");}
   else packageError=" Batch ZIP unavailable (JSZip missing).";
  }catch(e){packageError=" Export failed: "+(e.message||e);}
 }
 busy=false;$("u-progress").textContent=(clean?"Cleanup finished. ":"Inspection finished. ")+results.filter(r=>r.status==="Known tags rechecked").length+" rechecked file(s) with selected metadata removed."+packageError;refresh();
}
$("u-inspect").onclick=()=>run(false);
$("u-clean").onclick=()=>run(true);
$("u-cancel").onclick=()=>{if(busy){cancelRequested=true;$("u-progress").textContent="Cancellation requested; current operation will finish first.";refresh();}};
$("u-report").onclick=()=>{
 const doc={tool:"Local File Metadata Inspector",generatedAt:new Date().toISOString(),warning:"The field listing and cleanup cover only documented parser capabilities; unknown/internal metadata may remain. SynthID and invisible watermarks are NOT assessed and cannot be certified absent.",files:results.map(({file,...r})=>r)};
 download(new TextEncoder().encode(JSON.stringify(doc,null,2)),"metadata-report.json","application/json");
};
$("u-clear").onclick=()=>{selected=[];results=[];input.value="";$("u-progress").textContent="Selection cleared.";refresh();};
refresh();
})();
