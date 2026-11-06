const TYPES={LOAD:"LOAD",EXEC:"EXEC",WRITE_FILE:"WRITE_FILE",READ_FILE:"READ_FILE",DELETE_FILE:"DELETE_FILE",ERROR:"ERROR",LOG:"LOG",PROGRESS:"PROGRESS"};
let ffmpeg;
async function load(config){
  const first=!ffmpeg;
  let coreURL=config.coreURL;
  try{if(!coreURL)coreURL="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js";importScripts(coreURL);}
  catch{
    if(!coreURL)coreURL="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js";
    const module=await import(coreURL);
    self.createFFmpegCore=module.default;
    if(!self.createFFmpegCore)throw new Error("Failed to import FFmpeg core.");
  }
  const wasmURL=config.wasmURL||coreURL.replace(/\.js$/,".wasm");
  const workerURL=config.workerURL||coreURL.replace(/\.js$/,".worker.js");
  ffmpeg=await self.createFFmpegCore({mainScriptUrlOrBlob:coreURL+"#"+btoa(JSON.stringify({wasmURL,workerURL}))});
  ffmpeg.setLogger(data=>self.postMessage({type:TYPES.LOG,data}));
  ffmpeg.setProgress(data=>self.postMessage({type:TYPES.PROGRESS,data}));
  return first;
}
self.onmessage=async event=>{
  const {id,type,data}=event.data||{};
  let result,transfer=[];
  try{
    if(type!==TYPES.LOAD&&!ffmpeg)throw new Error("FFmpeg is not loaded.");
    switch(type){
      case TYPES.LOAD: result=await load(data||{});break;
      case TYPES.EXEC: ffmpeg.setTimeout(data.timeout??-1);ffmpeg.exec(...data.args);result=ffmpeg.ret;ffmpeg.reset();break;
      case TYPES.WRITE_FILE: ffmpeg.FS.writeFile(data.path,data.data);result=true;break;
      case TYPES.READ_FILE: result=ffmpeg.FS.readFile(data.path,{encoding:data.encoding});if(result instanceof Uint8Array)transfer.push(result.buffer);break;
      case TYPES.DELETE_FILE: ffmpeg.FS.unlink(data.path);result=true;break;
      default: throw new Error("Unsupported FFmpeg worker message: "+type);
    }
    self.postMessage({id,type,data:result},transfer);
  }catch(error){self.postMessage({id,type:TYPES.ERROR,data:String(error?.message||error)});}
};
