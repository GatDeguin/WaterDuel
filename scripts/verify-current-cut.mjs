import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),out=path.resolve(process.argv[2]??`audit/corte-${new Date().toISOString().replace(/[:.]/g,'-')}`);
// A new output directory preserves failed receipts and keeps extracted trees
// untouched when the caller explicitly selects an external verification path.
await mkdir(out);
async function walk(folder){
  const files=[];for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    const name=path.posix.join(folder,entry.name);
    if(entry.isDirectory())files.push(...await walk(name));else if(entry.isFile())files.push(name);
  }return files.sort();
}
async function hashes(){
  // Equivalence tests execute historical oracle modules and captured clouds too.
  // Hash those dependencies while leaving changing TAP/report prose outside
  // the source cut. The receipt lists every included path explicitly.
  const code=(await walk('audit')).filter(name=>/\.(?:js|mjs)(?:\.txt)?$/.test(name));
  const names=['server.mjs','package.json','INICIAR_WINDOWS.bat','INICIAR_MAC_LINUX.sh','INICIAR_ANDROID_TERMUX.sh',...(await Promise.all(['public','tests','scripts','vendor','benchmarks'].map(walk))).flat(),...code].sort(),result={};
  for(const name of names)result[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
  return result;
}
const before=await hashes(),started=new Date().toISOString(),files=(await walk('tests')).filter(name=>name.endsWith('.test.mjs'));
const args=['--test','--test-concurrency=2','--test-reporter=tap',...files],logPath=path.join(out,'tests.tap'),log=createWriteStream(logPath,{flags:'wx'});
console.log(`Verificando ${files.length} archivos; salida ${logPath}`);
const child=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
await new Promise(resolve=>log.end(resolve));
const after=await hashes(),changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(name=>before[name]!==after[name]);
const output=await readFile(logPath,'utf8'),counts={};
for(const key of ['tests','suites','pass','fail','cancelled','skipped','todo','duration_ms']){
  const matches=[...output.matchAll(new RegExp(`^# ${key} ([0-9.]+)$`,'gm'))];counts[key]=matches.length?Number(matches.at(-1)[1]):null;
}
const receipt={started,finished:new Date().toISOString(),node:process.version,root,command:[process.execPath,...args],exitCode,counts,
  sourceStable:changed.length===0,changed,sourceHashes:after,scope:'Complete Node test suite; hashes include product, tests, scripts, vendor, benchmarks and executable audit oracle/probe modules. Not GPU/FPS, handset or visual acceptance.'};
await writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({exitCode,counts,sourceStable:receipt.sourceStable,changed,out}));
process.exitCode=exitCode||changed.length?1:0;
