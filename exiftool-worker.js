'use strict';
// Zeroperl 1.0.10 chooses fetch only when both window and document exist.
// Its loader does not use DOM methods. This worker-only compatibility shim
// selects its browser fetch path instead of the unsupported node:fs branch.
// No real DOM is exposed; file bytes still stay in this isolated worker.
self.window=self;
self.document=Object.freeze({});
importScripts('exiftool-bridge.js');
self.onmessage=async event=>{
 try{self.postMessage({result:await FileMetaExifTool.scanDirect(event.data.file)});}
 catch(error){self.postMessage({error:String(error?.message||error)});}
};
