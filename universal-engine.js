/* File metadata engine. No uploads; binary operations run locally in the browser.
   Format support is deliberately explicit: unknown data is NEVER declared clean. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;root.FileMetaEngine=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const decode=(a,start=0,len=4)=>Array.from(a.subarray(start,start+len),n=>String.fromCharCode(n)).join("");
const le32=(a,p)=>((a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0);
const be32=(a,p)=>((a[p]*0x1000000)+(a[p+1]<<16)+(a[p+2]<<8)+a[p+3])>>>0;
const put32=(a,p,n)=>(a[p]=n&255,a[p+1]=(n>>>8)&255,a[p+2]=(n>>>16)&255,a[p+3]=(n>>>24)&255);
const concat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let j=0;for(const p of parts){out.set(p,j);j+=p.length;}return out;};
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function identify(a,name=""){
 if(a.length>=5&&decode(a,0,5)==="%PDF-")return "pdf";
 if(a.length>=8&&eq(a.slice(0,8),new Uint8Array([137,80,78,71,13,10,26,10])))return "png";
 if(a.length>=3&&a[0]===255&&a[1]===216&&a[2]===255)return "jpeg";
 if(a.length>=12&&decode(a,0,4)==="RIFF"&&decode(a,8,4)==="WEBP")return "webp";
 if(a.length>=12&&decode(a,0,4)==="RIFF"&&decode(a,8,4)==="WAVE")return "wav";
 if(a.length>=3&&decode(a,0,3)==="ID3")return "mp3";
 if(a.length>=2&&a[0]===255&&(a[1]&0xe0)===0xe0)return "mp3";
 if(a.length>=4&&decode(a,0,2)==="PK"&&(a[2]===3||a[2]===5||a[2]===7)&&[4,6,8].includes(a[3]))return "zip";
 return "unknown";
}
function jpeg(a,strip){
 let p=2,count=0,removed=[],parts=[a.subarray(0,2)],foundEnd=false;
 while(p<a.length){
  let start=p;if(a[p]!==255)throw Error("Malformed JPEG segment header");
  while(p<a.length&&a[p]===255)p++;
  if(p>=a.length)throw Error("Truncated JPEG");
  const marker=a[p++];
  if(marker===0xda){if(p+2>a.length)throw Error("Truncated JPEG scan");parts.push(a.subarray(start));foundEnd=true;break;}
  if(marker===0xd9){parts.push(a.subarray(start,p));foundEnd=true;break;}
  if(marker===0x01||(marker>=0xd0&&marker<=0xd8)){parts.push(a.subarray(start,p));continue;}
  if(p+2>a.length)throw Error("Truncated JPEG length");
  const size=(a[p]<<8)|a[p+1];if(size<2||p+size>a.length)throw Error("Invalid JPEG segment length");
  const end=p+size;
  const isMeta=marker===0xe1||marker===0xed||marker===0xfe;
  if(isMeta){count++;if(strip)removed.push("JPEG "+marker.toString(16).toUpperCase());}
  if(!strip||!isMeta)parts.push(a.subarray(start,end));
  p=end;
 }
 if(!foundEnd)throw Error("Incomplete JPEG image");
 return {count,removed,bytes:strip?concat(parts):a,notes:["JPEG APP2/ICC color profiles and unknown application segments are preserved; they may contain metadata."]};
}
const PNG_SIG=new Uint8Array([137,80,78,71,13,10,26,10]);
function png(a,strip){
 let p=8,count=0,removed=[],parts=[a.subarray(0,8)],endSeen=false;
 const drop=new Set(["tEXt","zTXt","iTXt","eXIf","tIME"]);
 while(p<a.length){
  if(p+12>a.length)throw Error("Truncated PNG chunk");
  const len=be32(a,p),type=decode(a,p+4,4),end=p+12+len;
  if(len>a.length-p-12)throw Error("Invalid PNG chunk length");
  const isMeta=drop.has(type);if(isMeta){count++;if(strip)removed.push(type);}
  if(!strip||!isMeta)parts.push(a.subarray(p,end));
  p=end;
  if(type==="IEND"){endSeen=true;if(p!==a.length)throw Error("Trailing data after PNG IEND requires manual review");break;}
 }
 if(!endSeen)throw Error("Missing PNG IEND");
 return {count,removed,bytes:strip?concat(parts):a,notes:["Image pixels, ICC profiles, color management chunks and unknown ancillary chunks are preserved; invisible watermarks are not verified."]};
}
function webp(a,strip){
 if(le32(a,4)+8!==a.length)throw Error("Invalid WebP RIFF length");
 let p=12,count=0,removed=[],parts=[a.subarray(12,12)],chunks=[],hasVP8X=false;
 while(p<a.length){
  if(p+8>a.length)throw Error("Truncated WebP chunk");
  const type=decode(a,p,4),len=le32(a,p+4),end=p+8+len+(len%2);
  if(len>a.length-p-8||end>a.length)throw Error("Invalid WebP chunk size");
  let chunk=a.subarray(p,end);
  if(type==="VP8X"){hasVP8X=true;if(len<10)throw Error("Invalid WebP VP8X chunk");if(strip){chunk=chunk.slice();chunk[8]&=~0x0c;}}
  if(type==="EXIF"||type==="XMP "){count++;if(strip)removed.push(type.trim());}
  else chunks.push(chunk);
  p=end;
 }
 if(strip&&count&&!hasVP8X)throw Error("WebP metadata found without VP8X; refusing unsafe rewrite");
 if(!strip)return {count,removed,bytes:a,notes:["ICC profiles and media pixels remain unchanged."]};
 const payload=concat(chunks);const out=new Uint8Array(12+payload.length);
 out.set(a.subarray(0,12));out.set(payload,12);put32(out,4,out.length-8);
 return {count,removed,bytes:out,notes:["ICC profiles and media pixels remain unchanged."]};
}
function mp3(a,strip){
 let begin=0,end=a.length,count=0,removed=[];
 if(decode(a,0,3)==="ID3"){
  if(a.length<10||[6,7,8,9].some(i=>a[i]>127))throw Error("Invalid ID3v2 header");
  const size=(a[6]<<21)|(a[7]<<14)|(a[8]<<7)|a[9];
  begin=10+size+((a[5]&0x10)?10:0);if(begin>a.length)throw Error("Invalid ID3v2 size");
  count++;if(strip)removed.push("ID3v2");
 }
 if(end-begin>=128&&decode(a,end-128,3)==="TAG"){end-=128;count++;if(strip)removed.push("ID3v1");}
 if(begin>=end)throw Error("No MP3 audio payload after tags");
 if(a.length>=32&&decode(a,a.length-32,8)==="APETAGEX")throw Error("APEv2 tag detected; removal is not implemented safely");
 return {count,removed,bytes:strip?a.slice(begin,end):a,notes:["Other MP3 tag formats or in-stream identifiers may remain."]};
}
function wav(a,strip){
 if(le32(a,4)+8!==a.length)throw Error("Invalid WAV RIFF length");
 let p=12,count=0,removed=[],chunks=[];
 const meta=new Set(["bext","iXML","axml","cart","DISP","id3 ","ID3 ","XMP "]);
 while(p<a.length){
  if(p+8>a.length)throw Error("Truncated WAV chunk");
  const kind=decode(a,p,4),len=le32(a,p+4),end=p+8+len+(len&1);
  if(len>a.length-p-8||end>a.length)throw Error("Invalid WAV chunk length");
  const isMeta=meta.has(kind)||(kind==="LIST"&&len>=4&&decode(a,p+8,4)==="INFO");
  if(isMeta){count++;if(strip)removed.push(kind);}
  if(!strip||!isMeta)chunks.push(a.subarray(p,end));
  p=end;
 }
 if(!strip)return {count,removed,bytes:a,notes:["Audio samples and unknown chunks are preserved."]};
 const out=concat([a.subarray(0,12),...chunks]);put32(out,4,out.length-8);
 return {count,removed,bytes:out,notes:["Audio samples and unknown chunks are preserved."]};
}
function binary(a,strip=false){const format=identify(a);if(format==="jpeg")return {...jpeg(a,strip),format};if(format==="png")return {...png(a,strip),format};if(format==="webp")return {...webp(a,strip),format};if(format==="wav")return {...wav(a,strip),format};if(format==="mp3")return {...mp3(a,strip),format};return {format,count:0,removed:[],bytes:a,notes:["No verified binary metadata remover for this format."]};}
async function office(a,strip,zipLib){
 if(!zipLib)throw Error("JSZip is unavailable; Office sanitization is disabled");
 const zip=await zipLib.loadAsync(a,{checkCRC32:true});
 const keys=Object.keys(zip.files);
 const fileKind=keys.includes("word/document.xml")?"docx":keys.includes("xl/workbook.xml")?"xlsx":keys.includes("ppt/presentation.xml")?"pptx":null;
 if(!fileKind)throw Error("Not a recognized Office Open XML document");
 if(keys.some(k=>k.startsWith("_xmlsignatures/")||k.includes("/_xmlsignatures/")))throw Error("Digitally signed Office file: preserving the existing signature");
 const targets=keys.filter(k=>/^docProps\/(?:core|app|custom|thumbnail)\.(?:xml|jpeg|jpg|png)$/i.test(k));
 const notes=["ZIP package rebuilt: compression and byte-level hashes can change.","Other metadata may remain in document content, comments, relationships or embedded objects."];
 if(!strip)return {format:fileKind,count:targets.length,removed:[],bytes:a,notes};
 if(!targets.length)return {format:fileKind,count:0,removed:[],bytes:a,notes};
 targets.forEach(k=>zip.remove(k));
 const removeTypes=new Set(["core-properties","extended-properties","custom-properties","thumbnail"]);
 const relPath="_rels/.rels",rel=zip.file(relPath);
 if(rel){
  const doc=new DOMParser().parseFromString(await rel.async("string"),"application/xml");
  if(doc.querySelector("parsererror"))throw Error("Invalid Office relationship XML");
  for(const el of [...doc.getElementsByTagName("Relationship")]){
   const type=el.getAttribute("Type")||"";
   if([...removeTypes].some(t=>type.endsWith("/"+t)))el.parentNode.removeChild(el);
  }
  zip.file(relPath,new XMLSerializer().serializeToString(doc));
 }
 const ct=zip.file("[Content_Types].xml");
 if(ct){
  const doc=new DOMParser().parseFromString(await ct.async("string"),"application/xml");
  if(doc.querySelector("parsererror"))throw Error("Invalid Office content-types XML");
  for(const el of [...doc.getElementsByTagName("Override")]){
   if(targets.includes((el.getAttribute("PartName")||"").replace(/^\//,"")))el.parentNode.removeChild(el);
  }
  zip.file("[Content_Types].xml",new XMLSerializer().serializeToString(doc));
 }
 const bytes=await zip.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:6}});
 const verify=await zipLib.loadAsync(bytes,{checkCRC32:true});
 if(targets.some(k=>verify.file(k)))throw Error("Office metadata-removal verification failed");
 return {format:fileKind,count:targets.length,removed:targets,bytes,notes};
}
async function pdf(a,strip,pdfLib){
 if(!pdfLib)throw Error("pdf-lib unavailable");
 const doc=await pdfLib.PDFDocument.load(a,{updateMetadata:false});
 const info=doc.context.trailerInfo.Info;
 const meta=doc.catalog.get(pdfLib.PDFName.of("Metadata"));
 const count=Number(Boolean(info))+Number(Boolean(meta));
 const notes=["Removes trailer Info and catalog XMP reference only; nested metadata, old revisions or content identifiers may remain.","Full rewriting can invalidate existing digital signatures and change byte-level document characteristics."];
 if(!strip)return {format:"pdf",count,removed:[],bytes:a,notes};
 // Conservative refusal: signatures require dedicated preservation/revision logic.
 const sigFields=doc.getForm().getFields().some(f=>f.constructor?.name==="PDFSignature");
 let hasByteRange=false;
 // Scan ASCII tokens, not PDF object semantics: conservative and intentionally may reject some harmless PDFs.
 for(let i=0;i<a.length-10;i++){if(a[i]===47&&decode(a,i,10)==="/ByteRange"){hasByteRange=true;break;}}
 if(sigFields||hasByteRange)throw Error("Potential digital signature: refusing to invalidate the signed document");
 if(!count)return {format:"pdf",count:0,removed:[],bytes:a,notes};
 doc.context.trailerInfo.Info=undefined;
 doc.catalog.delete(pdfLib.PDFName.of("Metadata"));
 const bytes=await doc.save({useObjectStreams:true});
 const check=await pdfLib.PDFDocument.load(bytes,{updateMetadata:false});
 if(check.context.trailerInfo.Info||check.catalog.get(pdfLib.PDFName.of("Metadata")))throw Error("PDF metadata-removal verification failed");
 return {format:"pdf",count,removed:["Info dictionary","Catalog XMP metadata"].filter((_,i)=>i===0?Boolean(info):Boolean(meta)),bytes,notes};
}
async function process(a,name,{remove=false,zipLib, pdfLib}={}){
 if(!(a instanceof Uint8Array)||!a.length)throw Error("An actual nonempty file is required");
 const kind=identify(a,name);
 let result;
 if(kind==="pdf")result=await pdf(a,remove,pdfLib);
 else if(kind==="zip"){
  // Generic ZIP files must remain untouched. OOXML must be positively identified.
  if(!/\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i.test(name))return {format:"zip",supported:false,changed:false,count:0,bytes:a,removed:[],notes:["Generic ZIP metadata removal is unsupported."]};
  result=await office(a,remove,zipLib);
 }else result=binary(a,remove);
 const supported=["jpeg","png","webp","mp3","wav","pdf","docx","xlsx","pptx"].includes(result.format);
 return {...result,supported,changed:remove&&result.removed.length>0,
   verification:!remove?"Inspection only":!supported?"Unsupported":result.removed.length?"Format-specific removal verified; universal metadata and watermark removal NOT guaranteed":"No supported metadata blocks found; not certified metadata-free"};
}
return {identify,binary,process,jpeg,png,webp,mp3,wav};
});
