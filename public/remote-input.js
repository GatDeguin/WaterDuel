import {neutral,clamp} from './engine.js';

export function isFreshRemoteInput(message,serverNow,maxAge=430){
  return [message.sentAt,message.t].every(at=>Number.isFinite(at)&&serverNow-at<=maxAge&&at-serverNow<=1000);
}

// Buttons are edges as well as levels: a release cannot erase an unconsumed tap.
export class RemoteInputBuffer{
  constructor(maxAge=430){this.maxAge=maxAge;this.slots=[null,null];}
  receive(slot,message,now,originAge=0){
    if((slot!==1&&slot!==2)||!Number.isSafeInteger(message.seq))return false;
    if(!Number.isFinite(originAge)||originAge>this.maxAge)return false;
    const at=now-Math.max(0,originAge);
    const old=this.slots[slot-1];
    if(old&&message.seq<=old.seq)return false;
    if(message.neutralize===true){
      this.slots[slot-1]={seq:message.seq,control:neutral(),at,pending:false,pendingAt:at};
      return true;
    }
    const control=neutral(),axes=message.axes||{};
    for(const key of ['offX','offY','mainX','mainY','lean','wrist']){
      control[key]=Number.isFinite(axes[key])?clamp(axes[key],-1,1):0;
    }
    for(const key of ['headX','headZ','bodyY'])if(Object.hasOwn(axes,key))control[key]=Number.isFinite(axes[key])?clamp(axes[key],-1,1):0;
    control.thrust=!!message.thrust;control.guard=!!message.guard;
    if(message.attackHeld===true)control.attackHeld=true;
    const pulse=control.thrust&&!old?.control.thrust;
    const pending=!!old?.pending&&now-old.pendingAt<=this.maxAge;
    this.slots[slot-1]={seq:message.seq,control,at,pending:pending||pulse,pendingAt:pending?old.pendingAt:at};
    return true;
  }
  sample(slot,now){
    const entry=this.slots[slot-1];
    if(!entry||now-entry.at>this.maxAge){if(entry)entry.pending=false;return null;}
    const control={...entry.control,thrust:entry.pending&&now-entry.pendingAt<=this.maxAge};
    entry.pending=false;
    return control;
  }
  disconnect(slot){if(slot===1||slot===2)this.slots[slot-1]=null;}
}
