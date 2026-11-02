"""Build isolated v4 editable sources and GLBs, CPU only; never render."""
import bpy,bmesh,json,sys,hashlib,struct
from mathutils import Vector
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import character_v4_geometry as geo
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'docs/assets/characters/v4';OUT=ROOT/'public/assets/characters/water-mannequin/v4'
NAMES=['water-mannequin','water-mannequin-amber','water-mannequin-boss']
SOURCE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
def signature():
    rig=bpy.data.objects['WD_Mannequin_Rig'];col=bpy.data.collections['WaterDuel_Character']
    return {'bones':{b.name:{'matrix':[list(r) for r in b.matrix_local],'pose':[list(r) for r in rig.pose.bones[b.name].matrix_basis]} for b in rig.data.bones},'sockets':{o.name:[list(r) for r in o.matrix_world] for o in col.objects if o.name.startswith('Socket_')}}
def protected():
    h=hashlib.sha256()
    for o in sorted(bpy.data.collections['WaterDuel_Character'].objects,key=lambda o:o.name):
        if o.type!='MESH' or not any(g.name=='head' for g in o.vertex_groups):continue
        h.update(o.name.encode());h.update(repr([tuple(v.co) for v in o.data.vertices]).encode());h.update(repr([tuple(p.vertices) for p in o.data.polygons]).encode());h.update(repr([list(r) for r in o.matrix_world]).encode())
    return h.hexdigest()
def author():
    specs=[]
    for name in NAMES:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters/v3'/(name+'.blend')))
        bpy.context.view_layer.update();before=signature();head=protected();geo.refine();assert signature()==before;assert protected()==head
        (SOURCE/(name+'-construction.json')).write_text(json.dumps({'variant':name,'source_baseline':'v3','rig_rest_pose_sockets_exact':before==signature(),'protected_head_geometry_hash_before':head,'protected_head_geometry_hash_after':protected(),'chamfer_metres':.002*float(bpy.data.objects['WD_Mannequin_Rig'].get('boss_uniform_scale',1)),'screw_slot_depth_metres':.0024*float(bpy.data.objects['WD_Mannequin_Rig'].get('boss_uniform_scale',1)),'clearance_design':{'parent_front_cheek_to_legacy_cap_axial_metres':.003,'ankle_parent_bore_to_child_bushing_radial_metres':.002,'elbow_parent_bore_to_child_bushing_radial_metres':.0048,'insertions':'Original through-axle passes both parent cheeks; child bushing overlaps its legacy cap intentionally; screw underside meets original pin face.'},'pose_sweep':'Requires runtime poses; this receipt certifies construction and unchanged pivot axes only.'},indent=2))
        specs+=geo.region_specs();bpy.context.preferences.filepaths.save_version=0
        bpy.context.scene['v4_protected_head_hash']=head;bpy.context.scene['v4_contract']='18 unchanged bind bones, five unchanged sockets; rigid weight1. CPU authoring; no fluid preview changes.'
        (SOURCE/(name+'-physical.json')).write_text(json.dumps(physical_descriptor(name),indent=2))
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    layout=geo.layout(specs);(SOURCE/'atlas-layout.json').write_text(json.dumps(layout,indent=2))
    print('WD_V4_LAYOUT',len(layout['regions']),flush=True)
def wire_atlas(variant):
    maps=SOURCE/'textures';images={}
    baseline=(ROOT/'public/assets/characters/water-mannequin/v3'/(variant+'.glb')).read_bytes();length=struct.unpack_from('<I',baseline,12)[0]
    original_materials={m['name']:m for m in json.loads(baseline[20:20+length])['materials']}
    preview_materials={}
    for obj in bpy.data.collections['WaterDuel_Character'].objects:
        if obj.type!='MESH' or not obj.name.startswith(('Rapier_','Leather_Grip_Wrap_')):continue
        mat=obj.data.materials[0]
        if mat.name in geo.ATLAS_MATERIALS:
            if mat.name not in preview_materials:
                copy=mat.copy();copy.name='Preview_Original_'+mat.name;preview_materials[mat.name]=copy
            obj.data.materials[0]=preview_materials[mat.name]
    for filename,space in [('body-basecolor.png','sRGB'),('body-normal.png','Non-Color'),('body-orm.png','Non-Color')]:
        path=maps/filename
        if not path.exists():raise FileNotFoundError('Task B atlas pending: '+str(path))
        im=bpy.data.images.load(str(path),check_existing=False);im.colorspace_settings.name=space;im.pack();images[filename]=im
    for matname,kind in geo.ATLAS_MATERIALS.items():
        mat=bpy.data.materials.get(matname)
        if not mat:continue
        old=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        tint=original_materials.get(matname,{}).get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1]) if kind=='cloth' else [1,1,1,1]
        # v3 cloth base factor is its existing garment tint. Neutral atlas weave
        # multiplies it once; all hard surface colors come from their regions.
        nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
        out=nodes.new('ShaderNodeOutputMaterial');bs=nodes.new('ShaderNodeBsdfPrincipled');links.new(bs.outputs['BSDF'],out.inputs['Surface'])
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map='AtlasUV'
        textures={}
        for filename,im in images.items():
            t=nodes.new('ShaderNodeTexImage');t.image=im;t.interpolation='Linear';links.new(uv.outputs['UV'],t.inputs['Vector']);textures[filename]=t
        base=textures['body-basecolor.png']
        if kind=='cloth':
            mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=tint;links.new(base.outputs['Color'],mix.inputs[1]);links.new(mix.outputs['Color'],bs.inputs['Base Color']);bs.inputs['Sheen Weight'].default_value=.18
            sheen=original_materials.get(matname,{}).get('extensions',{}).get('KHR_materials_sheen',{})
            color=sheen.get('sheenColorFactor',[.025,.12,.10]);peak=max(color)
            bs.inputs['Sheen Weight'].default_value=peak;bs.inputs['Sheen Roughness'].default_value=sheen.get('sheenRoughnessFactor',.82)
            if peak:bs.inputs['Sheen Tint'].default_value=tuple(c/peak for c in color)+(1,)
        else:links.new(base.outputs['Color'],bs.inputs['Base Color'])
        sep=nodes.new('ShaderNodeSeparateColor');links.new(textures['body-orm.png'].outputs['Color'],sep.inputs['Color']);links.new(sep.outputs['Green'],bs.inputs['Roughness']);links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
        normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='AtlasUV';normal.inputs['Strength'].default_value=.6;links.new(textures['body-normal.png'].outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bs.inputs['Normal'])
        # glTF exporter recognizes the glTF Material Output occlusion socket.
        group=bpy.data.node_groups.get('glTF Material Output')
        if group is None:
            group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
        if not any(item.name=='Thickness' for item in group.interface.items_tree):group.interface.new_socket(name='Thickness',in_out='INPUT',socket_type='NodeSocketFloat')
        for socket,default in [('Dispersion',0),('Iridescence Factor',0),('Iridescence Thickness Minimum',100)]:
            if not any(item.name==socket for item in group.interface.items_tree):
                group.interface.new_socket(name=socket,in_out='INPUT',socket_type='NodeSocketFloat').default_value=default
        ao=nodes.new('ShaderNodeGroup');ao.node_tree=group;links.new(sep.outputs['Red'],ao.inputs['Occlusion'])
        mat['v4_atlas_uv']=1;mat['v4_region_specific']=True
def physical_descriptor(name):
    rig=bpy.data.objects['WD_Mannequin_Rig'];s=float(rig.get('boss_uniform_scale',1));feet={}
    for side in ['L','R']:
        o=bpy.data.objects['Foot_'+side];ankle=rig.data.bones['foot.'+side].head_local
        pp=[o.matrix_world@v.co-ankle for v in o.data.vertices];shin=rig.data.bones['shin.'+side]
        axis=(shin.tail_local-shin.head_local).normalized();perp=Vector((-axis.z,0,axis.x)).normalized()
        shin_objects=[o for o in bpy.data.collections['WaterDuel_Character'].objects if o.type=='MESH' and o.get('rig_bone')=='shin.'+side]
        shin_pp=[o.matrix_world@v.co-shin.head_local for o in shin_objects for v in o.data.vertices]
        envelope={'origin_knee_bind_Zup':list(shin.head_local),'axis_knee_to_ankle_Zup':list(axis),'perpendicular_XZ':list(perp),'along_metres':[min(p.dot(axis) for p in shin_pp),max(p.dot(axis) for p in shin_pp)],'perpendicular_metres':[min(p.dot(perp) for p in shin_pp),max(p.dot(perp) for p in shin_pp)],'depth_Y_metres':[min(p.y for p in shin_pp),max(p.y for p in shin_pp)],'source_meshes':[o.name for o in shin_objects]}
        radius=max(abs(x) for x in envelope['perpendicular_metres'])
        feet[side]={'ankle_bind_Zup':list(ankle),'foot_bounds_from_ankle_Zup':{k:[f(p[i] for p in pp) for i in range(3)] for k,f in [('min',min),('max',max)]},'shin_length_metres':(shin.tail_local-shin.head_local).length,'shin_floor_radius_metres':radius,'shin_envelope':envelope,'owner':'shin.'+side,'sole_plane_from_ankle_metres':min(p.z for p in pp)}
        points=sorted(set((round(p.x,9),round(p.z,9)) for p in pp))
        def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
        hull=[]
        for p in points:
            while len(hull)>=2 and cross(hull[-2],hull[-1],p)<=0:hull.pop()
            hull.append(p)
        lower=len(hull)
        for p in reversed(points[:-1]):
            while len(hull)>lower and cross(hull[-2],hull[-1],p)<=0:hull.pop()
            hull.append(p)
        feet[side]['foot_convex_hull_XY']=hull[:-1]
        sole=min(p.z for p in pp)
        feet[side]['sole_vertices_GLB_from_ankle']=[[p.x,p.z,-p.y] for p in pp if abs(p.z-sole)<1e-6]
        bm=bmesh.new();cloud=[bm.verts.new(p) for p in shin_pp];bm.verts.ensure_lookup_table()
        convex=bmesh.ops.convex_hull(bm,input=cloud,use_existing_faces=False)
        hullverts=set()
        for element in convex['geom']:
            if isinstance(element,bmesh.types.BMVert):hullverts.add(element)
            elif hasattr(element,'verts'):hullverts.update(element.verts)
        feet[side]['shin_convex_hull_Zup_from_knee']=sorted([list(v.co) for v in hullverts]);bm.free()
    tab=bpy.data.objects.get('Boss_Long_Burgundy_Tabard') or bpy.data.objects.get('Workshop_Sash')
    pp=[tab.matrix_world@v.co for v in tab.data.vertices];lo=[min(p[i] for p in pp) for i in range(3)];hi=[max(p[i] for p in pp) for i in range(3)]
    return {'schema':4,'variant':name,'space':'Blender bind Z-up metres, GLB mapping x,y,z -> x,z,-y','feet':feet,'cloth':{'source':tab.name,'owner':'pelvis','bounds_Zup':{'min':lo,'max':hi},'node_columns':3,'node_rows':4,'panels_columns':2,'panels_rows':3,'anchor':'top row','render_binding':'bilinear panel coordinates from bind x/z; depth offset preserved','decoration_prefixes':['Boss_Tabard_','Boss_Crown_','Boss_Laurel_','Boss_Crest_']}}
def preserve_cloth_factors(name):
    # Blender 5.2 can serialize a linked multiply as texture-only, omitting the
    # garment tint and exporting white sheen. Keep the source multiply and make
    # the core glTF factors explicit without changing any mesh/BIN bytes.
    path=OUT/(name+'.glb');data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+length])
    old=(ROOT/'public/assets/characters/water-mannequin/v3'/(name+'.glb')).read_bytes();n=struct.unpack_from('<I',old,12)[0]
    originals={m['name']:m for m in json.loads(old[20:20+n])['materials']}
    for mat in g['materials']:
        if mat['name'] not in ['Mint_Woven_Sash','Boss_Burgundy_Woven_Cloth']:continue
        before=originals[mat['name']]
        mat['pbrMetallicRoughness']['baseColorFactor']=before['pbrMetallicRoughness']['baseColorFactor']
        mat.setdefault('extensions',{})['KHR_materials_sheen']=before['extensions']['KHR_materials_sheen']
    raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
    chunks=struct.pack('<II',len(raw),0x4e4f534a)+raw+data[20+length:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,12+len(chunks))+chunks)

def export(name):
    col=bpy.data.collections['WaterDuel_Character'];rig=bpy.data.objects['WD_Mannequin_Rig'];temp=bpy.data.collections.new('V4_Export_Temporary');bpy.context.scene.collection.children.link(temp)
    separate=[bpy.data.objects['Balloon_Latex'],bpy.data.objects['Water_Contained']];groups={};merged=[]
    for o in col.objects:
        if o.type!='MESH' or o in separate:continue
        dup=o.copy();dup.data=o.data.copy();temp.objects.link(dup)
        optional=o.name.startswith(('Rapier_','Leather_Grip_Wrap_','Preview_Rapier_'))
        groups.setdefault((o.data.materials[0].name,optional),[]).append(dup)
    for (material,optional),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=('Preview_Rapier_' if optional else 'WD_Boss_' if name.endswith('boss') else 'WD_')+material;merged.append(o)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
    meshes=merged+separate;tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    assert len(meshes)<=18,len(meshes);assert tris<=(90000 if name.endswith('boss') else 65000),tris
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes+[rig]+[o for o in col.objects if o.type=='EMPTY']:o.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_skins=True,export_animations=False,export_rest_position_armature=False,export_current_frame=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    preserve_cloth_factors(name)
    for o in list(temp.objects):bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.collections.remove(temp)
    return {'export_triangles':tris,'export_meshes':len(meshes)}
if '--export-only' not in sys.argv:author()
if '--author-only' not in sys.argv:
    layout=json.loads((SOURCE/'atlas-layout.json').read_text())
    for name in NAMES:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(name+'.blend')));geo.atlas_uv(layout);wire_atlas(name)
        descriptor=physical_descriptor(name);stats=export(name);descriptor.update(stats)
        (SOURCE/(name+'-physical.json')).write_text(json.dumps(descriptor,indent=2))
        bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
        print('WD_V4_EXPORT',name,json.dumps(stats),flush=True)
