import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn as spawnProcess} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const envValue=(env,name)=>env[Object.keys(env).find(key=>key.toLowerCase()===name.toLowerCase())]||'';
const fileExists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};

export async function findChrome({platform=process.platform,env=process.env,exists=fileExists,runFile=execute}={}){
  if(platform!=='win32')return null;
  const candidates=[];
  for(const name of ['ProgramW6432','ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA']){
    const root=envValue(env,name);if(root)candidates.push(path.win32.join(root,'Google','Chrome','Application','chrome.exe'));
  }
  for(const root of envValue(env,'PATH').split(';'))if(root.trim())candidates.push(path.win32.join(root.trim().replace(/^"(.*)"$/,'$1'),'chrome.exe'));
  for(const candidate of new Set(candidates))if(exists(candidate))return candidate;
  for(const hive of ['HKCU','HKLM'])for(const view of ['64','32']){
    try{
      const {stdout}=await runFile('reg.exe',['query',hive+'\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe','/ve','/reg:'+view],{env,shell:false,windowsHide:true,encoding:'utf8',timeout:3000,maxBuffer:65536});
      const value=/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i.exec(String(stdout))?.[1];
      if(!value)continue;
      const candidate=value.trim().replace(/^"(.*)"$/,'$1').replace(/%([^%]+)%/g,(_match,name)=>envValue(env,name));
      if(path.win32.isAbsolute(candidate)&&/\\chrome\.exe$/i.test(candidate)&&exists(candidate))return candidate;
    }catch{/* Registry discovery is optional; the running arena remains usable. */}
  }
  return null;
}

export async function openArenaInChrome(url,{env=process.env,find=findChrome,spawn=spawnProcess}={}){
  const target=new URL(url);
  if(target.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.username||target.password)throw Error('Chrome sólo abre la arena local preparada.');
  const executable=await find({env});if(!executable)return {opened:false,reason:'not-found',url};
  try{
    const child=spawn(executable,['--new-window','--start-fullscreen',url],{env,shell:false,detached:true,stdio:'ignore',windowsHide:false});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
    return {opened:true,executable,url};
  }catch(error){return {opened:false,reason:'launch-failed',message:String(error.message),url};}
}
