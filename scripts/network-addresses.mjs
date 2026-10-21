import os from 'node:os';

export function lanAddresses() {
  const records=[];
  for(const [adapter,entries] of Object.entries(os.networkInterfaces())){
    for(const net of entries||[]){
      if(net.family==='IPv4' && !net.internal){
        records.push({adapter,ip:net.address});
      }
    }
  }
  // Prefer private home-WiFi IPs, without hiding alternate interfaces or VPNs.
  const priority=ip=>ip.startsWith('192.168.')?0:/^10\./.test(ip)?1:/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)?2:3;
  records.sort((a,b)=>priority(a.ip)-priority(b.ip) || a.adapter.localeCompare(b.adapter));
  if(!records.length)records.push({adapter:'Sólo esta máquina',ip:'127.0.0.1'});
  return records;
}
