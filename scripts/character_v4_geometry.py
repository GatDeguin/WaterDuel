"""V4 authored construction, deterministic per-piece atlas, rigid ownership.

All edits happen on fresh v3 files. Bone matrices, sockets and protected
head/water geometry are never edited. Dimensions are authored metres.
"""
import bpy, bmesh, math, hashlib, json
from mathutils import Vector, Matrix

ATLAS_MATERIALS={'Beech_Wood_Grain':'wood','Endgrain_Joints':'endgrain','Satin_Brass':'brass','Recessed_Steel':'steel','Wrapped_Brown_Leather':'leather','Mint_Woven_Sash':'cloth','Boss_Burgundy_Woven_Cloth':'cloth'}
def attach(obj,name,mat,bone):
    rig=bpy.data.objects['WD_Mannequin_Rig'];col=bpy.data.collections['WaterDuel_Character']
    obj.name=name
    for c in list(obj.users_collection):c.objects.unlink(obj)
    col.objects.link(obj);obj.data.materials.clear();obj.data.materials.append(bpy.data.materials[mat])
    world=obj.matrix_world.copy();obj.parent=rig;obj.matrix_world=world
    for g in list(obj.vertex_groups):obj.vertex_groups.remove(g)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj.modifiers.new('Rigid_Articulation','ARMATURE').object=rig;obj['rig_bone']=bone
    return obj
def mesh_object(name,verts,faces,mat,bone):
    mesh=bpy.data.meshes.new(name+'_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(o)
    return attach(o,name,mat,bone)
def box(name,center,size,mat,bone,bevel=.002):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('V4_Crafted_Chamfer','BEVEL');m.width=bevel;m.segments=2
        bpy.ops.object.modifier_apply(modifier=m.name)
    return attach(o,name,mat,bone)
def washer(name,p,outer,inner,thickness,mat,bone,s=1):
    verts=[];faces=[];n=20
    for y,r in [(-thickness/2,outer),(thickness/2,outer),(-thickness/2,inner),(thickness/2,inner)]:
        for i in range(n):
            a=i*math.tau/n;verts.append(tuple(p+Vector((r*math.cos(a),y,r*math.sin(a)))*s))
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i),(2*n+i,3*n+i,3*n+j,2*n+j)])
    return mesh_object(name,verts,faces,mat,bone)
def screw(name,p,r,bone,s=1):
    # A recessed slot has actual walls and a floor: two raised head halves,
    # with rounded outline and a lowered central slot, all one rigid component.
    n=24;verts=[];faces=[];slot=.0014;depth=.0024
    for level in [0,.004]:
        for i in range(n):
            a=i*math.tau/n;verts.append(tuple(p+Vector((r*math.cos(a),-level,r*math.sin(a)))*s))
    faces.append(tuple(reversed(range(n))))
    for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
    # Split circle into clipped halves, with a straight slot boundary.
    for sign in [-1,1]:
        a0=math.asin(slot/r);angles=[a0+(math.pi-2*a0)*i/12 for i in range(13)]
        outline=[(r*math.cos(a),sign*r*math.sin(a)) for a in angles]
        ids=[]
        for x,z in outline:ids.append(len(verts));verts.append(tuple(p+Vector((x,-.004,z))*s))
        faces.append(tuple(ids if sign==1 else reversed(ids)))
        q=[]
        for x,z in [outline[0],outline[-1]]:q.append(len(verts));verts.append(tuple(p+Vector((x,-.004+depth,z))*s))
        faces.append((ids[0],ids[-1],q[1],q[0]))
    # Slot floor, visibly lower than the two head lands.
    x=math.sqrt(r*r-slot*slot);ids=[]
    for xx,zz in [(-x,-slot),(x,-slot),(x,slot),(-x,slot)]:
        ids.append(len(verts));verts.append(tuple(p+Vector((xx,-.004+depth,zz))*s))
    faces.append(tuple(reversed(ids)))
    return mesh_object(name,verts,faces,'Satin_Brass',bone)
def canonicalize(obj):
    # Bake object-local transforms into the mesh before newly authored bind
    # geometry is mixed with original parts, retaining the evaluated result.
    mesh=obj.data;mesh.transform(obj.matrix_world);obj.matrix_world=Matrix.Identity(4)
def refine():
    rig=bpy.data.objects['WD_Mannequin_Rig'];col=bpy.data.collections['WaterDuel_Character'];s=float(rig.get('boss_uniform_scale',1))
    # Round mannequin retained; only waist/pelvis breadth and link shoulders
    # are eased. Skeleton and attachment positions stay exactly as authored.
    for o in list(col.objects):
        if o.type!='MESH':continue
        if o.name=='Waist_Ball':o.scale.x*=.91;o.scale.y*=.94
        if o.name=='Pelvis_Beech':
            for v in o.data.vertices:
                t=max(0,min(1,v.co.z/(.245*s)));v.co.x*=.94+.025*math.sin(t*math.pi);v.co.y*=.94
        if o.name.startswith(('Thigh_','Shin_','Upper_Arm_','Forearm_')) and o.data.materials[0].name=='Beech_Wood_Grain':
            for v in o.data.vertices:
                # local Z follows each turned link; remove a little bulk only.
                v.co.x*=.965;v.co.y*=.965
        if o.name.endswith('_Axle_Slot') or o.name.startswith('Chest_Screw_Slot_'):
            bpy.data.objects.remove(o,do_unlink=True)
    # Replace ellipsoid feet with a shaped last: planar outsole, eased heel,
    # rounded toe and bevelled upper, within the previous width/depth envelope.
    for side in ['L','R']:
        old=bpy.data.objects['Foot_'+side];canonicalize(old)
        pp=[v.co.copy() for v in old.data.vertices];lo=[min(p[i] for p in pp) for i in range(3)];hi=[max(p[i] for p in pp) for i in range(3)]
        cx=(lo[0]+hi[0])/2;cy=(lo[1]+hi[1])/2;rx=(hi[0]-lo[0])/2;ry=(hi[1]-lo[1])/2
        sole=lo[2];height=hi[2]-lo[2];verts=[];faces=[];n=24
        # All 24 bottom perimeter vertices have exactly the same Z.
        for z,radius in [(sole, .88),(sole+.003*s,.97),(sole+.022*s,1),(sole+height*.76,.88),(sole+height,.48)]:
            for i in range(n):
                a=i*math.tau/n;verts.append((cx+rx*radius*math.cos(a),cy+ry*radius*math.sin(a),z))
        faces.append(tuple(reversed(range(n))))
        for k in range(4):
            for i in range(n):faces.append((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i))
        faces.append(tuple(4*n+i for i in range(n)))
        bpy.data.objects.remove(old,do_unlink=True)
        foot=mesh_object('Foot_'+side,verts,faces,'Beech_Wood_Grain','foot.'+side)
        foot['v4_sole_plane_z']=sole;foot['v4_support']='24-vertex planar outsole, heel and toe in same bone frame'
    # Clevis cheeks belong to parent; bushings and screws belong to child.
    joints=[('Shoulder','upper_arm.','chest',.085),('Elbow','forearm.','upper_arm.',.059),('Knee','shin.','thigh.',.058),('Ankle','foot.','shin.',.045)]
    for label,child,parent,radius in joints:
        for side in ['L','R']:
            cb=child+side;pb=parent+side if parent.endswith('.') else parent
            p=rig.data.bones[cb].head_local.copy();r=radius
            # Washer local dimensions scaled once; pivot already scaled.
            for flank,yy in [('Front',-.094),('Back',.073)]:
                washer('V4_'+label+'_'+side+'_Parent_Clevis_'+flank,p+Vector((0,yy*s,0)),r+.008,r-.007,.010,'Satin_Brass',pb,s)
            washer('V4_'+label+'_'+side+'_Child_Bushing',p+Vector((0,-.113*s,0)),r*.80,r*.39,.008,'Satin_Brass',cb,s)
            screw('V4_'+label+'_'+side+'_Recessed_Screw',p+Vector((0,-.127*s,0)),.015 if label=='Shoulder' else .011,cb,s)
    # A bevelled overlap and real short saddle stitches belong to the visible
    # pelvis belt, so this detail survives optional preview equipment removal.
    box('V4_Belt_Compressed_Overlap',(0.093*s,-.133*s,1.37*s),(.065*s,.010*s,.052*s),'Wrapped_Brown_Leather','pelvis',.002*s)
    for row,z in enumerate([1.348,1.392]):
        for j in range(14):
            x=-.127+j*.019
            if abs(x)<.045:continue
            box('V4_Belt_Saddle_Stitch_%d_%02d'%(row,j),(x*s,-.132*s,z*s),(.008*s,.0022*s,.0018*s),'Mint_Woven_Sash' if s==1 else 'Boss_Burgundy_Woven_Cloth','pelvis',.0005*s)
    # Remove coincident lathe pole vertices and create useful UV0 everywhere.
    for o in col.objects:
        if o.type!='MESH' or o.data.materials[0].name not in ATLAS_MATERIALS:continue
        if o.name.startswith(('Rapier_','Leather_Grip_Wrap_')):continue
        if o.data.materials[0].name=='Beech_Wood_Grain' and not o.name.startswith(('Boss_', 'Foot_', 'Grip_', 'Balance_')):
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            bevel=o.modifiers.new('V4_End_Chamfer_2mm','BEVEL');bevel.width=.002*s;bevel.segments=2;bevel.limit_method='ANGLE';bevel.angle_limit=.65
            o.modifiers.move(len(o.modifiers)-1,0);bpy.ops.object.modifier_apply(modifier=bevel.name)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-7)
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-9);bm.to_mesh(o.data);bm.free();o.data.update()
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active_index=0
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.035);bpy.ops.object.mode_set(mode='OBJECT')
        o['v4_atlas']=True
        if o.data.materials[0].name=='Beech_Wood_Grain':o['v4_cap_faces']=[p.index for p in o.data.polygons if len(p.vertices)>8]
        if o.name in ['Torso_Rounded_Beech','Pelvis_Beech','Neck_Wooden_Peg'] or o.name.startswith(('Thigh_','Shin_','Upper_Arm_','Forearm_')) and o.data.materials[0].name=='Beech_Wood_Grain':
            # Turned timber is parametrized along its actual lathe axis, so
            # longitudinal fibers do not rotate between projected islands.
            mesh=o.data;uv=mesh.uv_layers[0].data;zmin=min(v.co.z for v in mesh.vertices);height=max(v.co.z for v in mesh.vertices)-zmin
            for face in mesh.polygons:
                pp=[mesh.vertices[mesh.loops[li].vertex_index].co for li in face.loop_indices]
                if face.index in o.get('v4_cap_faces',[]):
                    radius=max(max(abs(p.x),abs(p.y)) for p in pp)
                    for li,p in zip(face.loop_indices,pp):uv[li].uv=(.5+p.x/(2*radius),.5+p.y/(2*radius))
                else:
                    us=[(math.atan2(p.y,p.x)/math.tau)%1 for p in pp]
                    if max(us)-min(us)>.5:us=[u+1 if u<.5 else u for u in us]
                    for li,p,u in zip(face.loop_indices,pp,us):uv[li].uv=(u,(p.z-zmin)/height)
    bpy.context.view_layer.update()

def region_specs():
    result=[]
    for o in bpy.data.collections['WaterDuel_Character'].objects:
        if not o.get('v4_atlas'):continue
        mat=o.data.materials[0].name;kind=ATLAS_MATERIALS[mat]
        size=80 if kind=='wood' else 40
        if kind=='cloth' and 'Stitch' not in o.name:size=112
        if o.name=='Torso_Rounded_Beech':size=144
        if o.name.startswith('Foot_'):size=96
        if 'Stitch' in o.name:size=24
        result.append({'id':o.name,'material':mat,'kind':kind,'size':size,'seed':int(hashlib.sha256(o.name.encode()).hexdigest()[:8],16),'padding':4,'grainAxis':'v','function':'sole' if o.name.startswith('Foot_') else 'recess' if any(x in o.name for x in ['Recess','Core','Bushing']) else 'contact' if any(x in o.name for x in ['Screw','Pin','Axle']) else 'body'})
        for index in o.get('v4_cap_faces',[]):
            id=o.name+':endgrain:'+str(index)
            result.append({'id':id,'material':mat,'kind':'endgrain','size':32 if not o.name.startswith('Foot_') else 48,'seed':int(hashlib.sha256(id.encode()).hexdigest()[:8],16),'padding':4,'grainAxis':'radial','function':'sole' if o.name.startswith('Foot_') else 'housing'})
    return result
def layout(specs):
    unique={s['id']:s for s in specs};regions=[];x=y=row=0
    for spec in sorted(unique.values(),key=lambda a:(-a['size'],a['id'])):
        s=spec.pop('size')
        if x+s>1024:x=0;y+=row;row=0
        assert y+s<=1024,('Atlas exceeds 1024',len(unique),y,s)
        regions.append(dict(spec,rect=[x,y,s,s]));x+=s;row=max(row,s)
    return {'schema':4,'size':1024,'origin':'top-left','padding':4,'regions':regions}
def atlas_uv(layout):
    regions={r['id']:r for r in layout['regions']}
    for o in bpy.data.collections['WaterDuel_Character'].objects:
        if not o.get('v4_atlas'):continue
        mesh=o.data
        if len(mesh.uv_layers)<2:mesh.uv_layers.new(name='AtlasUV')
        uv=mesh.uv_layers[1];uv.name='AtlasUV';region=regions[o.name];x,y,w,h=region['rect'];pad=region['padding']
        for a,b in zip(mesh.uv_layers[0].data,uv.data):
            u,v=a.uv;b.uv=((x+pad+u*(w-2*pad))/1024,1-(y+pad+(1-v)*(h-2*pad))/1024)
        for index in o.get('v4_cap_faces',[]):
            face=mesh.polygons[index];r=regions[o.name+':endgrain:'+str(index)];x,y,w,h=r['rect'];pad=r['padding']
            coords=[mesh.uv_layers[0].data[i].uv.copy() for i in face.loop_indices]
            low=[min(p[i] for p in coords) for i in [0,1]];high=[max(p[i] for p in coords) for i in [0,1]]
            for li,p in zip(face.loop_indices,coords):
                u=(p.x-low[0])/max(1e-10,high[0]-low[0]);v=(p.y-low[1])/max(1e-10,high[1]-low[1])
                uv.data[li].uv=((x+pad+u*(w-2*pad))/1024,1-(y+pad+(1-v)*(h-2*pad))/1024)
        mesh.uv_layers.active_index=0
