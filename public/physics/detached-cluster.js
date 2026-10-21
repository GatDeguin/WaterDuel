// A severed component is initially an inelastic rigid compound. Its original
// articulated pose is retained; welding removes relative kinetic energy while
// preserving total linear/angular momentum. Motion remains in the rig's XY
// plane with authored depth layers, rather than claiming a full 3D solver.
import {TABLE_TOP} from './dimensions.js';
import {nearFloorContactPoints} from './contact-points.js';
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const copy=value=>ArrayBuffer.isView(value)?value.slice():Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])):value;
const frozenPose=value=>ArrayBuffer.isView(value)||Array.isArray(value)?Object.freeze(Array.from(value,frozenPose)):value&&typeof value==='object'?Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,frozenPose(v)]))):value;
export class DetachedCluster{
  #contactSnapshot=null;
  constructor({id,joint,bodies,panels,vertices,velocity,dir,sourcePose,gravity=-9.81}){
    this.id=id;this.joint=joint;this.bodyNames=bodies.map(b=>b.name);this.sourcePose=frozenPose(sourcePose);this.gravity=gravity;
    this.mass=bodies.reduce((sum,b)=>sum+b.mass,0);
    this.x=bodies.reduce((sum,b)=>sum+b.mass*b.center.x,0)/this.mass;
    this.y=bodies.reduce((sum,b)=>sum+b.mass*b.center.y,0)/this.mass;
    this.initialCenter={x:this.x,y:this.y};this.angle=0;
    this.previous={x:this.x,y:this.y,angle:0};
    const samples=bodies.map(b=>({b,vx:dot(b.center.jx,velocity),vy:dot(b.center.jy,velocity),omega:dir*b.rotations.reduce((sum,i)=>sum+velocity[i],0)}));
    const px=samples.reduce((sum,s)=>sum+s.b.mass*s.vx,0),py=samples.reduce((sum,s)=>sum+s.b.mass*s.vy,0);
    this.vx=px/this.mass;this.vy=py/this.mass;
    this.inertia=samples.reduce((sum,{b})=>sum+b.inertia+b.mass*((b.center.x-this.x)**2+(b.center.y-this.y)**2),0);
    const angularMomentum=samples.reduce((sum,s)=>sum+s.b.inertia*s.omega+s.b.mass*((s.b.center.x-this.x)*(s.vy-this.vy)-(s.b.center.y-this.y)*(s.vx-this.vx)),0);
    this.omega=angularMomentum/this.inertia;
    this.birth={momentum:{x:px,y:py},angularMomentum,originalKineticEnergy:samples.reduce((sum,s)=>sum+.5*s.b.mass*(s.vx*s.vx+s.vy*s.vy)+.5*s.b.inertia*s.omega*s.omega,0),rigidKineticEnergy:.5*this.mass*(this.vx*this.vx+this.vy*this.vy)+.5*this.inertia*this.omega*this.omega};
    this.panels=copy(panels);this.vertices=vertices.map(p=>({x:p.x-this.x,y:p.y-this.y,z:p.z??0}));this.floorContacts=0;
  }
  transformAt(t=1){
    t=Math.max(0,Math.min(1,Number.isFinite(t)?t:1));
    const x=this.previous.x+(this.x-this.previous.x)*t,y=this.previous.y+(this.y-this.previous.y)*t,angle=this.previous.angle+(this.angle-this.previous.angle)*t;
    const c=Math.cos(angle),s=Math.sin(angle),o=this.initialCenter;
    if(angle===0&&x===o.x&&y===o.y)return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    return [c,s,0,0,-s,c,0,0,0,0,1,0,x-c*o.x+s*o.y,y-s*o.x-c*o.y,0,1];
  }
  transform(){return this.transformAt(1);}
  worldPointAt(point,t=1){const m=this.transformAt(t);return {x:m[0]*point.x+m[4]*point.y+m[12],y:m[1]*point.x+m[5]*point.y+m[13],z:point.z??0};}
  #world(p){const c=Math.cos(this.angle),s=Math.sin(this.angle);return {x:this.x+c*p.x-s*p.y,y:this.y+s*p.x+c*p.y,z:p.z??0};}
  worldVertices(){return this.vertices.map(p=>this.#world(p));}
  collisionPanelsAt(t=1){
    const m=this.transformAt(t),c=m[0],s=m[1],transform=p=>({x:c*p.x-s*p.y+m[12],y:s*p.x+c*p.y+m[13]});
    return this.panels.map(p=>{const vertices=p.vertices.map(transform);return {...p,vertices,center:transform(p.center),axes:p.axes.map(a=>({x:c*a.x-s*a.y,y:s*a.x+c*a.y})),minX:Math.min(...vertices.map(v=>v.x)),maxX:Math.max(...vertices.map(v=>v.x)),minY:Math.min(...vertices.map(v=>v.y)),maxY:Math.max(...vertices.map(v=>v.y))};});
  }
  collisionPanels(){return this.collisionPanelsAt(1);}
  pointVelocity({point}={}){return point?{x:this.vx-this.omega*(point.y-this.y),y:this.vy+this.omega*(point.x-this.x)}:null;}
  effectiveInverseMass({point,normal}={}){if(!point||!normal)return 0;const lever=(point.x-this.x)*normal.y-(point.y-this.y)*normal.x;return 1/this.mass+lever*lever/this.inertia;}
  reactImpulse({point,impulse}={}){
    if(!point||!impulse||![point.x,point.y,impulse.x,impulse.y].every(Number.isFinite))return false;
    this.vx+=impulse.x/this.mass;this.vy+=impulse.y/this.mass;this.omega+=((point.x-this.x)*impulse.y-(point.y-this.y)*impulse.x)/this.inertia;return true;
  }
  projectContact({point,normal,penetration}={}){
    const inverseMass=this.effectiveInverseMass({point,normal});if(!(inverseMass>0)||!(penetration>0))return false;
    const lambda=Math.min(.035,penetration)/inverseMass,lever=(point.x-this.x)*normal.y-(point.y-this.y)*normal.x;
    this.x+=normal.x*lambda/this.mass;this.y+=normal.y*lambda/this.mass;this.angle+=lever*lambda/this.inertia;return true;
  }
  beginStep(){this.previous={x:this.x,y:this.y,angle:this.angle};}
  step(dt,{preservePrevious=false}={}){
    if(!Number.isFinite(dt)||dt<=0)return;
    if(!preservePrevious)this.beginStep();
    this.vy+=this.gravity*dt;this.x+=this.vx*dt;this.y+=this.vy*dt;this.angle+=this.omega*dt;
    this.resolveFloor();
  }
  resolveFloor(){
    // Resolve the currently lowest real corner. Rereading it after each impulse
    // handles a compound resting on multiple corners without a floor anchor.
    for(let i=0;i<8;i++){
      const points=this.worldVertices(),p=points.reduce((a,b)=>b.y<a.y?b:a);if(p.y>TABLE_TOP+1e-8)break;
      const penetration=TABLE_TOP-p.y;if(penetration>0){this.y+=penetration;p.y+=penetration;}
      const v=this.pointVelocity({point:p});if(v.y>=-1e-10)break;
      const normal={x:0,y:1},impulse=-v.y/this.effectiveInverseMass({point:p,normal});
      this.reactImpulse({point:p,impulse:{x:0,y:impulse}});
      const tangentSpeed=this.pointVelocity({point:p}).x,tangentMass=this.effectiveInverseMass({point:p,normal:{x:1,y:0}}),friction=Math.max(-.45*impulse,Math.min(.45*impulse,-tangentSpeed/tangentMass));
      this.reactImpulse({point:p,impulse:{x:friction,y:0}});this.floorContacts++;
    }
    const min=Math.min(...this.worldVertices().map(p=>p.y));if(min<TABLE_TOP)this.y+=TABLE_TOP-min;
  }
  snapshot(){
    const transform=this.transform();
    let cached=this.#contactSnapshot;
    let same=cached&&Object.is(cached.x,this.x)&&Object.is(cached.y,this.y)&&Object.is(cached.angle,this.angle)&&cached.coordinates.length===this.vertices.length*3;
    // Vertices are owned at construction but remain publicly mutable. Checking
    // their exact components preserves that contract without hashing geometry.
    if(same)for(let i=0;i<this.vertices.length;i++){
      const p=this.vertices[i],at=i*3;
      if(!Object.is(cached.coordinates[at],p.x)||!Object.is(cached.coordinates[at+1],p.y)||!Object.is(cached.coordinates[at+2],p.z)){same=false;break;}
    }
    if(!same){
      const coordinates=[];for(const p of this.vertices)coordinates.push(p.x,p.y,p.z);
      cached={x:this.x,y:this.y,angle:this.angle,coordinates,points:nearFloorContactPoints(this.worldVertices())};this.#contactSnapshot=cached;
    }
    return {id:this.id,joint:this.joint,bodies:this.bodyNames.slice(),transform,sourcePose:this.sourcePose,
      contactTransform:transform.slice(),contactVertices:cached.points.map(p=>({...p}))};
  }
}
