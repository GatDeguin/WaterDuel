"""Reopen, validate and render the authored Blender asset in a private process."""
import bpy
import os
import json
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'output','blender')
scene=bpy.context.scene

def collection(name):
    c=bpy.data.collections.get(name)
    if c is None:c=bpy.data.collections.new(name);scene.collection.children.link(c)
    return c

def new_box(name,loc,dim,mat,col):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.dimensions=dim
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for c in list(o.users_collection):c.objects.unlink(o)
    col.objects.link(o);o.data.materials.append(mat)
    be=o.modifiers.new('Worn cabinet edges','BEVEL');be.width=.018;be.segments=3
    return o

if not scene.get('Final dressing applied'):
    col=collection('Workshop | rear drafting counter')
    oak=bpy.data.materials['Oak | aged endgrain and open pores'];dark=bpy.data.materials['Walnut | smoke and worn varnish'];brass=bpy.data.materials['Brass | tarnish, patina, polished edges']
    new_box('Long rear drafting counter',(0,6.38,1.62),(10.9,1.22,.15),oak,col)
    for x in [-4.9,-2.6,0,2.6,4.9]:
        new_box('Rear cabinet carcass',(x,6.51,.78),(1.35,.94,1.48),dark,col)
        for z in [.32,.72,1.15]:
            new_box('Rear cabinet inset drawer',(x,6.0,z),(1.23,.07,.30),oak,col)
            new_box('Rear cabinet brass pull',(x,5.945,z),(.22,.045,.035),brass,col)
    for o in scene.objects:
        if o.name.startswith(('Arena apron pennant','Apron woven insignia')):o.location.y-=.24
        if o.name.startswith('Back bench green accent'):
            o.location.z+=1.64
        elif o.name.startswith(('Left arena fern','Right arena ivy','Back left potted shrub','Back right potted shrub')):
            o.location.z-=.06
        if o.name.startswith('Large spare clock gear'):o.location.x-=.48
    # Embroidery follows the folded cloth. Keep the original font sources hidden
    # and editable; their visible mesh counterparts use non-destructive shrinkwrap.
    deps=bpy.context.evaluated_depsgraph_get()
    def center(obj):return obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box),Vector())/8)
    banners=[o for o in scene.objects if '| folded fabric' in o.name]
    names=('Grand embroidered insignia','Grand standard lettering','Grand standard subtitle','Pennant woven emblem','Pennant serial','Apron woven insignia')
    for o in list(scene.objects):
        if not o.name.startswith(names):continue
        c=center(o);target=min(banners,key=lambda b:(center(b)-c).length)
        if o.type=='FONT':
            data=bpy.data.meshes.new_from_object(o.evaluated_get(deps),depsgraph=deps)
            vis=bpy.data.objects.new('Embroidery | '+o.name,data)
            for col in o.users_collection:col.objects.link(vis)
            vis.matrix_world=o.matrix_world.copy();o.hide_render=True;o.hide_viewport=True
        else:vis=o
        mod=vis.modifiers.new('Embroidery fitted to the folds','SHRINKWRAP');mod.target=target;mod.wrap_method='NEAREST_SURFACEPOINT';mod.offset=.006
    # Uprights and crossbars retain longitudinal grain in their own local axis.
    variants={}
    for o in list(scene.objects):
        if o.type!='MESH' or not o.data.materials:continue
        m=o.data.materials[0]
        if m.name.startswith(('Oak |','Walnut |')):
            axis=max(range(3),key=lambda i:o.dimensions[i])
            if axis==0:continue
            key=(m.name,axis)
            if key not in variants:
                alt=m.copy();alt.name=m.name+' / grain '+('Y' if axis==1 else 'Z')
                for node in alt.node_tree.nodes:
                    if node.bl_idname=='ShaderNodeVectorMath' and node.operation=='MULTIPLY':
                        node.inputs[1].default_value=(38,1.2,23) if axis==1 else (38,23,1.2)
                variants[key]=alt
            o.data.materials[0]=variants[key]
    # Editable layout marker is a wire guide and does not appear in the render.
    col=collection('11 | Integration guides / hidden in render')
    obj=bpy.data.objects.new('Combat volume | clear 9.6 x 3.6 x 4.0 m',None);col.objects.link(obj)
    obj.empty_display_type='CUBE';obj.empty_display_size=1;obj.location=(0,0,3.15);obj.scale=(4.8,1.8,2);obj.hide_render=True
    obj['table_surface_z']=1.15;obj['note']='Authored coordinates Z up. Transform explicitly before runtime integration.'
    scene['Final dressing applied']=True

if not scene.get('Photographic finishing applied'):
    scene.view_settings.exposure=-.15
    for obj in scene.objects:
        if obj.type=='LIGHT':
            if obj.name.startswith('Key |'):
                obj.data.energy=650;obj.data.size=4
            elif obj.name.startswith('Left tall window'):obj.data.energy=1100
            elif obj.name.startswith('Right tall window'):obj.data.energy=1450
            elif obj.name.startswith('Shade downlight'):obj.data.energy=210
            elif obj.name.startswith('Right table glancing'):obj.data.energy=580
            elif obj.name.startswith('Soft front return'):obj.data.energy=130
        if obj.type=='CAMERA' and obj.name.startswith('01 |'):obj.data.dof.aperture_fstop=1.0
    p=bpy.data.materials['Window | cold diffuse daylight'].node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(.17,.245,.32,1)
    p.inputs['Emission Color'].default_value=(.24,.37,.50,1)
    p.inputs['Emission Strength'].default_value=.35
    p.inputs['Specular IOR Level'].default_value=.15
    # Clean unused factory brushes/material libraries from the standalone asset.
    for m in list(bpy.data.materials):
        if m.users==0:bpy.data.materials.remove(m)
    scene['Photographic finishing applied']=True

if not scene.get('Reference refinement 2'):
    # The cloth fronts face -Y; a negative normal offset keeps embroidery visible.
    for o in scene.objects:
        for mod in list(o.modifiers):
            if mod.type=='SHRINKWRAP':
                mod.offset=-.018
                sub=o.modifiers.new('Fine tessellation for cloth contact','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=2;sub.render_levels=2
                o.modifiers.move(len(o.modifiers)-1,0)
        if o.name.startswith('Back bench green accent'):o.location.y-=.30
    cam=bpy.data.objects['01 | Duel view / w1']
    cam.location=(.15,-17.8,3.2)
    cam.rotation_euler=(Vector((0,2.3,3.7))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.lens=42;cam.data.dof.aperture_fstop=.8;cam.data.dof.focus_distance=(Vector((0,0,1.15))-cam.location).length
    # Frosted, soot-marked glass has soft outdoor variation instead of reflecting
    # a giant studio rectangle into a clean, featureless white panel.
    m=bpy.data.materials['Window | cold diffuse daylight'];nt=m.node_tree;nt.nodes.clear()
    out=nt.nodes.new('ShaderNodeOutputMaterial');em=nt.nodes.new('ShaderNodeEmission');em.inputs['Strength'].default_value=.8
    tc=nt.nodes.new('ShaderNodeTexCoord')
    coord=bpy.data.objects.new('Window weather coordinate system',None);collection('02 | Tall studio windows').objects.link(coord);tc.object=coord
    pat=nt.nodes.new('ShaderNodeTexNoise');pat.inputs['Scale'].default_value=.45;pat.inputs['Detail'].default_value=2.5;pat.inputs['Roughness'].default_value=.7
    nt.links.new(tc.outputs['Object'],pat.inputs['Vector'])
    r=nt.nodes.new('ShaderNodeValToRGB');r.color_ramp.elements[0].position=.18;r.color_ramp.elements[0].color=(.022,.044,.071,1);r.color_ramp.elements[1].position=.82;r.color_ramp.elements[1].color=(.16,.235,.30,1)
    nt.links.new(pat.outputs['Fac'],r.inputs[0]);nt.links.new(r.outputs[0],em.inputs['Color']);nt.links.new(em.outputs[0],out.inputs['Surface'])
    scene['Reference refinement 2']=True

if not scene.get('Embroidery ray projection 3'):
    # Fit each dense applique vertex onto the actual first cloth surface. Using
    # the first ray hit avoids ambiguities between two sides of a thin fabric.
    from mathutils.bvhtree import BVHTree
    banners=[o for o in scene.objects if '| folded fabric' in o.name]
    def centroid(obj):return obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box),Vector())/8)
    names=('Grand embroidered insignia','Pennant woven emblem','Apron woven insignia','Embroidery | ')
    targets=[o for o in scene.objects if o.type=='MESH' and o.name.startswith(names)]
    fitted=0
    for o in targets:
        for mod in list(o.modifiers):
            if mod.type=='SHRINKWRAP':o.modifiers.remove(mod)
        deps=bpy.context.evaluated_depsgraph_get()
        target=min(banners,key=lambda b:(centroid(b)-centroid(o)).length)
        bvh=BVHTree.FromObject(target,deps)
        data=bpy.data.meshes.new_from_object(o.evaluated_get(deps),depsgraph=deps)
        inv=o.matrix_world.inverted();tinv=target.matrix_world.inverted()
        ys=[(o.matrix_world@v.co).y for v in o.data.vertices];plane=(min(ys)+max(ys))/2
        front=min((target.matrix_world@Vector(v)).y for v in target.bound_box)-1
        for v in data.vertices:
            p=o.matrix_world@v.co;depth=p.y-plane
            hit,normal,index,distance=bvh.ray_cast(tinv@Vector((p.x,front,p.z)),Vector((0,1,0)),4)
            if hit is not None:
                p.y=(target.matrix_world@hit).y-.008+depth;v.co=inv@p
        for mod in list(o.modifiers):o.modifiers.remove(mod)
        o.data=data
        fitted+=1
    scene['Embroidery ray projection 3']=fitted

if not scene.get('Framing refinement 4'):
    for o in scene.objects:
        if o.name.startswith(('Grand WaterDuel standard','Grand embroidered insignia','Grand banner lower','Embroidery | Grand','Grand standard')):
            o.location.y-=.52
    cam=bpy.data.objects['02 | Grand atelier / w4'];cam.location=(7.5,-16.5,5.1)
    cam.rotation_euler=(Vector((0,3.7,4.1))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.lens=42;cam.data.dof.aperture_fstop=2.8;cam.data.dof.focus_distance=(Vector((0,2,3))-cam.location).length
    # Restrained aerial depth in the workshop; the central table stays crisp.
    col=collection('Workshop | photographic atmosphere')
    fog=bpy.data.materials.new('Air | restrained workshop haze');fog.use_nodes=True
    nt=fog.node_tree;nt.nodes.clear();out=nt.nodes.new('ShaderNodeOutputMaterial');v=nt.nodes.new('ShaderNodeVolumePrincipled')
    v.inputs['Density'].default_value=.006;v.inputs['Anisotropy'].default_value=.25
    nt.links.new(v.outputs['Volume'],out.inputs['Volume'])
    o=new_box('Workshop air',(0,4.5,5.6),(20.7,8.6,10.8),fog,col)
    o.modifiers.clear();o.display_type='WIRE'
    scene['Framing refinement 4']=True

if not scene.get('Lived in workshop dressing 5'):
    namespace={}
    path=os.path.join(os.path.dirname(__file__),'workshop_atmosphere.py')
    with open(path,encoding='utf-8') as f:exec(compile(f.read(),path,'exec'),namespace)
    scene['Lived in workshop dressing 5']=str(namespace['refine_atelier']())

prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=(d.type=='OPTIX')
scene.cycles.device='GPU'
scene.cycles.samples=160;scene.cycles.adaptive_threshold=.018;scene.cycles.use_denoising=True
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
scene.camera=bpy.data.objects['01 | Duel view / w1']
scene.render.filepath=os.path.join(OUT,'WaterDuel_Atelier_duelo.png')
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.shading.use_scene_lights=True
            a.spaces.active.shading.use_scene_world=True
try:bpy.data.orphans_purge(do_recursive=True)
except Exception:pass
# Versioned final avoids retaining a large redundant .blend1 backup.
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'WaterDuel_Atelier.blend'))

deps=bpy.context.evaluated_depsgraph_get()
tri=verts=0
for o in scene.objects:
    if o.type=='MESH':
        ev=o.evaluated_get(deps);me=ev.to_mesh();me.calc_loop_triangles();tri+=len(me.loop_triangles);verts+=len(me.vertices);ev.to_mesh_clear()
manifest={
    'file':'WaterDuel_Atelier.blend','blender_version':bpy.app.version_string,'renderer':'Cycles / OPTIX',
    'objects':len(scene.objects),'mesh_objects':sum(o.type=='MESH' for o in scene.objects),
    'evaluated_mesh_triangles':tri,'evaluated_mesh_vertices':verts,
    'materials':len(bpy.data.materials),'lights':sum(o.type=='LIGHT' for o in scene.objects),
    'cameras':[o.name for o in scene.objects if o.type=='CAMERA'],
    'units':'metres','up_axis':'Z','depth_axis':'Y','stage_top_z':1.15,
    'stage_bounds':{'x':[-5.88,5.88],'y':[-2.60,2.60]},
    'clear_combat_volume':{'x':[-4.8,4.8],'y':[-1.8,1.8],'z':[1.15,5.15]},
    'packed_reference_images':[im.name for im in bpy.data.images if im.packed_file],
    'external_asset_dependencies':[],
    'scope':'Editable environment only. Static authored water dressing. Cycles render is not evidence of WebGL runtime performance.'
}
with open(os.path.join(OUT,'scene_manifest.json'),'w',encoding='utf-8') as f:json.dump(manifest,f,ensure_ascii=False,indent=2)
print('FINAL_SCENE_SAVED',json.dumps(manifest),flush=True)
if '--preview' in __import__('sys').argv or '--wide-preview' in __import__('sys').argv:
    scene.render.resolution_percentage=50;scene.cycles.samples=32
    scene.render.filepath=os.path.join(OUT,'preview_final.png')
    if '--wide-preview' in __import__('sys').argv:
        scene.camera=bpy.data.objects['02 | Grand atelier / w4'];scene.render.filepath=os.path.join(OUT,'preview_taller.png')
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(write_still=True)
    print('DUEL_RENDER_DONE',flush=True)
    scene.camera=bpy.data.objects['02 | Grand atelier / w4']
    scene.render.filepath=os.path.join(OUT,'WaterDuel_Atelier_taller.png')
    bpy.ops.render.render(write_still=True)
    print('WIDE_RENDER_DONE',flush=True)
