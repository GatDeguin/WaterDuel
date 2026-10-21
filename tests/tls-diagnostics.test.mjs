import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadLocalHTTPS} from '../scripts/local-https.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'waterduel-tls-diagnostic-'));
  t.after(async()=>{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('waterduel-tls-diagnostic-'));
    await rm(root,{recursive:true,force:true});
  });
  const folder=path.join(root,'.local','tls');await mkdir(folder,{recursive:true});
  return {root,folder};
}

for(const code of ['EACCES','EPERM'])test(`${code} al leer TLS explica el permiso sin exponer el error ni permitir regeneración`,async t=>{
  const {root,folder}=await fixture(t),certFile=path.join(folder,'server.crt');
  await writeFile(certFile,'unreadable certificate fixture');await writeFile(path.join(folder,'server.key'),'key fixture');
  const read=fs.readFileSync;
  t.mock.method(fs,'readFileSync',function(file,...args){
    if(file===certFile)throw Object.assign(new Error('PRIVATE KEY CONTENT MUST NOT BE REPEATED'),{code});
    return read.call(this,file,...args);
  });
  assert.throws(()=>loadLocalHTTPS({root,env:{HTTPS:'1'}}),error=>{
    assert.equal(error.code,'TLS_ACCESS_DENIED');assert.match(error.message,/permiso/i);
    assert.doesNotMatch(error.message,/PRIVATE KEY CONTENT/);return true;
  });
});

for(const code of ['EACCES','EPERM'])test(`${code} al consultar la ruta TLS tampoco se confunde con archivos ausentes`,async t=>{
  const {root,folder}=await fixture(t),certFile=path.join(folder,'server.crt'),stat=fs.statSync;
  await writeFile(certFile,'fixture');await writeFile(path.join(folder,'server.key'),'fixture');
  t.mock.method(fs,'statSync',function(file,...args){
    if(file===certFile)throw Object.assign(new Error('PRIVATE METADATA MUST NOT BE REPEATED'),{code});
    return stat.call(this,file,...args);
  });
  assert.throws(()=>loadLocalHTTPS({root,env:{HTTPS:'1'}}),error=>{
    assert.equal(error.code,'TLS_ACCESS_DENIED');assert.match(error.message,/permiso/i);
    assert.doesNotMatch(error.message,/PRIVATE METADATA/);return true;
  });
});

test('Archivos TLS ausentes tienen un diagnóstico distinto al permiso denegado',async t=>{
  const {root}=await fixture(t);
  assert.throws(()=>loadLocalHTTPS({root,env:{HTTPS:'1'}}),error=>{
    assert.equal(error.code,'TLS_FILES_MISSING');assert.match(error.message,/Faltan archivos TLS/);return true;
  });
});

test('Material TLS ilegible no filtra mensajes del parser ni se clasifica como renovación automática',async t=>{
  const {root,folder}=await fixture(t);
  await writeFile(path.join(folder,'server.crt'),'PRIVATE KEY CONTENT MUST NOT BE REPEATED');
  await writeFile(path.join(folder,'server.key'),'invalid fixture');
  assert.throws(()=>loadLocalHTTPS({root,env:{HTTPS:'1'}}),error=>{
    assert.equal(error.code,'TLS_CONFIG_INVALID');assert.match(error.message,/validar/);
    assert.doesNotMatch(error.message,/PRIVATE KEY CONTENT/);return true;
  });
});
