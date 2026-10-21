// Pages serves the individual arena. The LAN server remains a separate launcher.
import {lstat,readdir,readFile,mkdir,copyFile,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const omitted=new Set(['qa','index.html','controller.html','entry.js']);
const lanInstructions='https://github.com/GatDeguin/WaterDuel#conectar-los-celulares';

async function regularDirectory(folder){
  try{
    const stat=await lstat(folder);
    if(stat.isSymbolicLink())throw Error(`Pages no admite enlaces: ${folder}`);
    if(!stat.isDirectory())throw Error(`Pages requiere una carpeta: ${folder}`);
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
async function publicFiles(folder,prefix=''){
  const files=[];
  for(const entry of await readdir(folder,{withFileTypes:true})){
    if(entry.name.startsWith('.')||(!prefix&&omitted.has(entry.name)))continue;
    const relative=prefix?`${prefix}/${entry.name}`:entry.name,absolute=path.join(folder,entry.name);
    if(entry.isSymbolicLink())throw Error(`Pages no admite enlaces: ${relative}`);
    if(entry.isDirectory())files.push(...await publicFiles(absolute,relative));
    else if(entry.isFile())files.push(relative);
    else throw Error(`Recurso de Pages no admitido: ${relative}`);
  }
  return files.sort();
}

export async function buildPages({root=projectRoot}={}){
  root=await realpath(root);
  const source=path.join(root,'public'),runtime=path.join(root,'.runtime'),output=path.join(runtime,'pages-site');
  await regularDirectory(source);await regularDirectory(runtime);await regularDirectory(output);
  const files=await publicFiles(source);
  const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const mobile=await readFile(path.join(source,'mobile.html'),'utf8');
  if(!mobile.includes('data-mobile-game="true"')||!mobile.includes('href="./?view=desktop"'))throw Error('La entrada móvil cambió; revisar el build de Pages.');
  const html=mobile.replace('href="./?view=desktop"',`href="${lanInstructions}" target="_blank" rel="noopener"`);
  if(html.includes('view=desktop'))throw Error('Pages no puede publicar enlaces a la entrada LAN.');
  // Only the dedicated, resolved output below this project's .runtime is removed.
  // Refuse linked ancestors before any recursive deletion.
  if(path.dirname(output)!==runtime||path.dirname(runtime)!==root)throw Error('Salida Pages fuera del proyecto.');
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  let bytes=0;
  for(const relative of files){
    const target=path.join(output,relative);
    await mkdir(path.dirname(target),{recursive:true});
    await copyFile(path.join(source,relative),target);
    bytes+=(await lstat(target)).size;
  }
  await writeFile(path.join(output,'mobile.html'),html);
  await writeFile(path.join(output,'index.html'),html);
  await writeFile(path.join(output,'.nojekyll'),'');
  bytes+=Buffer.byteLength(html)*2-Buffer.byteLength(mobile);
  const result={version,entry:'index.html',files:[...files,'index.html','.nojekyll'].sort(),bytes};
  await writeFile(path.join(output,'build-info.json'),JSON.stringify(result,null,2)+'\n');
  return {...result,output};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {output,version,files,bytes}=await buildPages();
  console.log(JSON.stringify({output,version,files:files.length,bytes}));
}
