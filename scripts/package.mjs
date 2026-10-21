// Reproducible ZIP32/STORE writer. Uses only Node's standard library and never
// includes the release directory, local sessions or credential/configuration files.
import {lstat,readdir,readFile,mkdir,writeFile,realpath,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const REQUIRED_FILES=['README.md','package.json','server.mjs','INICIAR_WINDOWS.bat','INICIAR_MAC_LINUX.sh'];
const ROOT_FILES=[...REQUIRED_FILES,'INICIAR_ANDROID_TERMUX.sh','output/blender/WaterDuel_Atelier.blend','output/blender/WaterDuel_Atelier_v2.blend','output/blender/WaterDuel_Atelier_v3.blend'];
const ROOT_DIRECTORIES=['public','vendor','docs','tests','benchmarks','scripts','audit','screenshots','tasks','blender'];
const EXCLUDED_DIRECTORIES=new Set(['release','node_modules','session','sessions','secrets','credentials']);
const ZIP_TIME=0,ZIP_DATE=0x0021; // 1980-01-01 00:00:00, independent of timezone and file mtime.
const utf8Order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  let n=value;for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;
});
function crc32(bytes){
  let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;
}
function excluded(name){
  const lower=name.toLowerCase();
  return name.startsWith('.')||EXCLUDED_DIRECTORIES.has(lower)||['thumbs.db','desktop.ini'].includes(lower)||
    /(?:^|\.)env(?:\.|$)/i.test(name)||/\.(?:key|pem|pfx|p12|secret)$/i.test(name)||
    /^(?:sessions?|tokens?|secrets?|credentials)(?:[._-].*)?\.(?:json|log|txt|sqlite|db)$/i.test(name);
}
function safeName(name){
  if(/[\u0000-\u001f\\]/.test(name)||name==='.'||name==='..')throw new Error(`Nombre de entrada no admitido: ${JSON.stringify(name)}`);
}
async function validateOutputPath(output,root){
  // root is already canonical. Its physical ancestors are trusted anchors; only
  // inspect the branch leading to output, without querying unrelated home paths.
  let anchor=root;
  while(true){
    const relative=path.relative(anchor,output);
    if(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative))break;
    const parent=path.dirname(anchor);
    if(parent===anchor){anchor=path.parse(output).root;break;}
    anchor=parent;
  }
  const parts=path.relative(anchor,output).split(path.sep);
  let current=anchor;
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);
    let stat;
    try{stat=await lstat(current);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(stat.isSymbolicLink()||path.relative(current,await realpath(current))!==''){
      throw new Error(`La salida no admite enlaces simbólicos: ${current}`);
    }
    if(i<parts.length-1&&!stat.isDirectory())throw new Error(`Ancestro de salida no es una carpeta: ${current}`);
    if(i===parts.length-1&&!stat.isFile())throw new Error(`La salida no es un archivo regular: ${current}`);
  }
}
async function collect(root){
  const files=[];
  async function visit(relative,required=false){
    const absolute=path.join(root,relative);
    let stat;
    try{stat=await lstat(absolute);}catch(error){if(error.code==='ENOENT'&&!required)return;throw error;}
    if(stat.isSymbolicLink())throw new Error(`No se empaquetan enlaces simbólicos: ${relative}`);
    if(stat.isDirectory()){
      for(const name of (await readdir(absolute)).sort(utf8Order)){
        safeName(name);if(!excluded(name))await visit(`${relative}/${name}`);
      }
    }else if(stat.isFile()){
      const data=await readFile(absolute);
      if(data.length>0xffffffff)throw new Error(`Archivo demasiado grande para ZIP32: ${relative}`);
      files.push({name:relative,data});
    }else throw new Error(`Tipo de archivo no admitido: ${relative}`);
  }
  for(const name of ROOT_FILES)await visit(name,REQUIRED_FILES.includes(name));
  for(const name of ROOT_DIRECTORIES)await visit(name,['public','vendor'].includes(name));
  return files.sort((a,b)=>utf8Order(a.name,b.name));
}
function encodeZip(files){
  if(files.length>65535)throw new Error('Demasiadas entradas para ZIP32');
  const local=[],central=[];let offset=0;
  for(const {name,data,directory=false} of files){
    const encoded=Buffer.from(name),crc=crc32(data);
    if(encoded.length>65535)throw new Error(`Ruta demasiado larga: ${name}`);
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);
    header.writeUInt16LE(0,8);header.writeUInt16LE(ZIP_TIME,10);header.writeUInt16LE(ZIP_DATE,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);
    header.writeUInt16LE(encoded.length,26);
    const record=Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE((3<<8)|20,4);record.writeUInt16LE(20,6);
    record.writeUInt16LE(0x0800,8);record.writeUInt16LE(0,10);record.writeUInt16LE(ZIP_TIME,12);record.writeUInt16LE(ZIP_DATE,14);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);
    record.writeUInt16LE(encoded.length,28);
    const mode=directory?0o040755:name.endsWith('.sh')?0o100755:0o100644;
    record.writeUInt32LE(((mode<<16)|(directory?0x10:0))>>>0,38);record.writeUInt32LE(offset,42);
    local.push(header,encoded,data);central.push(record,encoded);offset+=header.length+encoded.length+data.length;
    if(offset>0xffffffff)throw new Error('La entrega excede el tamaño de ZIP32');
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  if(offset+directory.length+22>0xffffffff)throw new Error('La entrega excede el tamaño de ZIP32');
  return Buffer.concat([...local,directory,end]);
}

export async function buildOfflineArchive({root=fileURLToPath(new URL('../',import.meta.url)),output}={}){
  root=await realpath(path.resolve(root));
  const metadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version))throw new Error('Versión de package.json no válida');
  output=path.resolve(root,output||`release/WaterDuel-${metadata.version}-offline.zip`);
  const relative=path.relative(root,output);
  if(relative===''||(!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative)&&relative.split(path.sep)[0]!=='release')){
    throw new Error('La salida debe estar en release/ o fuera de la carpeta fuente');
  }
  await validateOutputPath(output,root);
  const source=await collect(root);
  // The manifest lists every source file, using paths relative to WaterDuel/.
  // It intentionally does not hash itself: a self-referential SHA-256 is not meaningful.
  const manifest=Buffer.from(source.map(file=>`${sha256(file.data)}  ${file.name}\n`).join(''));
  const entries=[{name:'WaterDuel/',data:Buffer.alloc(0),directory:true},
    ...source.map(file=>({...file,name:`WaterDuel/${file.name}`})),{name:'WaterDuel/MANIFEST.sha256',data:manifest}]
    .sort((a,b)=>utf8Order(a.name,b.name));
  const archive=encodeZip(entries);
  await mkdir(path.dirname(output),{recursive:true});
  await validateOutputPath(output,root);
  // Replace the directory entry, rather than truncating an existing inode: an
  // output hard link must never modify a source file sharing that inode.
  const temporary=path.join(path.dirname(output),`.waterduel-package-${randomUUID()}.tmp`);
  try{
    await writeFile(temporary,archive,{flag:'wx'});
    await validateOutputPath(output,root);
    await rename(temporary,output);
  }finally{
    try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {output,files:source.length,bytes:archive.length,sha256:sha256(archive)};
}

async function main(){
  const options={};
  for(let i=2;i<process.argv.length;i++){
    const argument=process.argv[i];
    if(!['--root','--out'].includes(argument)||!process.argv[i+1])throw new Error('Uso: node scripts/package.mjs [--root carpeta] [--out salida.zip]');
    options[argument==='--root'?'root':'output']=process.argv[++i];
  }
  console.log(JSON.stringify(await buildOfflineArchive(options),null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(`Empaquetado: ${error.message}`);process.exitCode=1;});
}
