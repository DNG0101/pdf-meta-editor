'use strict';
importScripts('exiftool-bridge.js');
self.onmessage=async event=>{
 try{self.postMessage({result:await FileMetaExifTool.scanDirect(event.data.file)});}
 catch(error){self.postMessage({error:String(error?.message||error)});}
};
