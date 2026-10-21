"""Make the source file pleasant to open without changing the exported model."""
import bpy
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'docs/assets/characters/water-mannequin.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
rig=bpy.data.objects['WD_Mannequin_Rig']
rig.show_in_front=False
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=bpy.data.objects['Torso_Rounded_Beech']
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
text=bpy.data.texts.get('LEEME_WaterDuel') or bpy.data.texts.new('LEEME_WaterDuel')
text.clear()
text.write('''WATERDUEL · Maniquí con cabeza de globo de agua

Referencias: maniquí adjunto + docs/referencias/w1.png, w2.png, w3.png y w4.png.
Se conservan las formas redondeadas y la pose del maniquí original.
W1/W2: globo translúcido, nudo superior, agua y burbujas, madera/latón,
estoque fino con guardamano y empuñadura de cuero, hidráulica visible.
W3: látex y agua separados; variante de estallido en archivo aparte.
W4: hombreras, refuerzos, medallón hidráulico y faldón de taller.

WaterDuel_Character contiene las piezas editables y el rig de 18 huesos.
El rig usa pesos rígidos por pieza. Activa overlays para ver los huesos.
Presentation_Only contiene cámara, suelo y luces; no se exporta al GLB.
Los GLB menta y ámbar agrupan las piezas por material para reducir draws.
Arma opcional: ocultar Rapier_* y Leather_Grip_Wrap_* en la fuente.
En el GLB ocultar los tres nodos Preview_Rapier_* para equipar otra arma.
Los cinco Socket_* están ligados a mano principal, secundaria, cuello y pies.
Z arriba en Blender; el GLB exporta Y arriba y frente +Z. Unidades: metros.

Esta entrega es un asset. No reemplaza aún el render procedural del juego.
El agua en el asset es una malla estática; no contiene simulación de fluidos.
La variante burst representa un instante artístico estático, no una animación.

Recrear: blender --background --factory-startup --python scripts/create-water-mannequin.py
Validar GLB: node scripts/validate-water-mannequin.mjs
Comprobar importación y rig: blender --background --factory-startup --python scripts/check-water-mannequin-import.py
''')
for img in bpy.data.images:
    if img.name.startswith('Beech_Grain'):
        img.filepath='//beech-grain.png'
bpy.context.scene.render.filepath=str(ROOT/'public/assets/characters/water-mannequin/water-mannequin-preview.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(source))
def coordinates(v):return [round(float(c),7) for c in v]
contract={
    'asset':'water-mannequin',
    'source':'docs/assets/characters/water-mannequin.blend',
    'rig':'WD_Mannequin_Rig',
    'units':'metres; authored character height 2.884956, scale to runtime deliberately',
    'source_axes':{'up':'+Z','forward':'-Y','origin':'ground midpoint between feet'},
    'glb_axes':{'up':'+Y','forward':'+Z','conversion':'(x,y,z) Blender becomes (x,z,-y) glTF'},
    'bind_pose':'Artist mannequin attachment: left image arm raised, other forearm across waist; legs mostly straight. Fencing pose requires retargeting.',
    'weighting':'Rigid weight 1.0 per vertex to one bone; no organic blending',
    'animations':[],
    'bones':[
        {'name':b.name,'parent':b.parent.name if b.parent else None,'head_source':coordinates(b.head_local),'tail_source':coordinates(b.tail_local)}
        for b in rig.data.bones
    ],
    'sockets':[],
    'equipment':{'optional_glb_node_prefix':'Preview_Rapier_','source_object_prefixes':['Rapier_','Leather_Grip_Wrap_'],'note':'Preview weapon is an example. Hide or omit these nodes when attaching equipment from Items.'},
    'physics':{'water':'Static closed mesh, separate from latex. No fluid solver or mass-conservation claim.','colliders':'Not authored','burst':'Separate frozen art state; no animation or physical response'},
    'runtime_integration':False,
    'remaining_work':['Retarget into game rig and fencing stance','Runtime GLB loader and material support','Dynamic latex/water rupture integration','Distinct boss silhouette if requested'],
}
bpy.context.view_layer.update()
for obj in bpy.data.collections['WaterDuel_Character'].objects:
    if obj.name.startswith('Socket_'):
        x,y,z=obj.matrix_world.translation
        contract['sockets'].append({'name':obj.name,'bone':obj.parent_bone,'position_source':coordinates((x,y,z)),'position_glb':coordinates((x,z,-y))})
out=ROOT/'public/assets/characters/water-mannequin'
(out/'rig-contract.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2),encoding='utf-8')
info=json.loads((out/'asset-info.json').read_text(encoding='utf-8'))
info['rig_contract']='rig-contract.json'
info['variants']=['water-mannequin.glb','water-mannequin-amber.glb','water-mannequin-burst.glb']
info['reference_mapping']={'attachment':'Rounded wood mannequin and bind pose','w1':'Mint/amber heads, top knots, wooden automaton and rapier','w2':'Waterline/bubbles, brass hinges, leather wrap and hydraulic rods','w3':'Separate static burst variant with latex sheets and water spray','w4':'Shoulder guards, chest reinforcement, crest and sash; not a separate boss model'}
(out/'asset-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
print('WD_SOURCE_FINISHED')
