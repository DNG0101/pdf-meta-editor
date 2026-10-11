"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
const read=n=>fs.readFileSync(path.join(root,n),"utf8");
const ascii=s=>Uint8Array.from(Array.from(s,c=>c.charCodeAt(0)));
const cat=(...xs)=>Uint8Array.from(xs.flatMap(x=>Array.from(x)));
const be=n=>Uint8Array.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function chunk(type,data){const raw=cat(ascii(type),data);let crc=0xffffffff;for(const v of raw){crc^=v;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}return cat(be(data.length),raw,be((crc^0xffffffff)>>>0));}
function fixture(){return cat([137,80,78,71,13,10,26,10],chunk("IHDR",cat(be(12),be(24),[8,2,0,0,0])),chunk("tEXt",ascii("Author\0Alice <script>alert(1)</script>")),chunk("IDAT",[1,2,3]),chunk("IEND",[]));}
async function waitFor(check){
 for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error("Browser UI did not reach expected state");
}
test("Universal UI displays true parsed metadata values with HTML escaping and cleans them",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"});
 const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const script of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(script));
  const bytes=fixture();
  const input=d.getElementById("u-files");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"photo.png",size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(0)}]});
  input.dispatchEvent(new w.Event("change"));
  d.getElementById("u-inspect").click();
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const fieldArea=d.getElementById("u-fields");
  assert.match(fieldArea.textContent,/Author/,d.getElementById("u-details").textContent);
  assert.match(fieldArea.textContent,/Alice <script>alert\(1\)<\/script>/);
  assert.equal(fieldArea.querySelectorAll("script").length,0,"metadata content must not execute as HTML");
  assert.match(fieldArea.textContent,/12/);
  assert.match(fieldArea.textContent,/24/);
  // Mock browser saving rather than creating an actual download.
  w.URL.createObjectURL=()=> "blob:local";w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  d.getElementById("u-clean").click();
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Cleanup finished."));
  const report=JSON.parse(d.getElementById("u-details").textContent);
  assert.equal(report[0].status,"Known tags rechecked");
  assert.ok(report[0].metadataFields.some(x=>x.name==="Author"));
  assert.ok(!report[0].remainingFields.some(x=>x.name==="Author"));
  assert.match(report[0].synthIdDetection,/Not assessed/);
 }finally{dom.window.close();}
});
