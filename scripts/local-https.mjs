import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createPrivateKey,X509Certificate} from 'node:crypto';
import {createSecureContext} from 'node:tls';

const tlsError=(code,message)=>Object.assign(new Error(message),{code});
function fileExists(file){
  try{fs.statSync(file);return true;}
  catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return false;throw error;}
}
function validCertificate(bytes,authority=false){
  const certificate=new X509Certificate(bytes),now=Date.now();
  if(Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)
    throw tlsError(authority?'TLS_CA_EXPIRED':'TLS_CERT_EXPIRED','El certificado '+(authority?'de la autoridad local':'TLS')+' no está vigente.');
  return certificate;
}
export function certificateCovers(certificate,hostname){const name=hostname?.replace(/^\[|\]$/g,'');return !!(net.isIP(name)?certificate.checkIP(name):certificate.checkHost(name,{subject:'never'}));}
export function isLoopbackAddress(address){
  if(address==='::1')return true;
  const ip=typeof address==='string'?address.replace(/^::ffff:/i,''):'';
  return net.isIP(ip)===4&&ip.split('.')[0]==='127';
}
export function needsHTTPS(request,tlsEnabled){return !!tlsEnabled&&!request.socket?.encrypted&&!isLoopbackAddress(request.socket?.remoteAddress);}
export function canonicalPublicURL(value,secure){
  let url;try{url=new URL(value);}catch{throw Error('PUBLIC_URL debe ser una URL absoluta válida.');}
  if(url.protocol!==(secure?'https:':'http:')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw Error(secure?'PUBLIC_URL debe ser un origen HTTPS sin ruta ni credenciales.':'PUBLIC_URL debe ser un origen HTTP cuando HTTPS no está habilitado.');
  return url.origin;
}
export function loadLocalHTTPS({root,env=process.env,ips=[]}={}){
  if(env.HTTPS==='0')return null;
  const explicit=!!(env.TLS_CERT_FILE||env.TLS_KEY_FILE),folder=path.join(root,'.local','tls');
  if(explicit&&(!env.TLS_CERT_FILE||!env.TLS_KEY_FILE))throw tlsError('TLS_CONFIG_INVALID','TLS_CERT_FILE y TLS_KEY_FILE deben configurarse juntos.');
  const certFile=env.TLS_CERT_FILE||path.join(folder,'server.crt'),keyFile=env.TLS_KEY_FILE||path.join(folder,'server.key');
  const caFile=env.TLS_CA_FILE||(!explicit?path.join(folder,'ca.crt'):null);
  try{
    const hasCert=fileExists(certFile),hasKey=fileExists(keyFile);
    if(!hasCert&&!hasKey&&!explicit&&env.HTTPS!=='1'&&!env.TLS_CA_FILE&&!fileExists(path.join(folder,'ca.crt')))return null;
    if(!hasCert||!hasKey)throw tlsError('TLS_FILES_MISSING','Faltan archivos TLS. Prepará la CA y el certificado local o configurá ambas rutas TLS.');
    const cert=fs.readFileSync(certFile),key=fs.readFileSync(keyFile),certificate=validCertificate(cert);
    if(certificate.ca||!certificate.checkPrivateKey(createPrivateKey(key)))throw tlsError('TLS_KEY_MISMATCH','El certificado de servidor y su clave TLS no coinciden.');
    createSecureContext({cert,key,minVersion:'TLSv1.2'});
    const required=explicit?[env.PUBLIC_URL?new URL(env.PUBLIC_URL).hostname:ips[0]||'127.0.0.1']:['localhost','127.0.0.1',...ips];
    if(required.some(host=>!certificateCovers(certificate,host)))throw tlsError('TLS_SAN_MISMATCH','El certificado TLS no cubre la dirección anunciada. Volvé a preparar sus SAN.');
    let ca=null,caCertificate=null;
    if(caFile){
      if(!fileExists(caFile))throw tlsError('TLS_CA_MISSING','Falta el certificado público de la autoridad local.');
      caCertificate=validCertificate(fs.readFileSync(caFile),true);if(!caCertificate.ca)throw tlsError('TLS_CA_INVALID','TLS_CA_FILE debe ser un certificado de autoridad.');
      if(!explicit&&!certificate.verify(caCertificate.publicKey))throw tlsError('TLS_CA_MISMATCH','El certificado local no está firmado por su autoridad.');
      ca=Buffer.from(caCertificate.toString());
    }
    return {options:{cert,key,minVersion:'TLSv1.2'},certificate,ca,localAuthority:!explicit,caFingerprint:caCertificate?.fingerprint256??null};
  }catch(error){
    if(error.code==='EACCES'||error.code==='EPERM')throw tlsError('TLS_ACCESS_DENIED',
      'Sin permiso para leer los archivos TLS. Revisá el acceso del usuario que inicia WaterDuel a .local/tls o a las rutas TLS configuradas; las claves pueden haber sido creadas por otra cuenta.');
    if(error.code?.startsWith('TLS_'))throw error;
    throw tlsError('TLS_CONFIG_INVALID','No se pudo leer o validar la configuración TLS; no se iniciará un HTTPS aparente.');
  }
}
