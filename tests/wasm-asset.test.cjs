"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const Bridge=require("../exiftool-bridge.js");

const MAGIC=Uint8Array.of(0,97,115,109,1,0,0,0); // Valid minimal WASM module.
const html="<!DOCTYPE html><html><body>CDN fallback</body></html>";
const reply=(bytes,opts={})=>new Response(bytes,{status:opts.status||200,headers:{"Content-Type":opts.mime||"application/wasm"}});
const bad=(text)=>reply(text,{mime:"text/html"});

test("Detect missing WASM header even when HTTP status is 200",()=>{
 assert.equal(Bridge.isWasm(MAGIC.buffer),true);
 assert.equal(Bridge.isWasm(new TextEncoder().encode(html).buffer),false);
 assert.equal(Bridge.isWasm(new ArrayBuffer(0)),false);
});

test("HTML CDN response falls back to another provider with valid WASM",async()=>{
 const calls=[];
 const result=await Bridge.fetchCheckedWasm({
  urls:["https://broken.example/zeroperl.wasm","https://working.example/zeroperl.wasm"],
  expectedSha256:null,
  fetchImpl:async url=>{
   calls.push(url);
   return url.includes("broken")?bad(html):reply(MAGIC);
  }
 });
 assert.deepEqual(calls,["https://broken.example/zeroperl.wasm","https://working.example/zeroperl.wasm"]);
 assert.equal(result.url,"https://working.example/zeroperl.wasm");
 assert.equal(Bridge.isWasm(result.binary),true);
});

test("HTML, network and 404 errors are disclosed rather than sent to WebAssembly.instantiate",async()=>{
 await assert.rejects(()=>Bridge.fetchCheckedWasm({
  urls:["https://bad.example","https://offline.example","https://missing.example"],
  expectedSha256:null,
  fetchImpl:async url=>{
   if(url.includes("offline"))throw Error("Network offline");
   if(url.includes("missing"))return reply(html,{status:404});
   return bad(html);
  }
 }),error=>{
  assert.match(error.message,/HTML, not WebAssembly/);
  assert.match(error.message,/Network offline/);
  assert.match(error.message,/HTTP 404/);
  return true;
 });
});

test("WASM response wrapper supplies a real Response with correct MIME type and magic",async()=>{
 const response=await Bridge.checkedWasmResponse({
  urls:["https://wasm.example/runtime.wasm"],
  expectedSha256:null,
  fetchImpl:async()=>reply(MAGIC)
 });
 assert.equal(response.headers.get("Content-Type"),"application/wasm");
 assert.equal(Bridge.isWasm(await response.arrayBuffer()),true);
});

test("WASM with valid prefix but corrupt module body is rejected",async()=>{
 const damaged=Uint8Array.from([...MAGIC,255,255,255,255]);
 await assert.rejects(()=>Bridge.fetchCheckedWasm({
  urls:["https://wasm.example/broken.wasm"],
  expectedSha256:null,
  fetchImpl:async()=>reply(damaged)
 }),/WebAssembly\.validate rejected/);
});

test("ExifTool wrapper actually receives custom binary loader and never fetches the imported HTML URL",async()=>{
 const filename="sample.png",provided={name:filename,size:16},calls=[];
 const record=[{SourceFile:filename,"[EXIF]Make":"CameraCo"}];
 const result=await Bridge.scan(provided,{
  wasmOptions:{
   urls:["https://fallback.example/zeroperl.wasm"],
  expectedSha256:null,
   fetchImpl:async (url)=>{
    calls.push(url);
    return reply(MAGIC);
   }
  },
  loader:async()=>({parseMetadata:async(file,options)=>{
   assert.equal(file,provided);
   assert.equal(typeof options.fetch,"function");
   const wasmResponse=await options.fetch("https://esm.sh/NOT-REAL/zeroperl.wasm");
   assert.equal(Bridge.isWasm(await wasmResponse.arrayBuffer()),true);
   assert.deepEqual(options.transform(JSON.stringify(record)),record);
   return {success:true,data:record};
  }})
 });
 assert.deepEqual(calls,["https://fallback.example/zeroperl.wasm"]);
 assert.equal(result.fields.find(f=>f.name==="[EXIF]Make").value,"CameraCo");
});

test("The pinned runtime checksum matches the verified GitHub Actions network download",()=>{
 assert.equal(Bridge.wasmSha256,"a6ae97f184fabc444b0b70d77c3d16475bfb3de16ebfb58ab8b2fbf98a53835e");
});
test("Wrong WASM checksum is not silently accepted",async()=>{
 await assert.rejects(()=>Bridge.fetchCheckedWasm({
  urls:["https://bad-checksum.example/zeroperl.wasm"],
  expectedSha256:"0".repeat(64),
  fetchImpl:async()=>reply(MAGIC)
 }),/integrity mismatch/);
});
