"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
global.FileMetaExtraFormats=require("../formats-extra.js");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaEngine=require("../universal-engine.js");
const I=require("../metadata-inspector.js");
const root=path.resolve(__dirname,"..");
const read=s=>fs.readFileSync(path.join(root,s),"utf8");
const str=s=>Uint8Array.from([...s],v=>v.charCodeAt(0));
const join=(...a)=>Uint8Array.from(a.flatMap(v=>Array.from(v)));
function frame(delay,transparent=false){
 return join([33,249,4,transparent?1:0,delay&255,delay>>8,0,0],
 [44,0,0,0,0,1,0,1,0,0,2,2,76,1,0]);
}
function sampleGif({comment=true,unknownApp=false}={}){
 return join(str("GIF89a"),[1,0,1,0,128,0,0],[0,0,0,255,255,255],
 [33,255,11],str("NETSCAPE2.0"),[3,1,0,0,0],
 comment?join([33,254,5],str("Hello"),[0]):[],
 unknownApp?join([33,255,11],str("MYSTERYAPP1"),[3,3,1,2,0]):[],
 frame(10,true),frame(20),[59]);
}
async function waitFor(predicate){
 for(let i=0;i<80;i++){if(predicate())return;await new Promise(ok=>setTimeout(ok,25));}
 throw Error("UI did not finish inspecting");
}
test("GIF inspection distinguishes technical properties from removable metadata",async()=>{
 const bytes=sampleGif();
 const info=await I.inspect(bytes,"animated.gif");
 const get=name=>info.fields.find(x=>x.name===name);
 assert.equal(info.format,"gif");
 assert.equal(get("Width")?.value,"1");
 assert.equal(get("Height")?.value,"1");
 assert.equal(get("Frame count")?.value,"2");
 assert.equal(get("Animation loop count")?.value,"Infinite");
 assert.equal(get("Total frame delay")?.value,"0.30 seconds (declared)");
 assert.equal(get("Frames with transparency")?.value,"1");
 assert.equal(get("Comment 1")?.value,"Hello");
 assert.equal(get("Frame count")?.kind,"technical");
 assert.equal(get("Comment 1")?.kind,"metadata");
 const cleaned=await global.FileMetaEngine.process(bytes,"animated.gif",{remove:true});
 assert.equal(cleaned.count,1);
 assert.equal(cleaned.changed,true);
 const after=await I.inspect(cleaned.bytes,"animated.gif");
 assert.equal(after.fields.some(x=>x.name==="Comment 1"),false);
 assert.equal(after.fields.find(x=>x.name==="Frame count")?.value,"2");
});
test("GIF with no removable tag still displays technical properties",async()=>{
 const info=await I.inspect(sampleGif({comment:false}),"clean.gif");
 assert.equal(info.fields.filter(f=>f.kind!=="technical").length,0);
 assert.ok(info.fields.filter(f=>f.kind==="technical").length>=6);
 assert.ok(info.warnings.some(x=>x.includes("No removable GIF comment/XMP")));
});
test("Unrecognized GIF extensions are displayed but not falsely claimed removed",async()=>{
 const input=sampleGif({unknownApp:true});
 const info=await I.inspect(input,"unknown.gif");
 assert.ok(info.fields.some(x=>x.name==="Unrecognized application extension IDs"));
 assert.ok(info.warnings.some(w=>w.includes("preserved")));
 const cleaned=await global.FileMetaEngine.process(input,"unknown.gif",{remove:true});
 assert.ok(Buffer.from(cleaned.bytes).includes(Buffer.from("MYSTERYAPP1")));
});
test("Selecting a GIF starts automatic inspection without clicking Inspect files",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"});
 const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const script of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(script));
  const bytes=sampleGif();
  const input=d.getElementById("u-files");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"FoodNearby_Workflow_Animated.gif",size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(0)}]});
  input.dispatchEvent(new w.Event("change"));
  assert.match(d.getElementById("u-progress").textContent,/Starting automatic inspection/);
  assert.match(d.getElementById("u-fields").textContent,/Inspection is starting automatically/);
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const rows=d.getElementById("u-rows").textContent;
  assert.match(rows,/gif/);
  assert.match(rows,/Inspected/);
  const pane=d.getElementById("u-fields");
  assert.match(pane.textContent,/Frame count/);
  assert.match(pane.textContent,/Comment 1/);
  assert.match(pane.textContent,/Technical/);
  assert.match(pane.textContent,/Metadata/);
  const result=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.equal(result.format,"gif");
  assert.equal(result.count,1);
  assert.equal(result.status,"Inspected");
  assert.ok(result.metadataFields.some(x=>x.name==="Frame count"&&x.kind==="technical"));
  assert.ok(result.metadataFields.some(x=>x.name==="Comment 1"&&x.kind==="metadata"));
 }finally{dom.window.close();}
});
test("Selecting an untagged GIF does not show a misleading empty metadata workspace",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"});
 const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const script of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(script));
  const bytes=sampleGif({comment:false});
  Object.defineProperty(d.getElementById("u-files"),"files",{configurable:true,value:[{name:"no-tag.gif",size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(0)}]});
  d.getElementById("u-files").dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  assert.match(d.getElementById("u-fields").textContent,/No recognized metadata tag values found/);
  assert.match(d.getElementById("u-fields").textContent,/Frame count/);
  assert.equal(JSON.parse(d.getElementById("u-details").textContent)[0].count,0);
 }finally{dom.window.close();}
});
