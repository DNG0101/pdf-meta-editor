/* ZIP safety preflight: inspect central-directory sizes before decompressing.
   This is a resource guard, not a full proof that a ZIP is benign. */
(function(root,factory){const x=factory();if(typeof module==="object"&&module.exports)module.exports=x;root.FileMetaZipGuard=x;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const le16=(a,p)=>a[p]|(a[p+1]<<8);
const le32=(a,p)=>((a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0);
function preflight(a,limits={}){
 const maxEntries=limits.maxEntries||2500,maxExpanded=limits.maxExpanded||256*1048576,maxEntry=limits.maxEntry||128*1048576,maxRatio=limits.maxRatio||150;
 if(!(a instanceof Uint8Array)||a.length<22)throw Error("Missing ZIP central directory");
 let eocd=-1;
 for(let p=a.length-22;p>=Math.max(0,a.length-65557);p--){
  if(le32(a,p)===0x06054b50&&p+22+le16(a,p+20)===a.length){eocd=p;break;}
 }
 if(eocd<0)throw Error("Missing ZIP EOCD or unrecognized trailing bytes");
 if(le16(a,eocd+4)||le16(a,eocd+6))throw Error("Multi-disk ZIP unsupported");
 const count=le16(a,eocd+10),onDisk=le16(a,eocd+8),size=le32(a,eocd+12),start=le32(a,eocd+16);
 if(count===65535||size===0xffffffff||start===0xffffffff)throw Error("ZIP64 unsupported in browser sanitizer");
 if(count!==onDisk||count>maxEntries)throw Error("Invalid ZIP entry count or count exceeds safety budget");
 if(start>eocd||size>eocd-start)throw Error("Invalid ZIP directory bounds");
 const names=new Set();let p=start,total=0;
 for(let i=0;i<count;i++){
  if(p+46>eocd||le32(a,p)!==0x02014b50)throw Error("Invalid ZIP central directory entry");
  const flags=le16(a,p+8),method=le16(a,p+10),packed=le32(a,p+20),expanded=le32(a,p+24);
  const nlen=le16(a,p+28),extra=le16(a,p+30),comment=le16(a,p+32),local=le32(a,p+42);
  if((flags&0x41)!==0)throw Error("Encrypted Office ZIP unsupported");
  if(method!==0&&method!==8)throw Error("Unsupported ZIP compression method");
  if([packed,expanded,local].some(v=>v===0xffffffff))throw Error("ZIP64 entry unsupported");
  if(nlen>1024||p+46+nlen+extra+comment>eocd)throw Error("ZIP entry length out of bounds");
  const name=new TextDecoder("utf-8").decode(a.subarray(p+46,p+46+nlen));
  if(!name||name.startsWith("/")||name.includes("\\")||name.includes("\0")||/^[A-Za-z]:/.test(name)||name.split("/").includes("..")||names.has(name))throw Error("Unsafe or duplicate ZIP entry path");
  names.add(name);
  if(local+30>a.length||le32(a,local)!==0x04034b50)throw Error("ZIP local file header invalid");
  if(expanded>maxEntry)throw Error("ZIP entry too large after decompression");
  if(expanded>0&&(packed===0||expanded/packed>maxRatio))throw Error("ZIP decompression ratio exceeds limit");
  total+=expanded;if(total>maxExpanded)throw Error("ZIP decompressed total exceeds safety budget");
  p+=46+nlen+extra+comment;
 }
 if(p!==start+size)throw Error("ZIP central directory size mismatch");
 return {entries:count,expandedBytes:total,compressedBytes:a.length};
}
return {preflight};
});
