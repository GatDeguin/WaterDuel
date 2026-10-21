import {characterTransforms} from './asset-rig.js';
import {getWeapon,getDefense} from '../equipment.js';

// These are the physical endpoints read by characterTransforms, its equipment
// orientation and the apron parent frame. Damage, fragment movement and material
// colours do not change the frozen source matrices; they are applied afterwards.
const POINTS=Object.freeze(['hip','mainShoulder','offShoulder','mainElbow','offElbow','mainHand','offHand','tip',
  'frontHip','backHip','kneeF','kneeB','footF','footB','shoulder','head']);

function pointKey(key,point,optional=false){
  if(point==null&&optional){key.push(null);return true;}
  const array=Array.isArray(point)||ArrayBuffer.isView(point);
  if(array&&point.length!==3)return false;
  const x=array?point[0]:point?.x,y=array?point[1]:point?.y,z=array?point[2]:point?.z??0;
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return false;
  key.push(x,y,z);return true;
}

function sourceKey(prepared,fighter){
  const pose=fighter.pose;
  // Unlike the other endpoints, head/neck also read head.x/head.y directly.
  // Exotic arrays with extra named properties are intentionally left uncached.
  if(Array.isArray(pose.head)||ArrayBuffer.isView(pose.head))return null;
  const key=[fighter.dir,fighter.boss,fighter.balloonSize,getWeapon(fighter).id,getDefense(fighter).id,
    pose.twoHanded,prepared.source.authoredScale,prepared.apronVariant];
  for(const name of POINTS)if(!pointKey(key,pose[name]))return null;
  if(!pointKey(key,pose.defenseTip,true))return null;
  // Head/neck use .z ?? .025, unlike vector()'s .z ?? 0. Preserve the raw
  // optional value as well as the endpoint so their defaults cannot alias.
  key.push(pose.head.z,pose.apron?.variant,pose.apron?.angle);
  const matrix=pose.apron?.canonicalMatrix;
  if(matrix==null)key.push(null);
  else{
    if(matrix.length!==16)return null;
    for(let i=0;i<16;i++){if(!Number.isFinite(matrix[i]))return null;key.push(matrix[i]);}
  }
  for(const value of key){const type=typeof value;if(value!==null&&(type==='object'||type==='function'||type==='symbol'||type==='bigint'))return null;}
  return key;
}

function same(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false;return true;}

/** Renderer-owned memoization, never a pose interning pool. Keys own only scalar
 * values; no live, interpolated or replay sourcePose is retained or shared.
 * Assets are weakly owned and each asset retains at most maxEntries records.
 * Returned matrices are borrowed read-only, just like the live assetPoseCache;
 * detachedCharacterTransforms allocates the moving fragment matrices separately.
 */
export class DetachedPoseMatrixCache{
  #entries=new WeakMap();
  #maxEntries;
  constructor({maxEntries=24}={}){
    if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>128)throw new RangeError('maxEntries must be an integer from 1 to 128');
    this.#maxEntries=maxEntries;
  }
  get maxEntries(){return this.#maxEntries;}
  clear(){this.#entries=new WeakMap();}
  get(entry,fighter,fragment){
    const prepared=entry.prepared,key=sourceKey(prepared,fighter);
    // Unusual external data keeps the original uncached path. In particular,
    // do not retain object-valued fragment IDs or incomplete endpoint objects.
    if(!key||!['number','string'].includes(typeof fragment.id)||!['number','string'].includes(typeof fighter.slot))return characterTransforms(prepared,fighter);
    let records=this.#entries.get(entry);
    if(!records){records=[];this.#entries.set(entry,records);}
    const index=records.findIndex(record=>Object.is(record.slot,fighter.slot)&&Object.is(record.id,fragment.id));
    if(index>=0){
      const record=records[index];
      if(record.prepared===prepared&&same(record.key,key)){
        if(index!==records.length-1){records.splice(index,1);records.push(record);}
        return record.matrices;
      }
      records.splice(index,1);
    }
    const matrices=characterTransforms(prepared,fighter);
    records.push({slot:fighter.slot,id:fragment.id,prepared,key,matrices});
    if(records.length>this.#maxEntries)records.shift();
    return matrices;
  }
}
