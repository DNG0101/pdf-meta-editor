/* Optional browser ExifTool-compatible deep metadata reader.
 * Based on the WASM @uswriting/exiftool API. Loaded only on user request.
 * Data remains local, but the default loader fetches third-party JS/WASM.
 * This is READ-ONLY; no claim of universal metadata removal or SynthID status.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.FileMetaExifTool=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const CDN="https://esm.sh/@uswriting/exiftool@1.0.9?bundle";
 const MAX_JSON=8*1048576,MAX_FIELDS=6000,MAX_FIELD=128*1024,MAX_ALL=4*1048576;
 // esm.sh can rewrite a WASM import into a URL returning its HTML fallback
 // (<!DOCTYPE ...> instead of the \0asm magic). The upstream ExifTool wrapper
 // passes options.fetch directly to ZeroPerl.create, which lets us override
 // that broken URL with an explicitly checked, pinned WASM asset.
 const WASM_PACKAGE="@6over3/zeroperl-ts@1.0.10";
 const WASM_URLS=[
  "https://cdn.jsdelivr.net/npm/"+WASM_PACKAGE+"/dist/esm/zeroperl.wasm",
  "https://unpkg.com/"+WASM_PACKAGE+"/dist/esm/zeroperl.wasm",
  "https://esm.sh/"+WASM_PACKAGE+"/zeroperl.wasm",
  "https://raw.githubusercontent.com/6over3/zeroperl-ts/5e12fb86cebf09795c32befa390718b3d8ddd3e7/zeroperl.wasm"
 ];
 const MAX_WASM=64*1048576;
 const WASM_SHA256="a6ae97f184fabc444b0b70d77c3d16475bfb3de16ebfb58ab8b2fbf98a53835e";
 let wasmBinaryPromise=null;
 const wasmMagic=[0,97,115,109,1,0,0,0];
 function isWasm(bytes){
  return bytes.byteLength>=8&&wasmMagic.every((v,i)=>new Uint8Array(bytes,0,8)[i]===v);
 }
 function contentSummary(bytes){
  const sample=new Uint8Array(bytes,0,Math.min(bytes.byteLength,40));
  return Array.from(sample,n=>n>=32&&n<=126?String.fromCharCode(n):".").join("");
 }
 function wasmAssetUrls(opts={}){
  const list=[];
  // Allow a same-origin file for future fully-offline/self-hosted deployment.
  // Do not probe it by default; GitHub Pages currently has no bundled WASM.
  if(opts.localUrl)list.push(opts.localUrl);
  return [...list,...WASM_URLS];
 }
 async function fetchCheckedWasm(opts={}){
  const get=opts.fetchImpl||(typeof fetch==="function"?fetch:null);
  if(!get)throw Error("Browser fetch is unavailable, so the WASM runtime cannot be loaded");
  const failures=[];
  for(const url of (opts.urls||wasmAssetUrls(opts))){
   try{
    const resp=await get(url,{mode:"cors",cache:"force-cache"});
    if(!resp||!resp.ok)throw Error("HTTP "+(resp?.status??"no response"));
    const declared=Number(resp.headers?.get?.("content-length"));
    if(Number.isFinite(declared)&&declared>MAX_WASM)throw Error("WASM asset exceeds the 64 MiB safety limit");
    const binary=await resp.arrayBuffer();
    if(binary.byteLength>MAX_WASM)throw Error("WASM asset exceeds the 64 MiB safety limit");
    if(!isWasm(binary)){
     const sample=contentSummary(binary);
     throw Error("received "+(sample.startsWith("<!DO")||sample.startsWith("<html")?"HTML, not WebAssembly":"non-WASM bytes")+" ("+sample+")");
    }
    if(typeof WebAssembly!=="undefined"&&typeof WebAssembly.validate==="function"&&!WebAssembly.validate(binary))
     throw Error("WASM magic is present, but WebAssembly.validate rejected the binary");
    const expected=opts.expectedSha256===undefined?WASM_SHA256:opts.expectedSha256;
    if(expected){
     if(typeof crypto==="undefined"||!crypto.subtle?.digest)throw Error("SHA-256 verification unavailable in this browser");
     const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",binary));
     const digest=Array.from(hash,n=>n.toString(16).padStart(2,"0")).join("");
     if(digest!==expected)throw Error("WASM integrity mismatch: expected pinned SHA-256, received "+digest);
    }
    return {binary,url};
   }catch(e){
    failures.push(url+": "+String(e?.message||e).slice(0,180));
   }
  }
  throw Error("Could not load a valid Zeroperl WebAssembly binary. A CDN or proxy is returning HTML instead of a .wasm file, or a network/CORS policy blocked the download. "+failures.join(" | ").slice(0,1600));
 }
 async function checkedWasmResponse(opts={}){
  if(opts.fetchImpl||opts.urls||opts.localUrl){
   const result=await fetchCheckedWasm(opts);
   return new Response(result.binary.slice(0),{status:200,headers:{"Content-Type":"application/wasm"}});
  }
  if(!wasmBinaryPromise){
   wasmBinaryPromise=fetchCheckedWasm().catch(e=>{wasmBinaryPromise=null;throw e;});
  }
  const {binary}=await wasmBinaryPromise;
  return new Response(binary.slice(0),{status:200,headers:{"Content-Type":"application/wasm"}});
 }

 let cachedLoad=null;
 function loadWasm(){
  if(!cachedLoad){
   cachedLoad=import(/* webpackIgnore: true */ CDN).catch(err=>{cachedLoad=null;throw err;});
  }
  return cachedLoad;
 }
 function stringValue(value){
  if(typeof value==="string")return value;
  if(value===null)return "null";
  if(value===undefined)return "";
  if(typeof value==="number"||typeof value==="boolean")return String(value);
  try{return JSON.stringify(value);}catch{return "[Unsupported nested value]";}
 }
 function normalize(entry,opts={}){
  if(!entry||Array.isArray(entry)||typeof entry!=="object")throw Error("ExifTool record must be a JSON object");
  const fields=[],warnings=[];
  let budget=Math.min(MAX_ALL,Math.max(0,opts.maxCharacters||MAX_ALL));
  const keys=Object.keys(entry);
  for(const key of keys){
   if(fields.length>=MAX_FIELDS){
    warnings.push("ExifTool field count exceeds 6000; extra fields omitted");
    break;
   }
   const raw=stringValue(entry[key]),bytes=raw.length;
   const allowed=Math.min(MAX_FIELD,budget);
   const complete=bytes<=allowed;
   let value=raw.slice(0,allowed);
   if(!complete){
    value+="… [truncated]";
    if(!warnings.includes("ExifTool values truncated: 128 KiB per field / 4 MiB cumulative limit"))
     warnings.push("ExifTool values truncated: 128 KiB per field / 4 MiB cumulative limit");
   }
   budget=Math.max(0,budget-Math.min(bytes,allowed));
   const label=String(key).slice(0,500);
   const group=/^\[([^\]]+)\]/.exec(label)?.[1] || /^([^:]+):/.exec(label)?.[1] || "ExifTool";
   const kind=/^(File|System|ExifTool|Composite)$/i.test(group)||/^(SourceFile|FileName|Directory|FileSize|FileType|MIMEType)$/.test(label)?"technical":"metadata";
   fields.push({name:label,value,source:"ExifTool "+group,kind,complete,originalCharacters:bytes});
  }
  if(keys.length>MAX_FIELDS)warnings.push("ExifTool returned "+keys.length+" keys; not all were displayed");
  return {fields,warnings,sourceFile:typeof entry.SourceFile==="string"?entry.SourceFile:undefined,
   counts:{fields:fields.length,metadata:fields.filter(f=>f.kind!=="technical").length,technical:fields.filter(f=>f.kind==="technical").length,incomplete:fields.filter(f=>!f.complete).length},
   coverage:"ExifTool-extracted tags only; unknown/binary/proprietary metadata and invisible watermarks may not be detected"};
 }
 function fromJson(input,filename){
  let parsed=input;
  if(typeof input==="string"){
   if(input.length>MAX_JSON)throw Error("ExifTool JSON exceeds 8 MiB import limit");
   parsed=JSON.parse(input);
  }
  const records=Array.isArray(parsed)?parsed:[parsed];
  if(!records.length||records.length>1000)throw Error("ExifTool JSON must contain 1–1000 record(s)");
  const name=String(filename||"");
  const basename=p=>String(p).replace(/\\/g,"/").split("/").pop();
  const found=records.filter(r=>r&&typeof r==="object"&&!Array.isArray(r)&&
    typeof r.SourceFile==="string"&&basename(r.SourceFile)===name);
  if(found.length!==1)throw Error("ExifTool JSON must contain exactly one SourceFile matching "+name);
  return normalize(found[0]);
 }
 async function scan(file,options={}){
  if(!file||typeof file.name!=="string")throw Error("A selected browser File is required");
  if(file.size>256*1048576)throw Error("ExifTool deep inspection exceeds the configured 256 MiB per-file limit");
  const load=options.loader||loadWasm;
  const api=await load();
  if(!api||typeof api.parseMetadata!=="function")throw Error("ExifTool WASM module did not expose parseMetadata");
  // G4 ensures more unique identifiers. -a includes duplicate-name tags;
  // -u/-U request unknown tags where ExifTool can parse them.
  const args=["-json","-G4","-a","-u","-U","-struct"];
  let result;
  try{
   result=await api.parseMetadata(file,{args,fetch:optsUrl=>checkedWasmResponse(options.wasmOptions||{}),transform:raw=>{if(raw.length>MAX_JSON)throw Error("ExifTool JSON output exceeds the 8 MiB safety limit; use the desktop CLI for larger results");return JSON.parse(raw);}});
  }catch(e){throw Error("ExifTool WASM extraction failed: "+(e?.message||String(e)));}
  if(!result?.success)throw Error("ExifTool reported failure: "+String(result?.error||"Unknown error").slice(0,500));
  const rows=Array.isArray(result.data)?result.data:[result.data];
  if(rows.length!==1)throw Error("ExifTool returned "+rows.length+" records for one input file");
  const info=normalize(rows[0]);
  return {...info,engine:"ExifTool WASM (experimental)",args,
   warnings:[...info.warnings,"ExifTool extracted known and requested unknown tags; this is not a guarantee of all metadata or SynthID absence."]};
 }
 return {scan,fromJson,normalize,loadWasm,wasmUrl:CDN,wasmSources:WASM_URLS.slice(),wasmSha256:WASM_SHA256,fetchCheckedWasm,checkedWasmResponse,isWasm};
});
