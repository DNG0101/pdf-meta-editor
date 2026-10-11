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
"@media(max-width:700px){.u-table{font-size:11px}.u-table th,.u-table td{padding:8px 4px}.u-hero{padding:18px}}"
].join("");
var style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
var header=document.querySelector("header"),main=document.querySelector("main");
var nav=document.createElement("div");nav.className="u-nav";nav.setAttribute("aria-label","Application mode");
nav.innerHTML='<button id="u-mode" aria-pressed="true" type="button">All files · Inspect & clean</button><button id="u-pdf-mode" aria-pressed="false" type="button">Advanced PDF editor</button>';
header.insertAdjacentElement("afterend",nav);
var shell=document.createElement("section");shell.className="u-shell";shell.setAttribute("aria-label","Local metadata workspace");
shell.innerHTML=[
'<div class="u-hero"><h2>Universal File Metadata Inspector & Cleaner</h2><p>Inspect any local file. Remove supported metadata from JPEG, PNG, WebP, MP3, WAV, PDF and Office files. Unsupported types are inspection-only. SynthID and other embedded content watermarks are not certified removable or detectable.</p></div>',
'<div class="u-drop" id="u-drop" role="button" tabindex="0" aria-label="Choose local files"><strong>Drop files here or choose files</strong><p class="u-note">Local processing · No file upload · Up to 100 files · 256 MiB per file</p><button id="u-choose" type="button" class="u-button primary">Choose files</button><input id="u-files" type="file" multiple hidden/></div>',
'<div class="u-toolbar"><button class="u-button primary" id="u-inspect" disabled>Inspect files</button><button class="u-button" id="u-clean" disabled>Remove supported metadata & download</button><button class="u-button" id="u-report" disabled>Export JSON report</button><button class="u-button" id="u-clear">Clear</button></div>',
'<p class="u-note"><strong>Limits:</strong> Format-aware cleanup does not prove absence of all metadata, invisible watermarks, or SynthID. Existing signatures are protected; keep the original file. No file is sent to a backend.</p>',
'<p class="u-note" id="u-progress" role="status" aria-live="polite">Select files to begin.</p>',
'<section class="u-panel"><h3>File inspection and cleaning</h3><div style="overflow-x:auto"><table class="u-table"><thead><tr><th>File</th><th>Format</th><th>Known metadata blocks</th><th>Status</th></tr></thead><tbody id="u-rows"></tbody></table></div></section>',
'<section class="u-panel"><h3>Detailed results & warnings</h3><pre class="u-report" id="u-details">No files selected.</pre></section>'
].join("");
header.parentNode.insertBefore(shell,main);main.style.display="none";
var $=id=>document.getElementById(id);
var selected=[],results=[],busy=false,maxBytes=256*1024*1024;
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
 $("u-inspect").disabled=busy||!selected.length;$("u-clean").disabled=busy||!selected.length;$("u-report").disabled=busy||!results.length;$("u-clear").disabled=busy;
 $("u-rows").innerHTML=results.length?results.map(r=>'<tr><td>'+esc(r.name)+'<div class="u-note">'+(r.size/1048576).toFixed(2)+' MiB</div></td><td>'+esc(r.format)+'</td><td>'+esc(r.count)+'</td><td><span class="u-status '+(r.status==="Verified"?"ok":(r.status.startsWith("Error")||r.status==="Unsupported"?"error":""))+'">'+esc(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="4">No files selected</td></tr>';
 $("u-details").textContent=JSON.stringify(results.map(({file,...data})=>data),null,2);
}
async function bytesOf(r){if(r.size>maxBytes)throw Error("File exceeds 256 MiB browser safety limit");if(!r.size)throw Error("Empty file");return new Uint8Array(await r.file.arrayBuffer());}
async function hash(a){if(a.length>32*1024*1024)return "Skipped for large file";const h=await crypto.subtle.digest("SHA-256",a);return Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,"0")).join("");}
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type:type||"application/octet-stream"}));const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();setTimeout(()=>{URL.revokeObjectURL(url);link.remove();},20000);}
async function run(clean){
 if(busy)return;busy=true;refresh();const outputs=[],zipLib=window.JSZip,pdfLib=window.PDFLib;
 for(let i=0;i<results.length;i++){
  const r=results[i];r.status=clean?"Cleaning":"Inspecting";$("u-progress").textContent=(i+1)+"/"+results.length+": "+r.name;refresh();
  try{
   const data=await bytesOf(r);
   const out=await FileMetaEngine.process(data,r.name,{remove:clean,zipLib,pdfLib});
   r.format=out.format;r.count=out.count;r.notes=out.notes||[];r.removed=out.removed;r.verification=out.verification;
   r.sha256=await hash(data);
   if(!out.supported){r.status="Unsupported";continue;}
   if(clean&&out.changed){
    const recheck=await FileMetaEngine.process(out.bytes,r.name,{remove:false,zipLib,pdfLib});
    if(!recheck.supported||recheck.count!==0)throw Error("Post-clean validation failed; refusing download");
    r.status="Verified";r.changed=true;r.outputSize=out.bytes.length;
    const fileName=r.name.replace(/([.][^.]+)?$/,m=>"_metadata-removed"+m);
    outputs.push({filename:fileName,bytes:out.bytes});
   }else r.status=clean?"Nothing removable":"Inspected";
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
 busy=false;$("u-progress").textContent=(clean?"Cleanup finished. ":"Inspection finished. ")+results.filter(r=>r.status==="Verified").length+" verified changed file(s)."+packageError;refresh();
}
$("u-inspect").onclick=()=>run(false);
$("u-clean").onclick=()=>run(true);
$("u-report").onclick=()=>{
 const doc={tool:"Local File Metadata Inspector",generatedAt:new Date().toISOString(),warning:"This tool does not certify complete metadata removal, including SynthID or invisible watermarks.",files:results.map(({file,...r})=>r)};
 download(new TextEncoder().encode(JSON.stringify(doc,null,2)),"metadata-report.json","application/json");
};
$("u-clear").onclick=()=>{selected=[];results=[];input.value="";$("u-progress").textContent="Selection cleared.";refresh();};
refresh();
})();
