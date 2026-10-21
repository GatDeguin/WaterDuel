import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,symlink,unlink,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const packager=fileURLToPath(new URL('../scripts/package.mjs',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Independent bit-at-a-time reader: it does not import the writer or its CRC table.
function crc32(bytes){
  let crc=0xffffffff;
  for(const value of bytes){
    crc^=value;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function readStoredZip(bytes){
  const end=bytes.length-22;
  assert.equal(bytes.readUInt32LE(end),0x06054b50);
  assert.equal(bytes.readUInt16LE(end+4),0);assert.equal(bytes.readUInt16LE(end+6),0);
  assert.equal(bytes.readUInt16LE(end+20),0);
  const count=bytes.readUInt16LE(end+10),directory=bytes.readUInt32LE(end+16);
  assert.equal(bytes.readUInt16LE(end+8),count);
  assert.equal(directory+bytes.readUInt32LE(end+12),end);
  const entries=new Map();let cursor=directory;
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(cursor),0x02014b50);
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10);
    const expectedCRC=bytes.readUInt32LE(cursor+16),size=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32);
    const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    const local=bytes.readUInt32LE(cursor+42);
    assert.equal(flags,0x0800);assert.equal(method,0);assert.equal(bytes.readUInt32LE(cursor+20),size);
    assert.equal(bytes.readUInt16LE(cursor+12),0);assert.equal(bytes.readUInt16LE(cursor+14),0x0021);
    assert.equal(bytes.readUInt32LE(local),0x04034b50);
    assert.equal(bytes.readUInt16LE(local+6),flags);assert.equal(bytes.readUInt16LE(local+8),0);
    assert.equal(bytes.readUInt16LE(local+10),0);assert.equal(bytes.readUInt16LE(local+12),0x0021);
    assert.equal(bytes.readUInt32LE(local+14),expectedCRC);assert.equal(bytes.readUInt32LE(local+18),size);
    assert.equal(bytes.readUInt32LE(local+22),size);
    const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28);
    assert.equal(bytes.subarray(local+30,local+30+localNameLength).toString('utf8'),name);
    const start=local+30+localNameLength+localExtra,data=bytes.subarray(start,start+size);
    assert.equal(data.length,size);assert.equal(crc32(data),expectedCRC,`${name}: CRC32`);
    assert.match(name,/^WaterDuel\//);assert.equal(name.includes('\\'),false);assert.equal(name.includes('../'),false);
    assert.equal(entries.has(name),false);entries.set(name,Buffer.from(data));
    cursor+=46+nameLength+extra+comment;
  }
  assert.equal(cursor,end);
  return entries;
}
async function fixture(t){
  const base=await mkdtemp(path.join(tmpdir(),'waterduel-package-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(base),path.resolve(tmpdir()));
    assert.ok(path.basename(base).startsWith('waterduel-package-test-'));
    await rm(base,{recursive:true,force:true});
  });
  const root=path.join(base,'source');
  const files={
    'package.json':JSON.stringify({name:'water-duel',version:'1.1.0',type:'module'}),
    'README.md':'Offline fixture\n','server.mjs':'console.log("offline");\n',
    'INICIAR_WINDOWS.bat':'@node server.mjs\r\n','INICIAR_MAC_LINUX.sh':'#!/bin/sh\nnode server.mjs\n',
    'INICIAR_ANDROID_TERMUX.sh':'#!/bin/sh\nnode server.mjs\n',
    'public/index.html':'<html lang="es">WaterDuel</html>','public/índice.txt':'muñeca ±45°\n',
    'vendor/qr/LICENSE.txt':'MIT\n','docs/fixture.md':'documented\n','tests/fixture.test.mjs':'// tests\n',
    'benchmarks/fluid.mjs':'// benchmark\n','scripts/package.mjs':'// bundled packager\n',
    'audit/fixture.md':'historical evidence\n','screenshots/pixel.bin':Buffer.from([0,255,4,16]),
    '.env':'HOST_TOKEN=private','sessions/current.json':'private-session',
    '.local/tls/ca.key':'private-ca-fixture','.local/tls/server.key':'private-server-fixture','.local/tls/ca.crt':'per-installation-public-ca-fixture',
    'public/session/current.json':'private-session','public/.env.local':'private-env',
    'docs/secret.key':'private-key','vendor/node_modules/private.txt':'excluded',
    'release/old.zip':'old archive','.git/config':'private remote','unrequested.txt':'outside allowlist'
  };
  for(const [name,data] of Object.entries(files)){
    const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);
  }
  return {root,base,files};
}
function pack(root,...extra){
  const result=spawnSync(process.execPath,[packager,'--root',root,...extra],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  return result;
}

test('El empaquetador real produce ZIP STORE ordenado, CRC válidos y manifiesto verificable sin secretos',async t=>{
  const {root,files}=await fixture(t);pack(root);
  const archive=await readFile(path.join(root,'release','WaterDuel-1.1.0-offline.zip'));
  const entries=readStoredZip(archive),names=[...entries.keys()];
  assert.deepEqual(names,names.slice().sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));
  assert.ok(entries.has('WaterDuel/'));assert.ok(entries.has('WaterDuel/MANIFEST.sha256'));
  const included=Object.keys(files).filter(name=>!['.env','sessions/current.json','public/session/current.json',
    'public/.env.local','.local/tls/ca.key','.local/tls/server.key','.local/tls/ca.crt','docs/secret.key','vendor/node_modules/private.txt','release/old.zip','.git/config','unrequested.txt'].includes(name));
  for(const name of included)assert.deepEqual(entries.get(`WaterDuel/${name}`),Buffer.from(files[name]));
  assert.equal(entries.size,included.length+2,'exactly the allowed files, folder and manifest');
  const manifest=entries.get('WaterDuel/MANIFEST.sha256').toString('utf8').trim().split('\n');
  assert.equal(manifest.length,included.length);
  for(const line of manifest){
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert.ok(match,line);
    assert.equal(hash(entries.get(`WaterDuel/${match[2]}`)),match[1],match[2]);
    assert.notEqual(match[2],'MANIFEST.sha256','the manifest cannot hash itself');
  }
});

test('El mismo contenido produce exactamente el mismo ZIP pese a fechas y una salida anterior',async t=>{
  const {root}=await fixture(t);pack(root);
  const output=path.join(root,'release','WaterDuel-1.1.0-offline.zip'),first=await readFile(output);
  for(const name of ['README.md','public/index.html','INICIAR_MAC_LINUX.sh'])await utimes(path.join(root,name),new Date('2031-04-17'),new Date('2031-04-17'));
  await writeFile(path.join(root,'release','another.zip'),Buffer.from('another generated output'));
  pack(root);assert.deepEqual(await readFile(output),first);
  await writeFile(path.join(root,'public','índice.txt'),'changed source\n');
  pack(root);assert.notEqual(hash(await readFile(output)),hash(first));
});

test('El empaquetado rechaza una salida que sobrescribiría un archivo del producto',async t=>{
  const {root}=await fixture(t),target=path.join(root,'server.mjs'),before=await readFile(target);
  const result=spawnSync(process.execPath,[packager,'--root',root,'--out',target],{encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);assert.deepEqual(await readFile(target),before);
  assert.match(result.stderr,/salida|output/i);
});

for(const destination of ['public','external'])test(`La salida rechaza un ancestro enlazado hacia ${destination} antes de escribir`,async t=>{
  const {root,base}=await fixture(t);
  const target=destination==='public'?path.join(root,'public'):path.join(base,'external');
  await mkdir(target,{recursive:true});
  const protectedFile=path.join(target,'index.html');
  if(destination==='external')await writeFile(protectedFile,'external source must remain intact\n');
  const before=await readFile(protectedFile),redirect=path.join(root,'release'),storedRelease=path.join(base,'stored-release');
  assert.equal(path.relative(base,redirect),path.join('source','release'));
  assert.equal(path.dirname(storedRelease),base);
  const previousBytes=Buffer.from('manipulated previous archive');await writeFile(path.join(redirect,'old.zip'),previousBytes);
  await rename(redirect,storedRelease);
  const previous=path.join(storedRelease,'old.zip');
  // Windows junctions do not require the administrator privilege of file symlinks.
  await symlink(target,redirect,process.platform==='win32'?'junction':'dir');
  const result=spawnSync(process.execPath,[packager,'--root',root,'--out',path.join(redirect,'index.html')],{encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0,'a lexical release/ path must not follow a link');
  assert.match(result.stderr,/salida.*enlaces simbólicos/i);
  assert.deepEqual(await readFile(protectedFile),before);
  assert.deepEqual(await readFile(previous),previousBytes);
  await unlink(redirect);
  await rename(storedRelease,redirect);
  pack(root);
  const entries=readStoredZip(await readFile(path.join(root,'release','WaterDuel-1.1.0-offline.zip')));
  assert.equal([...entries.keys()].some(name=>name.startsWith('WaterDuel/release/')),false);
  assert.deepEqual(entries.get('WaterDuel/public/index.html'),Buffer.from('<html lang="es">WaterDuel</html>'));
});

test('La salida rechaza un enlace en el destino final',async t=>{
  const {root}=await fixture(t),target=path.join(root,'public','index.html');
  const before=await readFile(target),output=path.join(root,'release','linked.zip');
  // On Windows, a final-component junction exercises the same lstat link check.
  await symlink(process.platform==='win32'?path.dirname(target):target,output,process.platform==='win32'?'junction':'file');
  const result=spawnSync(process.execPath,[packager,'--root',root,'--out',output],{encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/salida.*enlaces simbólicos/i);
  assert.equal(hash(await readFile(target)),hash(before));
});

test('Reemplazar una salida con enlace duro no modifica el archivo fuente compartido',async t=>{
  const {root}=await fixture(t),target=path.join(root,'server.mjs'),before=await readFile(target);
  const output=path.join(root,'release','hard-linked.zip');await link(target,output);
  pack(root,'--out',output);
  assert.equal(hash(await readFile(target)),hash(before));
  assert.ok(readStoredZip(await readFile(output)).has('WaterDuel/server.mjs'));
});
