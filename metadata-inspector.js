/* Metadata field inspection. Client-only. Explicit partial-coverage reporting.
   This inspector reports actual parsed values rather than claiming all metadata was found. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.FileMetaInspector=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const ascii=(a,p=0,n=a.length-p)=>Array.from(a.subarray(p,p+n),v=>String.fromCharCode(v)).join("");
const le32=(a,p)=>(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0;
const be32=(a,p)=>((a[p]*16777216)+(a[p+1]<<16)+(a[p+2]<<8)+a[p+3])>>>0;
const utf8=(a)=>new TextDecoder("utf-8",{fatal:false}).decode(a);
const bytesPreview=(a)=>Array.from(a.subarray(0,24),x=>x.toString(16).padStart(2,"0")).join(" ");
const label=(s)=>String(s).replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,250);
function inspect(a,name="",deps={}){
 if(!(a instanceof Uint8Array)||!a.length)throw Error("Nonempty Uint8Array required");
 const format=globalFormat(a,name);
 const fields=[],warnings=[],seen=new Set();
 let valueBudget=2*1048576;
 function add(key,value,source,kind="metadata"){
  if(fields.length>=2000){if(!warnings.includes("Field inspection limited to 2000 entries"))warnings.push("Field inspection limited to 2000 entries");return;}
  if(value===undefined||value===null||value==="")return;
  let str=String(value).replace(/\u0000/g,"");
  const originalChars=str.length;
  const allowed=Math.min(131072,valueBudget);
  if(str.length>allowed){
   str=str.slice(0,allowed)+"… [truncated]";
   if(!warnings.includes("Some extracted values were truncated by the 128 KiB per-field / 2 MiB total inspection budget"))warnings.push("Some extracted values were truncated by the 128 KiB per-field / 2 MiB total inspection budget");
  }
  valueBudget=Math.max(0,valueBudget-Math.min(originalChars,allowed));
  const title=label(key),id=source+":"+title+":"+str;
  if(seen.has(id))return;
  seen.add(id);
  fields.push({name:title,value:str,source,kind,complete:originalChars<=allowed,originalCharacters:originalChars});
 }
 const ctx={add,warnings};
 if(format==="jpeg")jpeg(a,ctx);
 else if(format==="png")return png(a,ctx).then(()=>finish(format,fields,warnings));
 else if(format==="webp")webp(a,ctx);
 else if(format==="mp3")mp3(a,ctx);
 else if(format==="wav")wav(a,ctx);
 else if(format==="gif")gif(a,ctx);
 else if(format==="flac")flac(a,ctx);
 else if(format==="tiff")tiff(a,ctx,"TIFF");
 else if(typeof FileMetaExtended!=="undefined"&&FileMetaExtended.inspect(a,format,ctx)){/* explicitly read-only extra formats */}
 else if(format==="pdf")return pdf(a,ctx,deps).then(()=>finish(format,fields,warnings));
 else if(format==="zip"&&/\.(docx|xlsx|pptx)$/i.test(name))return office(a,ctx,deps).then(k=>finish(k,fields,warnings));
 else warnings.push("No detailed metadata field parser for this format; file is not certified metadata-free.");
 if(!["jpeg","png","webp","mp3","wav","gif","flac"].includes(format))warnings.push("Format recognition is inspection-only.");
 return finish(format,fields,warnings);
}
function finish(format,fields,warnings){
 return {format,fields,warnings:[...new Set(warnings)],coverage:"Partial: known fields and containers only; unsupported properties remain possible",fieldCounts:{metadata:fields.filter(f=>f.kind!=="technical").length,technical:fields.filter(f=>f.kind==="technical").length,truncated:fields.filter(f=>!f.complete).length},limits:{maxFields:2000,maxValueCharacters:131072,totalValueCharacters:2097152},watermarkStatus:"Not assessed: embedded SynthID/invisible watermarks require a trusted content detector"};
}
function globalFormat(a,name){
 const E=typeof FileMetaEngine!=="undefined"?FileMetaEngine:null;
 const X=typeof FileMetaExtraFormats!=="undefined"?FileMetaExtraFormats:null;
 let k=E?E.identify(a,name):"unknown";
 if(k==="unknown"&&X)k=X.identify(a)||"unknown";
 return k;
}
const exifNames={0x010e:"ImageDescription",0x010f:"Make",0x0110:"Model",0x0112:"Orientation",0x0131:"Software",0x0132:"DateTime",0x013b:"Artist",0x8298:"Copyright",0x9003:"DateTimeOriginal",0x9004:"DateTimeDigitized",0x9286:"UserComment",0xa420:"ImageUniqueID",0xa434:"LensModel",0xa431:"BodySerialNumber",0x0001:"GPSLatitudeRef",0x0002:"GPSLatitude",0x0003:"GPSLongitudeRef",0x0004:"GPSLongitude",0x0005:"GPSAltitudeRef",0x0006:"GPSAltitude",0x001d:"GPSDateStamp",0x0007:"GPSTimeStamp"};
function tiff(bytes,ctx,prefix="EXIF"){
 if(bytes.length<8)throw Error("Invalid EXIF/TIFF header");
 const bo=ascii(bytes,0,2);
 if(bo!=="II"&&bo!=="MM")throw Error("Invalid EXIF byte order");
 const little=bo==="II";
 const u16=p=>{if(p<0||p+2>bytes.length)throw Error("EXIF short read");return little?bytes[p]|(bytes[p+1]<<8):(bytes[p]<<8)|bytes[p+1];};
 const u32=p=>{if(p<0||p+4>bytes.length)throw Error("EXIF long read");return little?le32(bytes,p):be32(bytes,p);};
 if(u16(2)!==42)throw Error("Unsupported TIFF variant");
 const seen=new Set();
 function ifd(pos,scope,depth){
  if(depth>4||seen.has(pos))return;seen.add(pos);
  if(pos<=0||pos+2>bytes.length)throw Error("EXIF IFD out of bounds");
  const count=u16(pos);if(count>512||pos+2+count*12+4>bytes.length)throw Error("Invalid EXIF IFD size");
  for(let i=0;i<count;i++){
   const p=pos+2+i*12,tag=u16(p),type=u16(p+2),n=u32(p+4);
   const width=({1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8})[type];
   if(!width||n>250000)continue;
   const sz=n*width,at=sz<=4?p+8:u32(p+8);
   if(at+sz>bytes.length)throw Error("EXIF tag value out of bounds");
   if([0x8769,0x8825,0xa005].includes(tag)){if(type===4&&n===1)ifd(u32(at),tag===0x8825?"GPS":"EXIF",depth+1);continue;}
   let value;
   if(type===2)value=ascii(bytes,at,Math.min(sz,1024)).replace(/\0+$/,"");
   else if(type===3)value=Array.from({length:Math.min(n,8)},(_,j)=>u16(at+j*2)).join(", ");
   else if(type===4)value=Array.from({length:Math.min(n,8)},(_,j)=>u32(at+j*4)).join(", ");
   else if(type===5||type===10)value=Array.from({length:Math.min(n,4)},(_,j)=>{const o=at+j*8;return u32(o)+"/"+u32(o+4);}).join(", ");
   else if(type===7)value=n+" bytes (binary)";
   else value=n+" bytes";
   const known=exifNames[tag]||("Tag 0x"+tag.toString(16).padStart(4,"0"));
   ctx.add(scope+" "+known,value,prefix);
  }
  const next=u32(pos+2+count*12);if(next)ifd(next,scope,depth+1);
 }
 ifd(u32(4),"IFD0",0);
}
function jpeg(a,ctx){
 let p=2,scanCount=0;
 while(p<a.length){
  if(a[p]!==255)throw Error("Malformed JPEG segment marker");
  while(p<a.length&&a[p]===255)p++;
  if(p>=a.length)throw Error("Truncated JPEG marker");
  const mark=a[p++];
  if(mark===0xd9)break;
  if(mark===0x01)continue;
  if(mark===0x00||mark===0xd8||(mark>=0xd0&&mark<=0xd7))throw Error("Invalid JPEG marker outside scan");
  if(p+2>a.length)throw Error("Truncated JPEG metadata header");
  const n=(a[p]<<8)|a[p+1],from=p+2,end=p+n;
  if(n<2||end>a.length)throw Error("Malformed JPEG segment");
  if(mark===0xda){
   scanCount++;p=end;
   while(p<a.length){
    if(a[p]!==255){p++;continue;}
    let q=p+1;while(q<a.length&&a[q]===255)q++;
    if(q>=a.length)throw Error("Truncated JPEG entropy scan");
    if(a[q]===0||(a[q]>=0xd0&&a[q]<=0xd7)){p=q+1;continue;}
    break;
   }
   continue;
  }
  const block=a.subarray(from,end);
  if(mark===0xe1&&ascii(block,0,6)==="Exif\0\0")tiff(block.subarray(6),ctx);
  else if(mark===0xe1&&ascii(block,0,29)==="http://ns.adobe.com/xap/1.0/\0")ctx.add("XMP preview",utf8(block.subarray(29)),"JPEG APP1 XMP");
  else if(mark===0xed)ctx.add("IPTC/Photoshop resource","Present ("+block.length+" bytes)","JPEG APP13");
  else if(mark===0xfe)ctx.add("Comment",utf8(block),"JPEG COM");
  else if(mark===0xe2&&ascii(block,0,11)==="ICC_PROFILE")ctx.add("ICC profile","Present ("+block.length+" bytes)","JPEG APP2");
  p=end;
 }
 ctx.add("JPEG scans",scanCount,"JPEG structure");
 ctx.warnings.push("JPEG EXIF orientation and ICC can affect rendering; output display fidelity is not automatically verified.");
}
async function inflatePNGText(data,ctx,name){
 const max=256*1024;
 if(data.length>max){ctx.warnings.push(name+" compressed source exceeds 256 KiB decoding budget");return null;}
 if(typeof DecompressionStream==="undefined"||typeof Blob==="undefined"){
  ctx.warnings.push(name+" compressed text cannot be decoded in this browser");return null;
 }
 try{
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader=stream.getReader(),chunks=[];let total=0;
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   total+=value.length;
   if(total>max){await reader.cancel().catch(()=>{});ctx.warnings.push(name+" expanded text exceeds 256 KiB decoding budget");return null;}
   chunks.push(value);
  }
  return join(chunks);
 }catch(e){ctx.warnings.push(name+" text could not be decompressed safely");return null;}
}
async function png(a,ctx){
 let p=8;
 while(p+12<=a.length){
  const n=be32(a,p),type=ascii(a,p+4,4),from=p+8,end=from+n;
  if(end+4>a.length)throw Error("Malformed PNG chunk");
  const v=a.subarray(from,end);
  if(type==="IHDR"&&n===13){ctx.add("Width",be32(v,0),"PNG IHDR");ctx.add("Height",be32(v,4),"PNG IHDR");ctx.add("Bit depth",v[8],"PNG IHDR");}
  if(type==="tEXt"){const i=v.indexOf(0);if(i>0)ctx.add(utf8(v.subarray(0,i)),utf8(v.subarray(i+1)),"PNG tEXt");}
  if(type==="zTXt"){
   const i=v.indexOf(0);
   if(i<=0||i+2>v.length||v[i+1]!==0)throw Error("Invalid PNG zTXt header");
   const uncompressed=await inflatePNGText(v.subarray(i+2),ctx,"PNG zTXt");
   ctx.add(ascii(v,0,i),uncompressed?ascii(uncompressed):"Present, compressed; decoding unavailable","PNG zTXt");
  }
  if(type==="iTXt"){
   const i=v.indexOf(0);if(i>0&&i+2<v.length){
    const k=utf8(v.subarray(0,i)),compressed=v[i+1]===1;let at=i+3;
    const l=v.indexOf(0,at);if(l>=0){at=l+1;const t=v.indexOf(0,at);if(t>=0){at=t+1;const payload=compressed?await inflatePNGText(v.subarray(at),ctx,"PNG iTXt"):v.subarray(at);
     ctx.add(k,payload?utf8(payload):"Present, compressed; decoding unavailable","PNG iTXt");}}
   }
  }
  if(type==="eXIf")tiff(v,ctx,"PNG eXIf");
  if(type==="tIME"&&n===7)ctx.add("Modified time",((v[0]<<8)|v[1])+"-"+v[2]+"-"+v[3]+" "+v[4]+":"+v[5]+":"+v[6],"PNG tIME");
  if(type==="iCCP")ctx.add("ICC profile","Present ("+n+" bytes)","PNG iCCP");
  p=end+4;if(type==="IEND")break;
 }
}
function webp(a,ctx){
 let p=12;
 while(p+8<=a.length){
  const type=ascii(a,p,4),n=le32(a,p+4),from=p+8;
  if(from+n>a.length)throw Error("Malformed WebP chunk");
  const chunk=a.subarray(from,from+n);
  if(type==="EXIF"){const raw=ascii(chunk,0,6)==="Exif\0\0"?chunk.subarray(6):chunk;tiff(raw,ctx,"WebP EXIF");}
  if(type==="XMP ")ctx.add("XMP preview",utf8(chunk),"WebP XMP");
  if(type==="ICCP")ctx.add("ICC profile","Present ("+n+" bytes)","WebP ICCP");
  p=from+n+(n&1);
 }
}
function mp3(a,ctx){
 let p=0;if(ascii(a,0,3)==="ID3"&&a.length>=10){
  const major=a[3],size=(a[6]<<21)|(a[7]<<14)|(a[8]<<7)|a[9],end=Math.min(a.length,10+size);
  ctx.add("ID3 version","2."+major,"ID3 header");
  if(major===3||major===4){
   p=10;
   while(p+10<=end){
    const id=ascii(a,p,4);
    if(!/^[A-Z0-9]{4}$/.test(id))break;
    const sz=major===4?((a[p+4]<<21)|(a[p+5]<<14)|(a[p+6]<<7)|a[p+7]):be32(a,p+4);
    if(!sz||sz>end-p-10)break;
    const v=a.subarray(p+10,p+10+sz);
    const names={TIT2:"Title",TPE1:"Artist",TALB:"Album",TDRC:"Recording date",TYER:"Year",TRCK:"Track",TCON:"Genre",TCOM:"Composer",TENC:"Encoder"};
    if(names[id]&&v.length){
     const coding=v[0];
     let textValue="";
     if(coding===0)textValue=ascii(v,1,Math.min(v.length-1,2048));
     else if(coding===3)textValue=utf8(v.subarray(1));
     else if(coding===1||coding===2){const b=v.subarray(1);try{textValue=new TextDecoder("utf-16"+(coding===2?"be":"")).decode(b);}catch{textValue="Unicode text present (unable to decode)";}}
     ctx.add(names[id],textValue,"ID3 "+id);
    }else if(id==="APIC")ctx.add("Cover art","Present ("+sz+" bytes)","ID3 APIC");
    else if(id==="COMM")ctx.add("Comment","Present ("+sz+" bytes)","ID3 COMM");
    p+=10+sz;
   }
  }else ctx.warnings.push("ID3v2."+major+" frame decoding unavailable");
 }
 if(a.length>=128&&ascii(a,a.length-128,3)==="TAG"){
  const x=a.length-128;
  for(const [k,off,len] of [["Title",3,30],["Artist",33,30],["Album",63,30],["Year",93,4],["Comment",97,30]])ctx.add(k,ascii(a,x+off,len).replace(/\0+$/,"").trim(),"ID3v1");
 }
 ctx.warnings.push("MP3 other tag formats, unsynchronisation and embedded identifiers may remain.");
}
function wav(a,ctx){
 let p=12;
 while(p+8<=a.length){
  const tag=ascii(a,p,4),n=le32(a,p+4),at=p+8;
  if(n>a.length-at)throw Error("Malformed WAV chunk");
  if(tag==="LIST"&&n>=4&&ascii(a,at,4)==="INFO"){
   let q=at+4;
   while(q+8<=at+n){
    const key=ascii(a,q,4),len=le32(a,q+4);
    if(len>at+n-q-8)break;
    ctx.add(key,ascii(a,q+8,Math.min(len,2048)).replace(/\0+$/,""),"WAV LIST/INFO");
    q+=8+len+(len&1);
   }
  }else if(["bext","iXML","axml","cart","DISP","id3 ","ID3 ","XMP "].includes(tag))ctx.add(tag,"Present ("+n+" bytes)","WAV "+tag);
  else if(tag==="fmt "&&n>=16){ctx.add("Channels",a[at+2]|(a[at+3]<<8),"WAV fmt");ctx.add("Sample rate",le32(a,at+4),"WAV fmt");}
  p=at+n+(n&1);
 }
}
function gif(a,ctx){
 if(a.length<14||!["GIF87a","GIF89a"].includes(ascii(a,0,6)))throw Error("Truncated or invalid GIF header");
 const width=a[6]|a[7]<<8,height=a[8]|a[9]<<8,flags=a[10];
 if(!width||!height)throw Error("GIF canvas dimensions must be nonzero");
 let p=13+((flags&0x80)?3*(1<<((flags&7)+1)):0);
 if(p>a.length)throw Error("Truncated GIF global color table");
 ctx.add("Version",ascii(a,0,6),"GIF logical screen","technical");
 ctx.add("Width",width,"GIF logical screen","technical");
 ctx.add("Height",height,"GIF logical screen","technical");
 ctx.add("Global palette colors",(flags&0x80)?1<<((flags&7)+1):"No global palette","GIF logical screen","technical");
 ctx.add("Background color index",a[11],"GIF logical screen","technical");
 if(a[12])ctx.add("Pixel aspect ratio",((a[12]+15)/64).toFixed(3),"GIF logical screen","technical");
 let frames=0,delayCs=0,transparency=0,comments=0,plainText=0,xmp=0;
 let gceDelay=0,gceTransparency=false,applicationCount=0,loopCount=null,ended=false,steps=0;
 const otherApps=new Set();
 while(p<a.length){
  if(++steps>500000)throw Error("Excessive GIF blocks");
  const kind=a[p++];
  if(kind===0x3b){
   if(p!==a.length)throw Error("Unexpected trailing bytes after GIF trailer");
   ended=true;break;
  }
  if(kind===0x2c){
   if(p+9>a.length)throw Error("Truncated GIF image descriptor");
   const left=a[p]|a[p+1]<<8,top=a[p+2]|a[p+3]<<8;
   const fw=a[p+4]|a[p+5]<<8,fh=a[p+6]|a[p+7]<<8;
   if(!fw||!fh)throw Error("GIF frame dimensions must be nonzero");
   const f=a[p+8];p+=9;
   if(f&0x80){
    const palette=3*(1<<((f&7)+1));
    if(palette>a.length-p)throw Error("Truncated GIF local color table");
    p+=palette;
   }
   if(p>=a.length)throw Error("Truncated GIF image data");
   p++;p=skipSub(a,p);
   frames++;delayCs+=gceDelay;
   if(gceTransparency)transparency++;
   if(frames<=5)ctx.add("Frame "+frames+" geometry",fw+" × "+fh+" at "+left+","+top,"GIF image descriptor","technical");
   gceDelay=0;gceTransparency=false;
   continue;
  }
  if(kind!==0x21||p>=a.length)throw Error("Invalid GIF extension block");
  const ext=a[p++];
  if(ext===0xfe){
   let parts=[],size=0;
   while(true){
    if(p>=a.length)throw Error("Truncated GIF comment");
    const n=a[p++];if(!n)break;
    if(n>a.length-p)throw Error("Truncated GIF comment data");
    if(size<131072)parts.push(a.subarray(p,p+Math.min(n,131072-size)));
    size+=n;p+=n;
   }
   comments++;
   ctx.add("Comment "+comments,utf8(join(parts))+(size>131072?"… [truncated]":""),"GIF comment");
   continue;
  }
  if(p>=a.length)throw Error("Truncated GIF extension size");
  const n=a[p++];
  if(n>a.length-p)throw Error("Invalid GIF extension block size");
  const app=ext===0xff?ascii(a,p,n):"";
  if(ext===0xf9){
   if(n!==4||p+5>a.length||a[p+4]!==0)throw Error("Invalid GIF graphic control block");
   gceTransparency=!!(a[p]&1);
   gceDelay=a[p+1]|a[p+2]<<8;
   p+=5;
  }else{
   p+=n;
   if(ext===0xff){
    applicationCount++;
    if(app==="XMP DataXMP"){
     xmp++;
     const result=readGifData(a,p,131072);
     const raw=result.data;
     // Adobe GIF XMP trailer can be appended after the XML packet.
     const packet=utf8(raw);
     const endXML=Math.max(packet.lastIndexOf("</x:xmpmeta>")+12,packet.lastIndexOf("</rdf:RDF>")+10);
     ctx.add("XMP packet "+xmp,(endXML>0?packet.slice(0,endXML):packet).replace(/\0+$/,""),"GIF XMP application");
     if(result.truncated)ctx.warnings.push("GIF XMP packet truncated by 128 KiB inspection budget.");
     p=result.next;
    }else if(app==="NETSCAPE2.0"||app==="ANIMEXTS1.0"){
     if(p+5<=a.length&&a[p]===3&&a[p+1]===1&&a[p+4]===0)loopCount=a[p+2]|a[p+3]<<8;
     p=skipSub(a,p);
    }else{
     otherApps.add(app||"Unnamed extension");
     const result=readGifData(a,p,4096);
     ctx.add("Application extension "+applicationCount,(app||"Unnamed")+" — "+result.length+" bytes; hex preview: "+hexPreview(result.data,64),"GIF application");
     if(result.truncated)ctx.warnings.push("Some GIF application extension payloads were not fully displayed.");
     p=result.next;
    }
   }else if(ext===0x01){
    plainText++;
    const result=readGifData(a,p,131072);
    ctx.add("Plain text extension "+plainText,utf8(result.data),"GIF plain text");
    if(result.truncated)ctx.warnings.push("GIF plain text extension truncated by inspection budget.");
    p=result.next;
   }else p=skipSub(a,p);
  }
 }
 if(!ended||!frames)throw Error("GIF missing frame data or trailer");
 ctx.add("Frame count",frames,"GIF animation","technical");
 ctx.add("Animated",frames>1?"Yes":"No","GIF animation","technical");
 ctx.add("Total frame delay",(delayCs/100).toFixed(2)+" seconds (declared)","GIF animation","technical");
 ctx.add("Frames with transparency",transparency,"GIF animation","technical");
 if(loopCount!==null)ctx.add("Animation loop count",loopCount===0?"Infinite":loopCount,"GIF application","technical");
 ctx.add("Application extensions",applicationCount,"GIF structure","technical");
 if(otherApps.size){
  ctx.add("Unrecognized application extension IDs",Array.from(otherApps).join(", "),"GIF application");
  ctx.warnings.push("Unrecognized GIF application extensions are preserved and may contain additional metadata.");
 }
 if(plainText)ctx.warnings.push("GIF plain-text extensions are preserved by the cleaner and may contain user-visible information.");
 if(!comments&&!xmp)ctx.warnings.push("No removable GIF comment/XMP blocks detected. Technical properties are not removable personal metadata.");
 ctx.warnings.push("Declared frame delay does not predict exact browser playback timing; embedded content watermarks are not assessed.");
}
function hexPreview(a,limit=64){return Array.from(a.subarray(0,limit),n=>n.toString(16).padStart(2,"0")).join(" ")+(a.length>limit?" …":"");}
function readGifData(a,p,max){
 let length=0,parts=[],stored=0;
 while(p<a.length){
  const n=a[p++];if(n===0)return {next:p,length,data:join(parts),truncated:length>max};
  if(n>a.length-p)throw Error("GIF application data truncated");
  if(stored<max){const b=a.subarray(p,p+Math.min(n,max-stored));parts.push(b);stored+=b.length;}
  length+=n;p+=n;
 }
 throw Error("GIF application data not terminated");
}
function skipSub(a,p){while(p<a.length){const n=a[p++];if(!n)return p;if(n>a.length-p)throw Error("Truncated GIF sub-block");p+=n;}throw Error("Unterminated GIF sub-blocks");}
function join(parts){const n=parts.reduce((x,p)=>x+p.length,0),out=new Uint8Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function flac(a,ctx){
 let p=4;
 while(p+4<=a.length){
  const h=a[p++],type=h&127,n=(a[p++]<<16)|(a[p++]<<8)|a[p++],last=!!(h&128);
  if(p+n>a.length)throw Error("Malformed FLAC metadata");
  if(type===4&&n>=8){
   const end=p+n;let pos=p;
   const vendorSize=le32(a,pos);pos+=4;
   if(vendorSize<=end-pos){ctx.add("Encoder",utf8(a.subarray(pos,pos+vendorSize)),"FLAC Vorbis");pos+=vendorSize;
    if(pos+4<=end){const count=le32(a,pos);pos+=4;
     if(count>10000)throw Error("Excessive FLAC comments");
     for(let j=0;j<count;j++){if(pos+4>end)throw Error("Invalid FLAC comments");const len=le32(a,pos);pos+=4;if(len>end-pos)throw Error("Invalid FLAC comment length");
      const entry=utf8(a.subarray(pos,pos+len)),idx=entry.indexOf("=");if(idx>0)ctx.add(entry.slice(0,idx),entry.slice(idx+1),"FLAC Vorbis");pos+=len;
     }
    }
   }
  }else if(type===6)ctx.add("Embedded picture","Present ("+n+" bytes)","FLAC PICTURE");
  else if(type===2)ctx.add("Application metadata","Present ("+n+" bytes)","FLAC APPLICATION");
  p+=n;if(last)break;
 }
}
async function pdf(a,ctx,{pdfLib}={}){
 if(!pdfLib){ctx.warnings.push("PDF parser unavailable");return;}
 const doc=await pdfLib.PDFDocument.load(a,{updateMetadata:false});
 ctx.add("Pages",doc.getPageCount(),"PDF catalog");
 for(const [k,get]of [["Title","getTitle"],["Author","getAuthor"],["Subject","getSubject"],["Keywords","getKeywords"],["Creator","getCreator"],["Producer","getProducer"],["Creation date","getCreationDate"],["Modification date","getModificationDate"]]){try{const value=doc[get]();if(value)ctx.add(k,value instanceof Date?value.toISOString():value,"PDF Info");}catch{}}
 if(doc.catalog.get(pdfLib.PDFName.of("Metadata")))ctx.add("Catalog XMP","Present; packet content not decoded","PDF catalog");
 ctx.warnings.push("Nested XMP, attachments, incremental revisions and content identifiers may remain.");
}
async function office(a,ctx,{zipLib}={}){
 if(!zipLib||typeof FileMetaZipGuard==="undefined")throw Error("Office ZIP parser or decompression guard unavailable");
 FileMetaZipGuard.preflight(a);
 const zip=await zipLib.loadAsync(a,{checkCRC32:true});
 const kind=zip.file("word/document.xml")?"docx":zip.file("xl/workbook.xml")?"xlsx":zip.file("ppt/presentation.xml")?"pptx":"zip";
 if(kind==="zip"){ctx.warnings.push("ZIP not recognized as Office document");return kind;}
 if(typeof DOMParser==="undefined")throw Error("XML parser unavailable");
 const paths=["docProps/core.xml","docProps/app.xml","docProps/custom.xml"];
 for(const path of paths){const file=zip.file(path);if(!file)continue;
  const txt=await file.async("string");if(txt.length>2*1048576)throw Error("Office metadata XML exceeds safety budget");
  const xml=new DOMParser().parseFromString(txt,"application/xml");
  if(xml.getElementsByTagName("parsererror").length)throw Error("Invalid Office metadata XML");
  const stack=[xml.documentElement];let count=0;
  while(stack.length){const el=stack.pop();if(!el)continue;
   for(const child of Array.from(el.children||[])){if(++count>3000)throw Error("Excessive Office metadata nodes");stack.push(child);}
   if(!el.children||!el.children.length){const value=(el.textContent||"").trim();if(value)ctx.add(el.getAttribute("name")||el.localName||el.nodeName,value,path);}
  }
 }
 ctx.warnings.push("Office authors, comments, revisions and embedded content outside docProps are not fully inspected.");
 return kind;
}
return {inspect};
});
