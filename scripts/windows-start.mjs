import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadLocalHTTPS,canonicalPublicURL} from './local-https.mjs';
import {lanAddresses} from './network-addresses.mjs';

const execute=promisify(execFile);
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const RENEWABLE=new Set(['TLS_FILES_MISSING','TLS_CERT_EXPIRED','TLS_SAN_MISMATCH']);
const failure=(code,message,cause)=>Object.assign(new Error(message,cause?{cause}:undefined),{code});
const environmentValue=(env,name)=>env[Object.keys(env).find(key=>key.toUpperCase()===name.toUpperCase())]||'';

export function assertNodeVersion(version=process.versions.node){
  if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)||Number(version.split('.')[0])<20)
    throw failure('NODE_UNSUPPORTED','Se necesita Node.js 20 o superior. Instalá una versión compatible antes de iniciar WaterDuel.');
  return version;
}

function powerShellCandidates(env){
  const candidates=[];
  for(const entry of environmentValue(env,'PATH').split(';')){
    const directory=entry.trim().replace(/^"(.*)"$/,'$1');
    if(directory)candidates.push(path.win32.join(directory,'pwsh.exe'));
  }
  for(const name of ['ProgramW6432','ProgramFiles','ProgramFiles(x86)']){
    const directory=environmentValue(env,name);
    if(directory)candidates.push(path.win32.join(directory,'PowerShell','7','pwsh.exe'));
  }
  const local=environmentValue(env,'LOCALAPPDATA');
  if(local){
    candidates.push(path.win32.join(local,'Programs','PowerShell','7','pwsh.exe'));
    candidates.push(path.win32.join(local,'Microsoft','PowerShell','7','pwsh.exe'));
  }
  return candidates.filter((candidate,index)=>candidates.findIndex(other=>other.toLowerCase()===candidate.toLowerCase())===index);
}

export async function findPowerShell({env=process.env,exists=fs.existsSync,runFile=execute}={}){
  const command="if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion -lt [Version]'7.2') { exit 72 }; $PSVersionTable.PSVersion.ToString()";
  for(const candidate of powerShellCandidates(env)){
    if(!exists(candidate))continue;
    try{
      const {stdout}=await runFile(candidate,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
        {env,shell:false,windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:65536});
      const version=String(stdout).trim(),match=/^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(version);
      if(match&&(Number(match[1])>7||Number(match[1])===7&&Number(match[2])>=2))return {path:candidate,version};
    }catch{/* An old, inaccessible or non-executable candidate is not a usable PowerShell. */}
  }
  return null;
}

function accessDenied(error){
  const seen=new Set();
  while(error&&!seen.has(error)){
    seen.add(error);
    if(['EACCES','EPERM','TLS_ACCESS_DENIED'].includes(error.code))return true;
    error=error.cause;
  }
  return false;
}

export async function preflightWindowsStart({root=ROOT,env=process.env,nodeVersion=process.versions.node,execPath=process.execPath}={},dependencies={}){
  assertNodeVersion(nodeVersion);
  const result={execPath,nodeVersion,tls:'disabled',powerShell:null};
  if(env.PUBLIC_URL)canonicalPublicURL(env.PUBLIC_URL,env.HTTPS!=='0');
  if(env.HTTPS==='0')return result;
  const loadTLS=dependencies.loadTLS||loadLocalHTTPS;
  const ips=(dependencies.addresses||lanAddresses)().map(record=>record.ip);
  const options={root,env,ips};
  const explicit=!!(env.TLS_CERT_FILE||env.TLS_KEY_FILE||env.TLS_CA_FILE);
  try{
    if(loadTLS(options))return {...result,tls:'reused'};
    if(explicit)throw failure('TLS_REQUIRED','La configuración TLS explícita no produjo un HTTPS válido.');
  }catch(error){
    if(explicit||accessDenied(error)||!RENEWABLE.has(error.code))throw error;
  }
  const powerShell=await (dependencies.findPowerShell||findPowerShell)({env});
  if(!powerShell)throw failure('POWERSHELL_REQUIRED','No se encontró PowerShell 7.2+ (pwsh.exe) para preparar TLS local. Windows PowerShell 5.1 no es compatible. Instalá PowerShell 7.2+ o configurá certificados TLS válidos. No se cambió la confianza del sistema.');
  try{
    await (dependencies.runFile||execute)(powerShell.path,
      ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts','prepare-local-https.ps1')],
      {cwd:root,env,shell:false,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:65536});
  }catch(error){
    throw failure('TLS_PREPARATION_FAILED','No se pudieron preparar los archivos TLS locales. No se cambió la confianza del sistema; revisá los permisos y la ejecución de scripts de PowerShell.',error);
  }
  if(!loadTLS(options))throw failure('TLS_REQUIRED','La preparación no produjo un HTTPS válido. No se iniciará la arena sin TLS.');
  return {...result,tls:'prepared',powerShell:powerShell.path};
}

export async function startWindows({check=false,...options}={},dependencies={}){
  const sourceEnvironment=options.env||process.env;
  const env={...sourceEnvironment,HTTPS:sourceEnvironment.HTTPS==='0'?'0':'1'};
  const result=await preflightWindowsStart({...options,env},dependencies);
  if(!check){
    // The server validates TLS again. Missing files at that boundary must stay fatal.
    process.env.HTTPS=env.HTTPS;
    await (dependencies.importServer||(url=>import(url)))(pathToFileURL(path.join(options.root||ROOT,'server.mjs')).href,{env});
  }
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length>1||args.some(arg=>arg!=='--check'))throw new Error('Uso: node scripts/windows-start.mjs [--check]');
    const result=await startWindows({check:args.includes('--check')});
    if(args.includes('--check')){
      console.log(`Node.js ${result.nodeVersion} · ${result.execPath}`);
      console.log(result.tls==='disabled'?'HTTP explícito (HTTPS=0).':result.tls==='reused'?'TLS existente validado; no se regeneraron certificados.':'TLS local preparado y validado; confianza del sistema sin cambios.');
      console.log('Comprobación terminada sin iniciar el servidor.');
    }
  }catch(error){console.error('No se inicia WaterDuel: '+error.message);process.exitCode=1;}
}
