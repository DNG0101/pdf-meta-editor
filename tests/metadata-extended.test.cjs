"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
global.FileMetaEngine=require("../universal-engine.js");
global.FileMetaExtended=require("../metadata-extended.js");
const I=require("../metadata-inspector.js");
const txt=s=>Uint8Array.from([...s],c=>c.charCodeAt(0));
const cat=(...a)=>Uint8Array.from(a.flatMap(b=>Array.from(b)));
const le=n=>Uint8Array.from([n&255,n>>>8&255,n>>>16&255,n>>>24&255]);
const be=n=>Uint8Array.from([n>>>24&255,n>>>16&255,n>>>8&255,n&255]);
const box=(name,bytes)=>cat(be(bytes.length+8),txt(name),bytes);
test("BMP exposes technical fields while declining false full-metadata guarantee",async()=>{
 const dib=new Uint8Array(40);dib.set(le(40),0);dib.set(le(640),4);dib.set(le(480),8);dib[12]=1;dib[14]=24;dib.set(le(2835),24);
 const a=cat(txt("BM"),le(54),[0,0,0,0],le(54),dib);
 const x=await I.inspect(a,"image.bmp");
 assert.equal(x.format,"bmp");
 assert.equal(x.fields.find(f=>f.name==="Width")?.value,"640");
 assert.equal(x.fields.find(f=>f.name==="Height")?.value,"480");
 assert.equal(x.fields.find(f=>f.name==="Bits per pixel")?.value,"24");
 assert.match(x.coverage,/Partial/);
 assert.ok(x.warnings.some(w=>w.includes("not fully")));
});
test("TIFF EXIF-style IFD fields exposed even without a JPEG wrapper",async()=>{
 const bytes=cat(txt("II"),[42,0],le(8),[1,0],[15,1,2,0],le(5),le(26),le(0),txt("Sony\0"));
 const x=await I.inspect(bytes,"image.tiff");
 assert.equal(x.format,"tiff");
 assert.equal(x.fields.find(f=>f.name==="IFD0 Make")?.value,"Sony");
});
test("MP4 ISO BMFF reads brands, duration and embedded ilst metadata",async()=>{
 const mvhd=cat([0,0,0,0],be(2082844800),be(2082844800),be(1000),be(12000));
 const tag=box("©nam",box("data",cat(be(1),be(0),txt("Clip title"))));
 const moov=box("moov",cat(box("mvhd",mvhd),box("udta",box("meta",cat([0,0,0,0],box("ilst",tag))))));
 const mp4=cat(box("ftyp",cat(txt("isom"),be(0),txt("isom"))),moov,box("mdat",[1,2,3,4]));
 const x=await I.inspect(mp4,"movie.mp4");
 assert.equal(x.format,"mp4");
 assert.equal(x.fields.find(f=>f.name==="Title")?.value,"Clip title");
 assert.equal(x.fields.find(f=>f.name==="Movie duration")?.value,"12.000 seconds");
 assert.equal(x.fields.find(f=>f.name==="Major brand")?.value,"isom");
 assert.match(x.watermarkStatus,/Not assessed/);
 assert.ok(x.warnings.some(v=>/read-only/.test(v)));
});
test("Malformed MP4 length rejected instead of reporting empty metadata",async()=>{
 const a=cat(be(4096),txt("ftyp"),txt("isom"),be(0));
 assert.throws(()=>I.inspect(a,"bad.mp4"),/BMFF/);
});
test("OGG OpusTags comment values are decoded",async()=>{
 const vendor=txt("EncoderName"),comment=txt("ARTIST=Example Artist");
 const packet=cat(txt("OpusTags"),le(vendor.length),vendor,le(1),le(comment.length),comment);
 const header=new Uint8Array(28);header.set(txt("OggS"),0);header[4]=0;header[26]=1;header[27]=packet.length;
 const x=await I.inspect(cat(header,packet),"track.ogg");
 assert.equal(x.format,"ogg");
 assert.equal(x.fields.find(f=>f.name==="Encoder")?.value,"EncoderName");
 assert.equal(x.fields.find(f=>f.name==="ARTIST")?.value,"Example Artist");
});
test("SVG root and text metadata are inert strings, never executed",async()=>{
 const a=txt('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><title>Portfolio</title><desc>Image owner</desc><metadata><rdf>Maker</rdf></metadata></svg>');
 const x=await I.inspect(a,"art.svg");
 assert.equal(x.format,"svg");
 assert.equal(x.fields.find(f=>f.name==="SVG width")?.value,"120");
 assert.equal(x.fields.find(f=>f.name==="SVG title 1")?.value,"Portfolio");
 assert.equal(x.fields.find(f=>f.name==="SVG metadata 1")?.value,"<rdf>Maker</rdf>");
});
test("GIF inspector extracts XMP XML content not just presence",async()=>{
 const xmp=txt("<x:xmpmeta>Original creator</x:xmpmeta>");
 const gif=cat(txt("GIF89a"),[1,0,1,0,128,0,0],[0,0,0,255,255,255],
  [33,255,11],txt("XMP DataXMP"),[xmp.length],xmp,[0],
  [44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]);
 const r=await I.inspect(gif,"animated.gif");
 assert.match(r.fields.find(f=>f.name==="XMP packet 1")?.value||"",/Original creator/);
 const clean=await global.FileMetaEngine.process(gif,"animated.gif",{remove:true});
 assert.equal(clean.changed,true);
 assert.equal((await I.inspect(clean.bytes,"animated.gif")).fields.some(f=>f.name==="XMP packet 1"),false);
});
test("Truncated values are explicitly marked incomplete in the exported field data",async()=>{
 const payload=txt("a".repeat(140000));
 const bytes=cat(txt("GIF89a"),[1,0,1,0,128,0,0],[0,0,0,255,255,255]);
 const segments=[];for(let p=0;p<payload.length;p+=255){const b=payload.subarray(p,p+255);segments.push(cat([b.length],b));}
 const gif=cat(bytes,[33,254],...segments,[0],[44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]);
 const r=await I.inspect(gif,"huge.gif");
 assert.equal(r.fieldCounts.truncated>0,true);
 assert.ok(r.warnings.some(x=>x.includes("budget")));
 assert.equal(r.fields.find(f=>f.name==="Comment 1").complete,false);
});
