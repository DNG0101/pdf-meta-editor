/* Independent, byte-preservation-oriented verifier.
   Assesses known structural content; it CANNOT establish full media validity,
   undetectable identifiers, or absence of SynthID. */
(function(root,factory){const x=factory();if(typeof module==="object"&&module.exports)module.exports=x;root.FileMetaVerifier=x;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const str=(a,p,n)=>Array.from(a.subarray(p,p+n),v=>String.fromCharCode(v)).join("");
const u32le=(a,p)=>(a[p]|(a[p+1]<<8)|(a[p+2]<<16)|(a[p+3]<<24))>>>0;
const u32be=(a,p)=>((a[p]*16777216)+(a[p+1]<<16)+(a[p+2]<<8)+a[p+3])>>>0;
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function assertBytes(a,b,what){
 if(a.length!==b.length)throw Error(what+" size differs after cleaning");
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error(what+" changed at byte "+i);
}
function compare(before,after,what){
 if(before.length!==after.length)throw Error(what+" structure changed unexpectedly");
 for(let i=0;i<before.length;i++)assertBytes(before[i],after[i],what+" part "+(i+1));
}
function jpeg(a){
 if(a.length<4||a[0]!==255||a[1]!==216)throw Error("Invalid JPEG signature");
 const parts=[a.subarray(0,2)];
 let p=2,sawScan=false,end=false;
 while(p<a.length){
  const start=p;
  if(a[p]!==255)throw Error("Invalid JPEG segment marker");
  while(p<a.length&&a[p]===255)p++;
  if(p>=a.length)throw Error("Truncated JPEG marker");
  const m=a[p++];
  if(m===0xd9){if(p!==a.length)throw Error("JPEG trailing bytes");parts.push(a.subarray(start,p));end=true;break;}
  if(m===0x00||m===0xd8||(m>=0xd0&&m<=0xd7))throw Error("Invalid JPEG marker outside scan");
  if(m===0x01){parts.push(a.subarray(start,p));continue;}
  if(p+2>a.length)throw Error("Missing JPEG segment length");
  const n=(a[p]<<8)|a[p+1];if(n<2||n>a.length-p)throw Error("Invalid JPEG segment length");
  if(m===0xda){
   if(n<6)throw Error("Invalid JPEG scan header");
   sawScan=true;p+=n;
   while(p<a.length){
    if(a[p]!==255){p++;continue;}
    let q=p+1;while(q<a.length&&a[q]===255)q++;
    if(q>=a.length)throw Error("Truncated JPEG scan");
    if(a[q]===0||(a[q]>=0xd0&&a[q]<=0xd7)){p=q+1;continue;}
    break;
   }
   parts.push(a.subarray(start,p));
  }else{
   if(m!==0xe1&&m!==0xed&&m!==0xfe)parts.push(a.subarray(start,p+n));
   p+=n;
  }
 }
 if(!sawScan||!end)throw Error("Incomplete JPEG");
 return parts;
}
function png(a){
 const sig=[137,80,78,71,13,10,26,10];
 if(a.length<8||sig.some((x,i)=>a[i]!==x))throw Error("Invalid PNG signature");
 const parts=[a.subarray(0,8)];let p=8,hasIHDR=false,hasIDAT=false,ended=false,depth=0;
 const removable=new Set(["tEXt","zTXt","iTXt","eXIf","tIME"]);
 while(p<a.length){
  if(p+12>a.length)throw Error("Truncated PNG chunk");
  const n=u32be(a,p),type=str(a,p+4,4);
  if(n>a.length-p-12)throw Error("Invalid PNG chunk size");
  if(!/^[A-Za-z]{4}$/.test(type))throw Error("Invalid PNG chunk type");
  if(!hasIHDR&&(type!=="IHDR"||n!==13||p!==8))throw Error("PNG must start with 13-byte IHDR");
  if(type==="IHDR"){if(hasIHDR||n!==13||!u32be(a,p+8)||!u32be(a,p+12))throw Error("Invalid PNG IHDR");hasIHDR=true;}
  if(type==="IDAT")hasIDAT=true;
  if(type==="IEND"){if(n!==0||!hasIDAT||p+n+12!==a.length)throw Error("Invalid PNG IEND or missing IDAT");ended=true;}
  if(!removable.has(type))parts.push(a.subarray(p,p+n+12));
  p+=n+12;depth++;if(depth>100000)throw Error("Too many PNG chunks");
  if(ended)break;
 }
 if(!ended)throw Error("Missing PNG IEND");
 return parts;
}
function riff(a,format){
 if(str(a,0,4)!=="RIFF"||u32le(a,4)+8!==a.length)throw Error("RIFF file length invalid");
 const parts=[a.subarray(0,4),a.subarray(8,12)];
 let p=12;
 while(p<a.length){
  if(p+8>a.length)throw Error("Truncated RIFF chunk");
  const name=str(a,p,4),n=u32le(a,p+4),end=p+8+n+(n&1);
  if(end>a.length)throw Error("Invalid RIFF chunk size");
  let remove=false;
  if(format==="webp")remove=name==="EXIF"||name==="XMP ";
  else remove=["bext","iXML","axml","cart","DISP","id3 ","ID3 ","XMP "].includes(name)||(name==="LIST"&&n>=4&&str(a,p+8,4)==="INFO");
  if(!remove){
   const b=a.subarray(p,end);
   if(format==="webp"&&name==="VP8X"){
    const normalized=b.slice();normalized[8]&=~0x0c;parts.push(normalized);
   }else parts.push(b);
  }
  p=end;
 }
 return parts;
}
function mp3(a){
 let p=0,end=a.length;
 if(str(a,0,3)==="ID3"){
  if(a.length<10||[6,7,8,9].some(i=>a[i]>127))throw Error("Invalid MP3 ID3 header");
  p=10+((a[6]<<21)|(a[7]<<14)|(a[8]<<7)|a[9])+((a[5]&16)?10:0);
 }
 if(end-p>=128&&str(a,end-128,3)==="TAG")end-=128;
 if(p>=end)throw Error("No MP3 audio payload");
 return [a.subarray(p,end)];
}
function sub(a,p){
 while(p<a.length){const n=a[p++];if(n===0)return p;if(n>a.length-p)throw Error("Invalid GIF sub-block");p+=n;}
 throw Error("Truncated GIF sub-block");
}
function gif(a){
 if(!["GIF89a","GIF87a"].includes(str(a,0,6)))throw Error("Invalid GIF signature");
 let p=13+((a[10]&128)?3*(1<<((a[10]&7)+1)):0);
 if(p>a.length)throw Error("Invalid GIF global palette");
 const parts=[a.subarray(0,p)];let count=0,done=false;
 while(p<a.length){
  const start=p,kind=a[p++];
  if(kind===0x3b){if(p!==a.length)throw Error("GIF trailing data");parts.push(a.subarray(start,p));done=true;break;}
  if(kind===0x2c){
   if(p+9>a.length)throw Error("Invalid GIF descriptor");
   const f=a[p+8];p+=9+((f&128)?3*(1<<((f&7)+1)):0);
   if(p>=a.length)throw Error("Truncated GIF frame");
   p++;p=sub(a,p);count++;parts.push(a.subarray(start,p));continue;
  }
  if(kind!==0x21||p>=a.length)throw Error("Invalid GIF extension");
  const label=a[p++];let drop=label===0xfe;
  if(label===0xfe)p=sub(a,p);
  else{
   if(p>=a.length)throw Error("Truncated GIF extension");
   const n=a[p++];if(n>a.length-p)throw Error("Invalid GIF extension header");
   const tag=label===0xff?str(a,p,n):"";p+=n;
   if(label===0xf9){if(n!==4||p>=a.length||a[p++]!==0)throw Error("Invalid GIF graphic control");}
   else p=sub(a,p);
   if(label===0xff&&tag==="XMP DataXMP")drop=true;
  }
  if(!drop)parts.push(a.subarray(start,p));
 }
 if(!done||!count)throw Error("Incomplete GIF");
 return parts;
}
function flac(a){
 if(str(a,0,4)!=="fLaC")throw Error("Invalid FLAC signature");
 let p=4,end=false;const parts=[a.subarray(0,4)];
 for(let i=0;i<128;i++){
  if(p+4>a.length)throw Error("Truncated FLAC metadata");
  const start=p,head=a[p],type=head&127,n=(a[p+1]<<16)|(a[p+2]<<8)|a[p+3];
  p+=4;if(n>a.length-p)throw Error("Invalid FLAC block");
  p+=n;
  if(type!==4&&type!==6){const part=a.subarray(start,p).slice();part[0]&=127;parts.push(part);}
  if(head&128){end=true;break;}
 }
 if(!end||p>=a.length)throw Error("Incomplete FLAC stream");
 parts.push(a.subarray(p));return parts;
}
async function office(a,b,zipLib){
 if(!zipLib||typeof FileMetaZipGuard==="undefined")throw Error("ZIP validator unavailable");
 FileMetaZipGuard.preflight(a);FileMetaZipGuard.preflight(b);
 const [orig,clean]=await Promise.all([zipLib.loadAsync(a,{checkCRC32:true}),zipLib.loadAsync(b,{checkCRC32:true})]);
 const oldNames=Object.keys(orig.files).filter(n=>!orig.files[n].dir);
 const drop=n=>/^docProps\/(?:core|app|custom|thumbnail)\.(?:xml|jpeg|jpg|png)$/i.test(n);
 const expected=oldNames.filter(n=>!drop(n)).sort(),actual=Object.keys(clean.files).filter(n=>!clean.files[n].dir).sort();
 if(expected.join("\n")!==actual.join("\n"))throw Error("Office file entries changed unexpectedly");
 let checked=0;
 for(const name of expected){
  if(name==="_rels/.rels"||name==="[Content_Types].xml")continue; // expected XML edits
  const [before,after]=await Promise.all([orig.file(name).async("uint8array"),clean.file(name).async("uint8array")]);
  assertBytes(before,after,"Office entry "+name);checked++;
 }
 return {level:"byte-preserved-content",checks:["All other Office package entries matched byte-for-byte ("+checked+" entries)"],warnings:["Office root relationship and content-type XML was modified; document rendering and internal links were not independently rendered."]};
}
async function pdf(a,b,pdfLib){
 if(!pdfLib)throw Error("PDF parser unavailable");
 const [oldDoc,newDoc]=await Promise.all([pdfLib.PDFDocument.load(a,{updateMetadata:false}),pdfLib.PDFDocument.load(b,{updateMetadata:false})]);
 if(oldDoc.getPageCount()!==newDoc.getPageCount())throw Error("PDF page count changed");
 for(let i=0;i<oldDoc.getPageCount();i++){
  const x=oldDoc.getPage(i),y=newDoc.getPage(i);
  if(x.getWidth()!==y.getWidth()||x.getHeight()!==y.getHeight()||x.getRotation().angle!==y.getRotation().angle)
   throw Error("PDF page geometry changed at page "+(i+1));
 }
 return {level:"structural-only",checks:["PDF page count, dimensions and rotation preserved"],warnings:["PDF page rendering, text, attachments and graphical fidelity were not independently verified."]};
}
async function verify(before,after,format,{zipLib,pdfLib}={}){
 if(!(before instanceof Uint8Array)||!(after instanceof Uint8Array)||!before.length||!after.length)throw Error("Invalid verifier input");
 if(["docx","xlsx","pptx"].includes(format))return {...await office(before,after,zipLib),preserved:true};
 if(format==="pdf")return {...await pdf(before,after,pdfLib),preserved:true};
 let x,y,what;
 switch(format){
  case "jpeg":x=jpeg(before);y=jpeg(after);what="JPEG non-metadata segments and scans";break;
  case "png":x=png(before);y=png(after);what="PNG retained chunks including IDAT";break;
  case "webp":x=riff(before,"webp");y=riff(after,"webp");what="WebP retained chunks";break;
  case "wav":x=riff(before,"wav");y=riff(after,"wav");what="WAV retained chunks and samples";break;
  case "mp3":x=mp3(before);y=mp3(after);what="MP3 audio payload";break;
  case "gif":x=gif(before);y=gif(after);what="GIF frames and retained extensions";break;
  case "flac":x=flac(before);y=flac(after);what="FLAC audio and retained metadata";break;
  default:throw Error("No content preservation verifier for "+format);
 }
 compare(x,y,what);
 return {preserved:true,level:"byte-preserved-content",checks:[what+" match byte-for-byte"],warnings:["The retained binary content matched; decoder-level/rendering validity and invisible content watermarks were not independently assessed."]};
}
return {verify};
});
