/** Small LAN invitations; menus and controls remain on the phones. */
export function sessionQrData(session,{now=Date.now(),serverOffset=0}={}){
  try{
    if(!session||typeof session!=='object'||!Number.isFinite(now)||!Number.isFinite(serverOffset)||
      !/^[A-F0-9]{10}$/.test(session.id)||!Number.isFinite(session.serverTime)||!Number.isFinite(session.expiresAt)||
      session.expiresAt<=session.serverTime||session.expiresAt<=now+serverOffset)return [];
    const base=new URL(session.baseURL);
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)return [];
    const keys=[];
    for(const slot of [1,2]){
      const link=new URL(session.links?.[slot]);
      if(link.origin!==base.origin||link.username||link.password||link.pathname!=='/controller.html'||link.hash||
        link.searchParams.size!==2||link.searchParams.get('slot')!==String(slot)||
        !/^[a-f0-9]{36}$/.test(link.searchParams.get('key')??''))return [];
      keys.push(link.searchParams.get('key'));
    }
    if(keys[0]===keys[1])return [];
    // The local server encodes the current invitation, with a four-module quiet
    // zone. Neither credential is assigned to an HTML attribute or console.
    return [1,2].map(slot=>({slot,deadline:session.expiresAt-serverOffset,
      src:`/qr/${slot}.svg?${new URLSearchParams({base:session.baseURL,v:session.id})}`}));
  }catch{return [];}
}

export class HostQRCodes{
  constructor(root,{now=Date.now,setTimer=(callback,delay)=>globalThis.setTimeout(callback,delay),
    clearTimer=id=>globalThis.clearTimeout(id),onExpired=()=>{}}={}){
    this.root=root;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.onExpired=onExpired;
    this.timer=null;this.generation=0;this.deadline=0;
    this.codes=[1,2].map(slot=>({card:root?.querySelector(`[data-slot="${slot}"]`),image:root?.querySelector(`img[data-slot="${slot}"]`)}));
    this.hide();
  }
  hide(){
    this.generation++;this.deadline=0;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;
    if(this.root)this.root.hidden=true;
    for(const {card,image} of this.codes){if(card)card.hidden=true;if(image){image.onload=null;image.onerror=null;image.removeAttribute('src');}}
  }
  setSession(session,serverOffset=0){
    this.hide();const data=sessionQrData(session,{now:this.now(),serverOffset});
    if(data.length!==2||!this.root||this.codes.some(code=>!code.card||!code.image))return false;
    const generation=this.generation;this.deadline=data[0].deadline;
    for(const [index,{card,image}] of this.codes.entries()){
      const {src}=data[index];
      image.onload=()=>{
        if(this.generation!==generation||image.getAttribute('src')!==src||this.now()>=this.deadline)return;
        card.hidden=false;this.root.hidden=false;
      };
      image.onerror=()=>{
        if(this.generation!==generation)return;card.hidden=true;
        this.root.hidden=this.codes.every(code=>code.card.hidden);
      };
      image.setAttribute('src',src);
    }
    const expire=()=>{
      if(this.generation!==generation)return;
      const remaining=this.deadline-this.now();
      if(remaining>0){this.timer=this.setTimer(expire,Math.min(remaining,2_147_483_647));return;}
      this.hide();this.onExpired();
    };
    this.timer=this.setTimer(expire,Math.min(this.deadline-this.now(),2_147_483_647));return true;
  }
}
