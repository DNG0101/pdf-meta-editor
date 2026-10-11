/* Additional file format adapters. Conservative and signature-based.
   Recognition does not imply the format can be safely sanitized. */
(function(root,factory) {
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.FileMetaExtraFormats=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const ascii=(a,p,n)=>Array.from(a.subarray(p,p+n),c=>String.fromCharCode(c)).join("");
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const cat=parts=>{const length=parts.reduce((n,a)=>n+a.length,0);const out=new Uint8Array(length);let at=0;for(const a of parts){out.set(a,at);at+=a.length;}return out;};
const pngPrefix=new Uint8Array([137,80,78,71]);
function identify(a){
 if(a.length>=6&&(ascii(a,0,6)==="GIF87a"||ascii(a,0,6)==="GIF89a"))return "gif";
 if(a.length>=4&&ascii(a,0,4)==="fLaC")return "flac";
 if(a.length>=4&&(equal(a.subarray(0,4),new Uint8Array([73,73,42,0]))||equal(a.subarray(0,4),new Uint8Array([77,77,0,42]))))return "tiff";
 if(a.length>=2&&ascii(a,0,2)==="BM")return "bmp";
 if(a.length>=4&&ascii(a,0,4)==="OggS")return "ogg";
 if(a.length>=12&&ascii(a,4,4)==="ftyp"){
   const brand=ascii(a,8,4);
   if(["avif","avis"].includes(brand))return "avif";
   if(["heic","heix","hevc","hevx","mif1","msf1"].includes(brand))return "heic";
   if(["qt  "].includes(brand))return "mov";
   return "mp4";
 }
 if(a.length>=6&&equal(a.subarray(0,6),new Uint8Array([55,122,188,175,39,28])))return "7z";
 if(a.length>=7&&ascii(a,0,7)==="Rar!\x1a\x07\x00")return "rar";
 if(a.length>=8&&ascii(a,0,8)==="Rar!\x1a\x07\x01\x00")return "rar";
 if(a.length>=2&&a[0]===0x1f&&a[1]===0x8b)return "gzip";
 if(a.length>=4&&ascii(a,0,4)==="\x7fELF")return "elf";
 if(a.length>=2&&ascii(a,0,2)==="MZ")return "exe";
 // Strictly read as UTF-8 text, never parse or render SVG into the page.
 if(a.length>4&&a[0]===0x3c){
  const start=new TextDecoder("utf-8").decode(a.subarray(0,Math.min(a.length,1024)));
  if(/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(start))return "svg";
 }
 return null;
}
function scanSubblocks(a,p){
 for(;;){
  if(p>=a.length)throw Error("Truncated GIF data sub-block");
  const n=a[p++];
  if(n===0)return p;
  if(n>a.length-p)throw Error("Invalid GIF sub-block length");
  p+=n;
 }
}
function gif(a,remove){
 if(a.length<14)throw Error("Truncated GIF header");
 const palette=(a[10]&0x80)?3*(1<<((a[10]&7)+1)):0;
 let p=13+palette,count=0,found=[],removed=[],images=0,ended=false;
 if(p>a.length)throw Error("Truncated GIF global color table");
 const parts=[a.subarray(0,p)];
 while(p<a.length){
  const start=p,kind=a[p++];
  if(kind===0x3b){if(p!==a.length)throw Error("GIF trailing data not safely understood");parts.push(a.subarray(start,p));ended=true;break;}
  if(kind===0x2c){
   if(p+9>a.length)throw Error("Truncated GIF image descriptor");
   const flags=a[p+8];p+=9;
   if(flags&0x80){const bytes=3*(1<<((flags&7)+1));if(bytes>a.length-p)throw Error("Truncated GIF local color table");p+=bytes;}
   if(p>=a.length)throw Error("Missing GIF LZW code size");
   p++;p=scanSubblocks(a,p);
   images++;parts.push(a.subarray(start,p));continue;
  }
  if(kind!==0x21)throw Error("Invalid GIF block type");
  if(p>=a.length)throw Error("Truncated GIF extension");
  const label=a[p++];
  let detected=null;
  if(label===0xfe){
   p=scanSubblocks(a,p);detected="GIF comment";
  }else{
   if(p>=a.length)throw Error("Truncated GIF extension header");
   const len=a[p++];
   if(len>a.length-p)throw Error("Invalid GIF extension header length");
   const tag=label===0xff?ascii(a,p,len):"";
   p+=len;
   if(label===0xf9){if(len!==4||p>=a.length||a[p++]!==0)throw Error("Invalid GIF graphic-control block");}
   else p=scanSubblocks(a,p);
   if(label===0xff&&tag==="XMP DataXMP")detected="GIF XMP application extension";
  }
  if(detected){count++;found.push(detected);if(remove)removed.push(detected);}
  if(!remove||!detected)parts.push(a.subarray(start,p));
 }
 if(!ended||!images)throw Error("GIF missing image or trailer");
 const bytes=remove&&count?cat(parts):a;
 return {format:"gif",count,detected:found,removed,bytes,notes:["Animation, graphic control, palette, looping and frame data are preserved.","Unknown application extensions may contain additional metadata; invisible watermarks are not assessed."]};
}
function flac(a,remove){
 if(a.length<42)throw Error("Truncated FLAC stream");
 let p=4,last=false,blocks=[],count=0,found=[],removed=[],infoSeen=false;
 for(let i=0;i<128;i++){
  if(p+4>a.length)throw Error("Incomplete FLAC metadata block");
  const start=p,head=a[p++],type=head&0x7f;
  last=!!(head&0x80);
  const len=(a[p++]<<16)|(a[p++]<<8)|a[p++];
  if(len>a.length-p)throw Error("Invalid FLAC metadata block size");
  const end=p+len;p=end;
  if(i===0){if(type!==0||len!==34)throw Error("Invalid FLAC STREAMINFO block");infoSeen=true;}
  const isMeta=type===4||type===6;
  const tag=type===4?"FLAC Vorbis comments":"FLAC embedded picture";
  if(isMeta){count++;found.push(tag);if(remove)removed.push(tag);}
  if(!remove||!isMeta)blocks.push(a.subarray(start,end));
  if(last)break;
 }
 if(!last||!infoSeen||p>=a.length)throw Error("Incomplete FLAC metadata or missing audio payload");
 if(!remove||!count)return {format:"flac",count,detected:found,removed,bytes:a,notes:["FLAC APPLICATION blocks and possible audio watermarks are not evaluated."]};
 if(!blocks.length)throw Error("FLAC STREAMINFO would be lost");
 const outputBlocks=blocks.map(b=>b.slice());
 for(const b of outputBlocks)b[0]&=0x7f;
 outputBlocks[outputBlocks.length-1][0]|=0x80;
 const bytes=cat([a.subarray(0,4),...outputBlocks,a.subarray(p)]);
 return {format:"flac",count,detected:found,removed,bytes,notes:["FLAC audio frames and retained metadata blocks are preserved byte-for-byte.","APPLICATION blocks and content identifiers may remain."]};
}
function process(a,remove=false){
 if(!(a instanceof Uint8Array)||!a.length)throw Error("Expected nonempty Uint8Array");
 const format=identify(a);
 if(format==="gif")return {...gif(a,remove),supported:true};
 if(format==="flac")return {...flac(a,remove),supported:true};
 if(format)return {format,bytes:a,count:0,detected:[],removed:[],supported:false,notes:["Format identified, but no safe metadata remover is implemented for it; no changes performed."]};
 return null;
}
return {identify,process,gif,flac};
});
