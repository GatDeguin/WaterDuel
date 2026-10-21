"""Wire v3 PBR into new editable sources; never export or modify geometry."""
import bpy,json,hashlib,struct,sys
from pathlib import Path
from array import array
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'docs/assets/characters/v3';OUT=ROOT/'public/assets/characters/water-mannequin/v3';MAPS=SOURCE/'textures'
SOURCE.mkdir(parents=True,exist_ok=True)
def fingerprint():
    h=hashlib.sha256()
    for obj in sorted(bpy.data.collections['WaterDuel_Character'].objects,key=lambda o:o.name):
        h.update(obj.name.encode());h.update(obj.type.encode());h.update(repr(tuple(tuple(r) for r in obj.matrix_world)).encode())
        if obj.type=='MESH':
            mesh=obj.data;coords=array('f',[0])*(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',coords);h.update(coords.tobytes())
            for p in mesh.polygons:h.update(repr((tuple(p.vertices),p.material_index,p.use_smooth)).encode())
            for layer in mesh.uv_layers:
                h.update(layer.name.encode());uv=array('f',[0])*(len(layer.data)*2);layer.data.foreach_get('uv',uv);h.update(uv.tobytes())
            for v in mesh.vertices:h.update(repr(tuple((g.group,g.weight) for g in v.groups)).encode())
        elif obj.type=='ARMATURE':
            for b in obj.data.bones:h.update(repr((b.name,b.parent.name if b.parent else None,tuple(tuple(r) for r in b.matrix_local))).encode())
            for b in obj.pose.bones:h.update(repr((b.name,tuple(tuple(r) for r in b.matrix_basis))).encode())
    return h.hexdigest()
def load_json(name):
    b=(OUT/(name+'.glb')).read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n])
images={}
def texture(nodes,g,slot,color=False):
    im=g['images'][g['textures'][slot['index']]['source']];key=(im['name'],color)
    if key not in images:
        img=bpy.data.images.load(str(MAPS/(im['name']+'.png')),check_existing=False)
        img.colorspace_settings.name='sRGB' if color else 'Non-Color';img.pack();images[key]=img
    node=nodes.new('ShaderNodeTexImage');node.image=images[key];return node
for name in ['water-mannequin','water-mannequin-amber','water-mannequin-boss']:
    baseline='water-mannequin' if name.endswith('-amber') else name
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters/v2'/(baseline+'.blend')));images={}
    bpy.context.view_layer.update();before=fingerprint();g=load_json(name)
    for raw in g['materials']:
        if raw['name'] not in ['Beech_Wood_Grain','Satin_Brass','Endgrain_Joints','Wrapped_Brown_Leather','Mint_Woven_Sash','Boss_Burgundy_Woven_Cloth']:continue
        mat=bpy.data.materials.get(raw['name']);assert mat,raw['name'];nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
        out=nodes.new('ShaderNodeOutputMaterial');bs=nodes.new('ShaderNodeBsdfPrincipled');links.new(bs.outputs['BSDF'],out.inputs['Surface'])
        p=raw['pbrMetallicRoughness'];factor=p.get('baseColorFactor',[1,1,1,1]);bs.inputs['Base Color'].default_value=factor
        if 'baseColorTexture' in p:
            t=texture(nodes,g,p['baseColorTexture'],True);links.new(t.outputs['Color'],bs.inputs['Base Color'])
        bs.inputs['Metallic'].default_value=p.get('metallicFactor',1);bs.inputs['Roughness'].default_value=p.get('roughnessFactor',1)
        if 'metallicRoughnessTexture' in p:
            t=texture(nodes,g,p['metallicRoughnessTexture']);separate=nodes.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],separate.inputs['Color'])
            links.new(separate.outputs['Green'],bs.inputs['Roughness'])
            metal=nodes.new('ShaderNodeMath');metal.operation='MULTIPLY';metal.inputs[1].default_value=p.get('metallicFactor',1);links.new(separate.outputs['Blue'],metal.inputs[0]);links.new(metal.outputs[0],bs.inputs['Metallic'])
        if 'normalTexture' in raw:
            t=texture(nodes,g,raw['normalTexture']);normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=raw['normalTexture'].get('scale',1);links.new(t.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bs.inputs['Normal'])
        sheen=raw.get('extensions',{}).get('KHR_materials_sheen')
        if sheen:
            color=sheen.get('sheenColorFactor',[0,0,0]);strength=max(color);bs.inputs['Sheen Weight'].default_value=strength;bs.inputs['Sheen Roughness'].default_value=sheen.get('sheenRoughnessFactor',.5)
            if strength:bs.inputs['Sheen Tint'].default_value=tuple(c/strength for c in color)+(1,)
        mat.diffuse_color=factor
        mat['v3_note']='PBR texture wear only. Mesh/UV/rig unchanged.'
    # Amber head palette is copied from its original v2 GLB; v3 does not alter it.
    if name.endswith('-amber'):
        for raw in g['materials']:
            if raw['name'] not in ['Mint_Latex_Transmission','Water_IOR_1.333']:continue
            mat=bpy.data.materials[raw['name']];node=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');node.inputs['Base Color'].default_value=raw['pbrMetallicRoughness']['baseColorFactor']
            vol=next((n for n in mat.node_tree.nodes if n.type=='VOLUME_ABSORPTION'),None)
            ext=raw.get('extensions',{}).get('KHR_materials_volume',{})
            if vol and 'attenuationColor' in ext:vol.inputs['Color'].default_value=ext['attenuationColor']+[1]
    bpy.context.view_layer.update();after=fingerprint();assert before==after,(name,before,after)
    note=bpy.data.texts.new('LEEME_WaterDuel_V3');note.write('V3: revisión sólo materiales. Geometría, UV, rig, pesos, poses y sockets conservados exactamente respecto de fuente v2. GLB parcheado directamente, no reexportado. Mapas512/1024 embebidos y sin iluminación horneada. Mantener nombres de materiales/nodos para el faldón. Agua/látex y preview existentes no sustituyen simulación. AO suave en GLB; fuente de estudio no simula suciedad física dinámica. Ver geometry-equivalence.json y audit/COORDINACION_PERSONAJES_V3.md.')
    scene=bpy.context.scene;scene.render.filepath=str(OUT/(name+'-preview.png'));scene.render.resolution_percentage=100;scene.cycles.samples=48
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=d.type!='CPU'
        if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
    except Exception:pass
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    (OUT/(name+'-source-equivalence.json')).write_text(json.dumps({'ok':True,'baseline':baseline,'before':before,'after':after,'geometry_uv_weights_rig_pose_exact':True},indent=2))
    print('WD_V3_SOURCE_SAVED',name,before,flush=True)
    if '--no-render' not in sys.argv:
        bpy.ops.render.render(write_still=True)
        # Same studio lights, closer camera for grain and joint inspection.
        target=Vector((.12,-.08,1.54))*(1.15 if name.endswith('-boss') else 1)
        camera=scene.camera;camera.location=target+Vector((2.1,-7.5,1.05));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=1.95 if not name.endswith('-boss') else 2.22
        scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.filepath=str(OUT/(name+'-detail.png'));bpy.ops.render.render(write_still=True)
    print('WD_V3_PREVIEW_DONE',name,flush=True)
