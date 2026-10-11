/* Read-only metadata discovery for additional formats.
 * Does not sanitize or claim complete coverage. No external requests or rendering. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.FileMetaExtended=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const ascii=(a,p,n)=>Array.from(a.subarray(p,p+n),c=>String.fromCharCode(c)).join("");
const u16le=(a,p)=>a[p]|(a[p+1]<<8);
const u32le=(a,p)=>(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3])>>>0;
const i32le=(a,p)=>u32le(a,p)|0;
const u32be=(a,p)=>((a[p]*16777216)+(a[p+1]<<16)+(a[p+2]<<8)+a[p+3])>>>0;
const hex=(a,max=32)=>Array.from(a.subarray(0,max),x=>x.toString(16).padStart(2,"0")).join(" ")+(a.length>max?" …":"");
const decode=(a)=>new TextDecoder("utf-8",{fatal:false}).decode(a);
const int64=(a,p)=>{const h=u32be(a,p),l=u32be(a,p+4),n=h*4294967296+l;if(!Number.isSafeInteger(n))throw Error("Container size exceeds safe integer bounds");return n;};
function bmp(a,ctx){
 if(a.length<26||ascii(a,0,2)!=="BM")throw Error("Invalid BMP header");
 const sz=u32le(a,2),offset=u32le(a,10),dib=u32le(a,14);
 if(sz>a.length||offset>a.length||dib>4096||14+dib>a.length)throw Error("Damaged BMP file/DIB header");
 ctx.add("Declared file size",sz+" bytes","BMP header","technical");
 ctx.add("Pixel data offset",offset,"BMP header","technical");
 ctx.add("DIB header",dib+" bytes","BMP DIB","technical");
 if(dib===12){
  ctx.add("Width",u16le(a,18),"BMP DIB","technical");
  ctx.add("Height",u16le(a,20),"BMP DIB","technical");
  ctx.add("Bits per pixel",u16le(a,24),"BMP DIB","technical");
 }else if(dib>=40){
  ctx.add("Width",i32le(a,18),"BMP DIB","technical");
  ctx.add("Height",i32le(a,22),"BMP DIB","technical");
  ctx.add("Bits per pixel",u16le(a,28),"BMP DIB","technical");
  ctx.add("Compression method",u32le(a,30),"BMP DIB","technical");
  if(dib>=40){ctx.add("X pixels per metre",i32le(a,38),"BMP DIB","technical");ctx.add("Y pixels per metre",i32le(a,42),"BMP DIB","technical");}
  if(dib>=124){
   const mode=u32le(a,70),profile=u32le(a,126),length=u32le(a,130);
   ctx.add("Color space type","0x"+mode.toString(16),"BMP V5","technical");
   if(length)ctx.add("Embedded/linked color profile","Profile reference at DIB offset "+profile+" ("+length+" bytes)","BMP V5");
  }
 }
 ctx.warnings.push("BMP pixel data, embedded color profiles and application-specific trailing records are not fully decoded or cleaned.");
}
function svg(a,ctx){
 if(a.length>8*1048576){ctx.warnings.push("SVG metadata read limited to first 8 MiB");}
 const s=decode(a.subarray(0,Math.min(a.length,8*1048576)));
 const root=s.match(/<svg\b([^>]{0,65536})>/i);
 if(!root)throw Error("SVG root not found in supported inspection window");
 const attribs=root[1],matcher=/([:\w.-]+)\s*=\s*(["'])(.*?)\2/gs;
 let m,count=0;
 while((m=matcher.exec(attribs))!==null&&count++<250){
  ctx.add("SVG "+m[1],m[3],"SVG root attribute",["width","height","viewBox","version"].includes(m[1])?"technical":"metadata");
 }
 for(const tag of ["title","desc","metadata"]){
  const regex=new RegExp("<(?:[\\w.-]+:)?"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?"+tag+"\\s*>","gi");
  let index=0,match;
  while((match=regex.exec(s))&&index++<50)ctx.add("SVG "+tag+" "+index,match[1],"SVG XML "+tag);
  if(regex.lastIndex>0&&index>=50)ctx.warnings.push("SVG "+tag+" extraction limited to 50 nodes");
 }
 ctx.warnings.push("SVG parsed as inert text only: entities, nested semantics, namespaces, external resources and scripting are not resolved or sanitized.");
}
const qtNames={"©nam":"Title","©ART":"Artist","aART":"Album artist","©alb":"Album","©day":"Date","©too":"Encoder","©cmt":"Comment","©gen":"Genre","©wrt":"Composer","©cpy":"Copyright","©des":"Description","©xyz":"Location","desc":"Description","ldes":"Long description","name":"Name","auth":"Author","cprt":"Copyright","gnre":"Genre","trkn":"Track number","tmpo":"Tempo","cpil":"Compilation","covr":"Cover art","©lyr":"Lyrics"};
const isNested=new Set(["moov","udta","trak","mdia","minf","stbl","edts","dinf","meta","ilst","tref","moof","traf","iprp","ipco","meco","mere","sinf","schi"]);
function bmff(a,ctx,format){
 if(a.length<12||ascii(a,4,4)!=="ftyp")throw Error("Not a supported ISO BMFF header");
 let boxes=0,metadataBoxes=0,unparsed=new Map();
 const record=(type)=>unparsed.set(type,(unparsed.get(type)||0)+1);
 function atomText(start,end,key,source){
  if(end<=start)return;
  const bytes=a.subarray(start,Math.min(end,start+1048576));
  const val=decode(bytes).replace(/\0+$/,"").trim();
  if(val&&(!/[\x00-\x08\x0e-\x1f]/.test(val)))ctx.add(key,val,source);
  else ctx.add(key,"Binary data ("+(end-start)+" bytes), hex preview: "+hex(bytes),"BMFF "+source);
  if(end-start>1048576)ctx.warnings.push(key+" value exceeded 1 MiB read budget");
 }
 function walk(start,end,depth,parent="root"){
  if(depth>9){ctx.warnings.push("BMFF nesting depth limit reached at "+parent);return;}
  let p=start;
  while(p+8<=end){
   if(++boxes>15000)throw Error("BMFF atom count exceeds safety budget");
   let length=u32be(a,p),name=ascii(a,p+4,4),header=8;
   if(length===1){if(p+16>end)throw Error("Truncated extended BMFF atom");length=int64(a,p+8);header=16;}
   else if(length===0)length=end-p;
   if(length<header||length>end-p)throw Error("Invalid BMFF atom "+name+" size");
   const begin=p+header,stop=p+length;
   if(name==="ftyp"){
    if(stop-begin>=8){
     ctx.add("Major brand",ascii(a,begin,4),"BMFF ftyp","technical");
     ctx.add("Minor version",u32be(a,begin+4),"BMFF ftyp","technical");
     const brands=[];for(let i=begin+8;i+4<=stop&&brands.length<60;i+=4)brands.push(ascii(a,i,4));
     if(brands.length)ctx.add("Compatible brands",brands.join(", "),"BMFF ftyp","technical");
    }
   }else if(name==="mvhd"&&stop-begin>=20){
    const version=a[begin],off=version===1?20:12;
    if(stop-begin>=off+(version===1?12:8)){
     const epoch=version===1?int64(a,begin+4):u32be(a,begin+4);
     const date=new Date((epoch-2082844800)*1000);
     if(!isNaN(date.getTime()))ctx.add("Creation date",date.toISOString(),"BMFF mvhd");
     const scale=u32be(a,begin+off);
     const duration=version===1?int64(a,begin+off+4):u32be(a,begin+off+4);
     ctx.add("Time scale",scale,"BMFF mvhd","technical");
     if(scale)ctx.add("Movie duration",(duration/scale).toFixed(3)+" seconds","BMFF mvhd","technical");
    }
   }else if(name==="data"&&parent==="ilst-item"){
    if(stop-begin>=8){
     const valueType=u32be(a,begin)&0xffffff;
     const value=a.subarray(begin+8,stop);
     if(valueType===1||valueType===0)atomText(begin+8,stop,"Value","BMFF ilst data");
     else if(valueType===2&&value.length%2===0){
      let val="";try{val=new TextDecoder("utf-16be").decode(value);}catch{val="Unicode field (decoder unavailable)";}
      ctx.add("Value",val,"BMFF ilst data");
     }else ctx.add("Value","Binary metadata ("+value.length+" bytes, type "+valueType+")","BMFF ilst data");
    }
   }else if(parent==="ilst"&&length>header){
    const label=qtNames[name]||("Tag "+name);
    const first=boxes;
    let dataAt=begin,found=false;
    while(dataAt+8<=stop){
     const n=u32be(a,dataAt),type=ascii(a,dataAt+4,4);
     if(n<8||n>stop-dataAt)break;
     if(type==="data"&&n>=16){
      found=true;
      const dataType=u32be(a,dataAt+8)&0xffffff;
      const b=a.subarray(dataAt+16,dataAt+n);
      if(dataType===0||dataType===1){const v=decode(b).replace(/\0+$/,"");ctx.add(label,v,"BMFF ilst "+name);}
      else if(dataType===2){let v="UTF-16 field present";try{v=new TextDecoder("utf-16be").decode(b);}catch{}ctx.add(label,v,"BMFF ilst "+name);}
      else ctx.add(label,"Binary metadata, "+b.length+" bytes, type "+dataType,"BMFF ilst "+name);
     }
     dataAt+=n;
    }
    if(!found){ctx.add(label,"Metadata atom present ("+(length-header)+" bytes), not decoded","BMFF ilst "+name);}
    metadataBoxes++;
   }else if(isNested.has(name)){
    const shift=name==="meta"?(begin+4<=stop?4:0):0;
    walk(begin+shift,stop,depth+1,name);
   }else if(name==="©xyz"||name==="©nam"||name==="©ART"||name==="©cpy"||name==="©day"){
    atomText(begin,stop,qtNames[name]||name,name);metadataBoxes++;
   }else if(name==="mdat"){ctx.add("Media payload",length+" bytes","BMFF mdat","technical");}
   else if(name==="free"||name==="skip"){ctx.add("Padding "+name,length+" bytes","BMFF "+name,"technical");}
   else record(name);
   p=stop;
  }
  if(p!==end)ctx.warnings.push("BMFF trailing bytes detected under "+parent);
 }
 walk(0,a.length,0);
 ctx.add("Atom count",boxes,"BMFF structure","technical");
 ctx.add("Decoded metadata atoms",metadataBoxes,"BMFF structure","technical");
 if(unparsed.size){ctx.add("Unparsed atom types",Array.from(unparsed.entries()).slice(0,60).map(([k,n])=>k+" ("+n+")").join(", "),"BMFF structure","technical");ctx.warnings.push("The listed BMFF atoms were not decoded; metadata may exist in vendor-specific boxes.");}
 ctx.warnings.push("BMFF support is read-only. Track-level metadata, HEIF item graphs, embedded XMP and proprietary atoms may not be fully decoded.");
}
function ogg(a,ctx){
 if(a.length<27||ascii(a,0,4)!=="OggS")throw Error("Invalid Ogg signature");
 let p=0,pages=0,packets=0;const pending=[];let pendingLength=0,commentsSeen=false;
 while(p+27<=a.length&&pages<2000&&p<8*1048576){
  if(ascii(a,p,4)!=="OggS"||a[p+4]!==0)throw Error("Invalid Ogg page header");
  const segments=a[p+26],lacing=p+27;
  if(lacing+segments>a.length)throw Error("Truncated Ogg lacing");
  let payload=lacing+segments,compressedSize=0;
  for(let j=0;j<segments;j++)compressedSize+=a[lacing+j];
  if(payload+compressedSize>a.length)throw Error("Truncated Ogg data");
  if(pages===0)ctx.add("Stream serial",u32le(a,p+14),"Ogg page","technical");
  pages++;
  for(let j=0;j<segments;j++){
   const n=a[lacing+j];
   if(pendingLength<1024*1024){pending.push(a.subarray(payload,payload+n));pendingLength+=n;}
   payload+=n;
   if(n<255){
    packets++;
    if(packets<=10&&!commentsSeen){
     const packet=new Uint8Array(pendingLength);let k=0;for(const piece of pending){packet.set(piece,k);k+=piece.length;}
     let pos=-1,kind="";
     if(ascii(packet,0,8)==="OpusHead"){kind="Opus";if(packet.length>=12)ctx.add("Audio channels",packet[9],"OpusHead","technical");}
     if(ascii(packet,0,8)==="OpusTags"){kind="OpusTags";pos=8;}
     if(packet.length>=7&&packet[0]===3&&ascii(packet,1,6)==="vorbis"){kind="Vorbis comments";pos=7;}
     if(packet.length>=7&&packet[0]===1&&ascii(packet,1,6)==="vorbis"){kind="Vorbis";}
     if(kind)ctx.add("Codec header "+packets,kind,"Ogg packet","technical");
     if(pos>=0&&pos+8<=packet.length){
      const vendor=u32le(packet,pos);pos+=4;
      if(vendor<=packet.length-pos){
       ctx.add("Encoder",decode(packet.subarray(pos,pos+vendor)),kind);
       pos+=vendor;
       if(pos+4<=packet.length){
        const c=u32le(packet,pos);pos+=4;
        if(c>5000)throw Error("Ogg comments count exceeds safety budget");
        for(let i=0;i<c;i++){
         if(pos+4>packet.length)break;
         const n=u32le(packet,pos);pos+=4;
         if(n>packet.length-pos)break;
         const tag=decode(packet.subarray(pos,pos+n)),eq=tag.indexOf("=");
         if(eq>0)ctx.add(tag.slice(0,eq),tag.slice(eq+1),kind);
         pos+=n;
        }
        commentsSeen=true;
       }
      }
     }
    }
    pending.length=0;pendingLength=0;
   }
  }
  p=payload;
 }
 ctx.add("Scanned pages",pages,"Ogg structure","technical");
 if(p<a.length)ctx.warnings.push("Ogg scanning stopped at bounded page/byte limit; more metadata may follow.");
 if(!commentsSeen)ctx.warnings.push("No complete OpusTags/Vorbis comment packet found; metadata may span pages or use another codec.");
 ctx.warnings.push("Ogg support is read-only; stream checksum and packet encoding are not independently authenticated.");
}
function inspect(a,format,ctx){
 switch(format){
  case "bmp":bmp(a,ctx);break;
  case "svg":svg(a,ctx);break;
  case "ogg":ogg(a,ctx);break;
  case "mp4":case "mov":case "heic":case "avif":bmff(a,ctx,format);break;
  default:return false;
 }
 return true;
}
return {inspect};
});
