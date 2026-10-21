import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {assertNodeVersion,findPowerShell,preflightWindowsStart,startWindows} from '../scripts/windows-start.mjs';
import {lanAddresses} from '../scripts/network-addresses.mjs';
import {loadLocalHTTPS} from '../scripts/local-https.mjs';

const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
const tlsError=code=>Object.assign(new Error(code),{code});
function fixture({env={},results=[{}],powerShell={path:'C:\\Power Shell!\\7\\pwsh.exe',version:'7.6.5'}}={}){
  const calls={load:[],find:[],run:[],imports:[]};let index=0;
  const options={root,env,nodeVersion:'20.0.0',execPath:process.execPath};
  const dependencies={
    addresses:()=>[{adapter:'Wi-Fi',ip:'192.168.2.4'},{adapter:'VPN',ip:'10.2.3.4'}],
    loadTLS:args=>{calls.load.push(args);const value=results[index++];if(value instanceof Error)throw value;return value;},
    findPowerShell:async args=>{calls.find.push(args);return powerShell;},
    runFile:async(...args)=>{calls.run.push(args);return {stdout:'prepared',stderr:''};},
    importServer:async url=>{calls.imports.push({url,execPath:process.execPath});}
  };
  return {options,dependencies,calls,run:()=>preflightWindowsStart(options,dependencies)};
}

test('Node 20+ se verifica antes de cualquier acceso TLS o dependencia externa',async()=>{
  for(const version of ['20.0.0','22.1.0','24.20.0'])assert.equal(assertNodeVersion(version),version);
  for(const version of ['19.9.0','18.20.0','garbage',''])assert.throws(()=>assertNodeVersion(version),error=>error.code==='NODE_UNSUPPORTED'&&/20/.test(error.message));
  const f=fixture();f.options.nodeVersion='18.20.0';
  await assert.rejects(f.run(),{code:'NODE_UNSUPPORTED'});assert.deepEqual(f.calls,{load:[],find:[],run:[],imports:[]});
});

test('TLS válido se reutiliza sin PowerShell ni regeneración y valida todas las IP del servidor',async()=>{
  const f=fixture({results:[{options:{opaque:true}}],powerShell:null}),result=await f.run();
  assert.equal(result.tls,'reused');assert.equal(result.execPath,process.execPath);assert.equal(result.powerShell,null);
  assert.deepEqual(f.calls.load,[{root,env:f.options.env,ips:['192.168.2.4','10.2.3.4']}]);
  assert.equal(f.calls.find.length,0);assert.equal(f.calls.run.length,0);
  assert.deepEqual(Object.keys(result).sort(),['execPath','nodeVersion','powerShell','tls'],'no certificate/key object is exposed by preflight');
});

test('HTTPS=0 explícito no consulta TLS, red ni PowerShell y no altera el entorno',async()=>{
  const env={HTTPS:'0',TLS_CERT_FILE:'not-read',TLS_KEY_FILE:'not-read'},f=fixture({env});
  f.dependencies.addresses=()=>assert.fail('explicit HTTP does not need certificate addresses');
  assert.equal((await f.run()).tls,'disabled');assert.equal(env.HTTPS,'0');
  assert.deepEqual(f.calls,{load:[],find:[],run:[],imports:[]});
});

test('PUBLIC_URL se valida como el origen del servidor antes de anunciar un --check correcto',async()=>{
  for(const env of [{PUBLIC_URL:'http://localhost:8788'},{PUBLIC_URL:'https://localhost/path'},{PUBLIC_URL:'https://user:secret@localhost'},{HTTPS:'0',PUBLIC_URL:'https://localhost:8787'}]){
    const f=fixture({env});await assert.rejects(f.run(),/PUBLIC_URL/);assert.equal(f.calls.find.length,0);assert.equal(f.calls.run.length,0);
  }
  const secure=fixture({env:{PUBLIC_URL:'https://localhost:8788'}});assert.equal((await secure.run()).tls,'reused');
  const plain=fixture({env:{HTTPS:'0',PUBLIC_URL:'http://localhost:8787'}});assert.equal((await plain.run()).tls,'disabled');
});

test('Certificados o CA explícitos inválidos nunca se regeneran, incluso ante errores renovables',async()=>{
  for(const env of [{TLS_CERT_FILE:'cert'},{TLS_KEY_FILE:'key'},{TLS_CERT_FILE:'cert',TLS_KEY_FILE:'key'},{TLS_CA_FILE:'ca'}]){
    const error=tlsError('TLS_FILES_MISSING'),f=fixture({env,results:[error]});
    await assert.rejects(f.run(),actual=>actual===error);assert.equal(f.calls.find.length,0);assert.equal(f.calls.run.length,0);
  }
});

test('EACCES/EPERM, CA vencida o inválida y claves erróneas fallan sin escribir ni pedir PowerShell',async()=>{
  for(const code of ['EACCES','EPERM','TLS_ACCESS_DENIED','TLS_CA_EXPIRED','TLS_CA_MISSING','TLS_CA_INVALID','TLS_CA_MISMATCH','TLS_KEY_MISMATCH','TLS_CONFIG_INVALID']){
    const error=tlsError(code),f=fixture({results:[error]});
    await assert.rejects(f.run(),actual=>actual===error);assert.equal(f.calls.run.length,0);assert.equal(f.calls.find.length,0);
  }
  const denied=Object.assign(tlsError('TLS_CERT_EXPIRED'),{cause:tlsError('EACCES')}),f=fixture({results:[denied]});
  await assert.rejects(f.run(),actual=>actual===denied);assert.equal(f.calls.find.length,0);
});

test('Sólo defaults ausentes, servidor vencido o SAN renovable preparan una vez y revalidan',async()=>{
  for(const first of [null,tlsError('TLS_FILES_MISSING'),tlsError('TLS_CERT_EXPIRED'),tlsError('TLS_SAN_MISMATCH')]){
    const env={HTTPS:'1'},f=fixture({env,results:[first,{options:{}}]}),result=await f.run();
    assert.equal(result.tls,'prepared');assert.equal(result.powerShell,f.calls.run[0][0]);assert.equal(f.calls.find.length,1);assert.equal(f.calls.run.length,1);assert.equal(f.calls.load.length,2);
    const [executable,args,options]=f.calls.run[0];assert.equal(executable,'C:\\Power Shell!\\7\\pwsh.exe');
    assert.deepEqual(args,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts','prepare-local-https.ps1')]);
    assert.equal(options.cwd,root);assert.equal(options.env,env);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
    assert.equal(env.HTTPS,'1');assert.equal(f.calls.load[1].env,env);assert.deepEqual(f.calls.load[1].ips,f.calls.load[0].ips);
  }
});

test('Sin PowerShell compatible se detiene antes de arrancar o degradar a HTTP',async()=>{
  const f=fixture({results:[null],powerShell:null});
  await assert.rejects(f.run(),error=>error.code==='POWERSHELL_REQUIRED'&&/7\.2/.test(error.message)&&/Windows PowerShell 5\.1/.test(error.message));
  assert.equal(f.calls.load.length,1);assert.equal(f.calls.run.length,0);assert.equal(f.options.env.HTTPS,undefined);
});

test('Fallo del preparador o TLS todavía inválido después nunca se acepta',async()=>{
  const f=fixture({results:[null]});f.dependencies.runFile=async()=>{throw new Error('script failed');};
  await assert.rejects(f.run(),{code:'TLS_PREPARATION_FAILED'});assert.equal(f.calls.load.length,1);
  const absent=fixture({results:[null,null]});await assert.rejects(absent.run(),{code:'TLS_REQUIRED'});
  const error=tlsError('TLS_ACCESS_DENIED'),invalid=fixture({results:[null,error]});await assert.rejects(invalid.run(),actual=>actual===error);
});

test('PowerShell se prueba realmente por versión; salta antiguos/fallos y conserva rutas con espacios y !',async()=>{
  const old='C:\\Old PS\\pwsh.exe',valid='C:\\Power Shell!\\7\\pwsh.exe',calls=[];
  const result=await findPowerShell({env:{Path:'"C:\\Old PS";"C:\\Power Shell!\\7"'},exists:file=>[old,valid].includes(file),
    runFile:async(file,args,options)=>{calls.push({file,args,options});return {stdout:file===old?'7.1.9\r\n':'7.2.0\r\n'};}});
  assert.deepEqual(result,{path:valid,version:'7.2.0'});assert.deepEqual(calls.map(call=>call.file),[old,valid]);
  for(const call of calls){assert.deepEqual(call.args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-Command']);assert.match(call.args[4],/\$PSVersionTable\.PSVersion/);assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.ok(call.options.timeout>0);}
});

test('Busca instalación estándar fuera del PATH, sin hardcodear cachés privadas ni aceptar powershell.exe 5.1',async()=>{
  const candidate='C:\\Program Files\\PowerShell\\7\\pwsh.exe',seen=[];
  const result=await findPowerShell({env:{PATH:'C:\\Windows\\System32',ProgramFiles:'C:\\Program Files'},exists:file=>{seen.push(file);return file===candidate;},runFile:async()=>({stdout:'7.6.5'})});
  assert.deepEqual(result,{path:candidate,version:'7.6.5'});assert.ok(seen.every(file=>!file.includes('.codex')&&!file.includes('powershell.exe')));
});

test('Respuestas falsas, versión vieja y procesos con error no pasan por una detección válida',async()=>{
  for(const stdout of ['5.1.19041.6456','7.1.9','not a version','7.2.0\nextra']){
    assert.equal(await findPowerShell({env:{PATH:'C:\\Only'},exists:()=>true,runFile:async()=>({stdout})}),null);
  }
  assert.equal(await findPowerShell({env:{PATH:'C:\\Only'},exists:()=>true,runFile:async()=>{throw new Error('not executable');}}),null);
});

test('El arranque fija HTTPS ante desaparición de certificados; HTTPS=0 y --check conservan su política',async t=>{
  const previous=process.env.HTTPS;
  t.after(()=>{if(previous===undefined)delete process.env.HTTPS;else process.env.HTTPS=previous;});
  delete process.env.HTTPS;
  const caller={},f=fixture({env:caller});f.options.root=path.join(os.tmpdir(),'waterduel-start-missing-'+randomUUID());
  let importedEnvironment,processMode;
  f.dependencies.importServer=async(_url,{env}={})=>{
    importedEnvironment=env;processMode=process.env.HTTPS;
    // Real server validator after a successful first read: these certificate paths do not exist.
    return loadLocalHTTPS({root:f.options.root,env:process.env,ips:['127.0.0.1']});
  };
  await assert.rejects(startWindows(f.options,f.dependencies),{code:'TLS_FILES_MISSING'});
  assert.equal(processMode,'1');assert.equal(importedEnvironment.HTTPS,'1');assert.equal(f.calls.load[0].env.HTTPS,'1');
  assert.deepEqual(caller,{},'the supplied environment remains owned by its caller');
  const plainCaller={HTTPS:'0'},plain=fixture({env:plainCaller});
  plain.dependencies.importServer=async(_url,{env})=>{
    assert.equal(env.HTTPS,'0');assert.equal(process.env.HTTPS,'0');
    assert.equal(loadLocalHTTPS({root:f.options.root,env:process.env}),null);
  };
  assert.equal((await startWindows(plain.options,plain.dependencies)).tls,'disabled');assert.deepEqual(plainCaller,{HTTPS:'0'});
  const checkCaller={},check=fixture({env:checkCaller});await startWindows({...check.options,check:true},check.dependencies);
  assert.equal(process.env.HTTPS,'0','--check must not change the running process mode');assert.deepEqual(checkCaller,{});assert.equal(check.calls.imports.length,0);
});

test('--check no importa servidor; el arranque normal importa una vez en el mismo Node',async t=>{
  const previous=process.env.HTTPS;t.after(()=>{if(previous===undefined)delete process.env.HTTPS;else process.env.HTTPS=previous;});
  const check=fixture();await startWindows({...check.options,check:true},check.dependencies);assert.equal(check.calls.imports.length,0);
  const normal=fixture();await startWindows(normal.options,normal.dependencies);assert.equal(normal.calls.imports.length,1);
  assert.equal(normal.calls.imports[0].url,new URL('../server.mjs',import.meta.url).href);assert.equal(normal.calls.imports[0].execPath,process.execPath);
  const invalid=fixture({results:[tlsError('TLS_ACCESS_DENIED')]});await assert.rejects(startWindows(invalid.options,invalid.dependencies));assert.equal(invalid.calls.imports.length,0);
});

test('CLI real --check con HTTPS=0 termina sin listeners ni importar server.mjs',async()=>{
  const script=fileURLToPath(new URL('../scripts/windows-start.mjs',import.meta.url));
  const {stdout,stderr}=await execute(process.execPath,[script,'--check'],{cwd:root,env:{...process.env,HTTPS:'0'},windowsHide:true,timeout:5000});
  assert.match(stdout,/Node\.js/);assert.match(stdout,/HTTP.*explícito/i);assert.doesNotMatch(stdout,/Local arena online|hostToken|PRIVATE KEY/);assert.equal(stderr,'');
  await assert.rejects(execute(process.execPath,[script,'--unknown'],{cwd:root,env:{...process.env,HTTPS:'0'},windowsHide:true,timeout:5000}),error=>error.code===1&&/Uso:/.test(error.stderr));
});

test('La lista LAN compartida conserva prioridad, alternativas y fallback histórico',()=>{
  const original=os.networkInterfaces;try{
    os.networkInterfaces=()=>({VPN:[{family:'IPv4',internal:false,address:'10.1.2.3'}],LAN:[{family:'IPv4',internal:false,address:'192.168.4.5'}],Other:[{family:'IPv6',internal:false,address:'::1'},{family:'IPv4',internal:false,address:'8.8.8.8'}],Loopback:[{family:'IPv4',internal:true,address:'127.0.0.1'}]});
    assert.deepEqual(lanAddresses().map(record=>record.ip),['192.168.4.5','10.1.2.3','8.8.8.8']);
    os.networkInterfaces=()=>({});assert.deepEqual(lanAddresses(),[{adapter:'Sólo esta máquina',ip:'127.0.0.1'}]);
  }finally{os.networkInterfaces=original;}
});
