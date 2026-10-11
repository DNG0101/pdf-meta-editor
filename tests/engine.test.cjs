"use strict";
const assert=require("node:assert/strict");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
const E=require("../universal-engine.js");
const u=a=>new Uint8Array(a);
const cat=(...parts)=>u(parts.flatMap(p=>Array.from(p)));
const ascii=s=>u(Array.from(s,c=>c.charCodeAt(0)));
const le=n=>u([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
const be=n=>u([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function riff(tag,chunks){const body=cat(...chunks);return cat(ascii("RIFF"),le(body.length+4),ascii(tag),body);}
function chunk(tag,bytes){return cat(ascii(tag),le(bytes.length),bytes,bytes.length%2?u([0]):u([]));}
function pngChunk(tag,bytes){
 const body=cat(ascii(tag),bytes);let crc=0xffffffff;
 for(const v of body){crc^=v;for(let i=0;i<8;i++)crc=(crc&1)?((crc>>>1)^0xedb88320):(crc>>>1);}
 return cat(be(bytes.length),body,be((crc^0xffffffff)>>>0));
}
function test(name,fn){fn();console.log("PASS "+name);}
test("JPEG detection and safe APP1 removal",()=>{
 const input=cat(u([255,216,255,225,0,4,65,66,255,218,0,6,1,1,0,0,63,0,1,2,255,217]));
 const cleaned=E.binary(input,true);
 assert.equal(cleaned.format,"jpeg");assert.equal(cleaned.count,1);
 assert.deepEqual([...cleaned.bytes],[255,216,255,218,0,6,1,1,0,0,63,0,1,2,255,217]);
 assert.deepEqual([...input],[255,216,255,225,0,4,65,66,255,218,0,6,1,1,0,0,63,0,1,2,255,217]);
 assert.equal(E.binary(cleaned.bytes,false).count,0);
});
test("PNG textual metadata removal without touching pixel chunk",()=>{
 const head=u([137,80,78,71,13,10,26,10]);
 const img=pngChunk("IDAT",u([1,2,3]));
 const ihdr=pngChunk("IHDR",cat(be(3),be(2),u([8,2,0,0,0])));
 const input=cat(head,ihdr,pngChunk("tEXt",ascii("a=b")),img,pngChunk("IEND",u([])));
 const cleaned=E.binary(input,true);
 assert.equal(cleaned.count,1);assert.equal(E.binary(cleaned.bytes,false).count,0);
 assert.equal(E.binary(cleaned.bytes,false).format,"png");
 assert.ok(cleaned.bytes.length<input.length);
 assert.deepEqual([...cleaned.bytes.slice(8+ihdr.length,8+ihdr.length+img.length)],[...img]);
});
test("WebP XMP removal and extended header flag repair",()=>{
 const vp8x=chunk("VP8X",u([12,0,0,0,1,0,0,1,0,0]));
 const image=chunk("VP8 ",u([5,4,3]));
 const meta=chunk("XMP ",ascii("sample"));
 const input=riff("WEBP",[vp8x,image,meta]);
 const c=E.binary(input,true);
 assert.equal(c.count,1);assert.equal(c.bytes[20],0);
 assert.equal(c.bytes.length,input.length-meta.length);
 assert.equal(c.bytes.length,E.binary(c.bytes,false).bytes.length);
});
test("WAV LIST INFO removal while preserving audio bytes",()=>{
 const list=chunk("LIST",ascii("INFO"));
 const data=chunk("data",u([1,3,5,7]));
 const input=riff("WAVE",[list,data]);
 const c=E.binary(input,true);
 assert.equal(c.count,1);assert.equal(c.bytes.length,input.length-list.length);
 assert.equal(E.binary(c.bytes,false).count,0);
 assert.deepEqual([...c.bytes.slice(-4)],[1,3,5,7]);
});
test("MP3 ID3v2 and ID3v1 removal",()=>{
 const tag=cat(ascii("TAG"),new Uint8Array(125));
 const audio=u([255,251,144,0]);
 const mp3=cat(ascii("ID3"),u([4,0,0,0,0,0,0]),audio,tag);
 const c=E.binary(mp3,true);
 assert.equal(c.count,2);assert.deepEqual([...c.bytes],[...audio]);
 assert.equal(E.binary(c.bytes,false).count,0);
});
test("Disguised extension cannot override detected format",()=>{
 const jpeg=u([255,216,255,218,0,6,1,1,0,0,63,0,0,255,217]);
 assert.equal(E.identify(jpeg,"pretend.pdf"),"jpeg");
});
test("Damaged PNG CRC rejected rather than producing a fake-clean result",()=>{
 const png=cat(u([137,80,78,71,13,10,26,10]),pngChunk("tEXt",ascii("a=b")),pngChunk("IEND",u([])));
 png[20]^=1;assert.throws(()=>E.binary(png,true));
});
test("Truncated PNG and JPEG fail closed",()=>{
 assert.throws(()=>E.binary(u([255,216,255,225,0,30,1,2]),true));
 const png=cat(u([137,80,78,71,13,10,26,10]),be(25),ascii("tEXt"));
 assert.throws(()=>E.binary(png,true));
});
test("Unknown formats do not claim to be cleaned",async()=>{
 const result=await E.process(ascii("not a known file"),"secret.bin",{remove:true});
 assert.equal(result.supported,false);assert.equal(result.changed,false);
});
test("Generic ZIP is unsupported",async()=>{
 const result=await E.process(u([80,75,3,4,0,0]),"archive.zip",{remove:true});
 assert.equal(result.supported,false);
});
test("No guarantee is made about invisible watermarks",()=>{
 const c=E.binary(u([255,216,255,218,0,6,1,1,0,0,63,0,0,255,217]),true);
 assert.ok(c.notes.join(" ").includes("watermark")||c.notes.join(" ").includes("metadata"));
});
