"""Update embedded source notes and relative packed texture paths for v2 delivery."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/assets/characters/v2'
for variant in ['water-mannequin','water-mannequin-boss','water-mannequin-burst']:
    path=SOURCE/(variant+'.blend');bpy.ops.wm.open_mainfile(filepath=str(path))
    note=bpy.data.texts.get('LEEME_WaterDuel') or bpy.data.texts.new('LEEME_WaterDuel')
    note.clear();note.write('''WATERDUEL · PERSONAJES V2

Revisión pedida: mejorar modelos según w1, w2, w3 y w4.
W1: postura de esgrima, piernas separadas y rodilla delantera flexionada.
W2: madera miel con color/normal/rugosidad, latón satinado, bisagras alineadas,
dedos alrededor de la empuñadura, látex plegado y agua con onda oblicua.
W3: fuente y GLB burst aparte; goma fina curvada y agua con hojas/ligamentos.
W4: jefe independiente con torso ancho, armadura, placa y faldón heráldico.

WaterDuel_Character contiene mallas, rig18 y cinco Socket_* para equipo/pies.
Presentation_Only contiene cámara, luces y suelo; queda fuera del GLB.
En fuente, ocultar Rapier_* y Leather_Grip_Wrap_* para sustituir el estoque.
En GLB, ocultar Preview_Rapier_*; son piezas de equipo de muestra opcionales.
Metros: Blender Z arriba, frente -Y; GLB Y arriba, frente +Z; origen en suelo.
La fuente conserva un esqueleto editable con pose de guardia. El GLB usa
esa guardia como pose de referencia. Consultar rig-contract.json y recibos
*-roundtrip.json para posiciones, pivotes y dimensiones específicas.

Son assets independientes: no sustituyen todavía el renderer del juego.
Agua, látex y faldones son geometría estática. Burst es un instante artístico.
El rig mueve piezas rígidas; no contiene solver de agua ni cuerpos rígidos.
La comprobación de hueso head no certifica todo el rango de articulaciones.

Generación: scripts/improve-water-mannequin-v2.py y scripts/create-water-mannequin-*-v2.py.
QA: scripts/validate-water-mannequin.mjs y scripts/check-water-mannequin-v2.py.
En Blender usar --background --factory-startup --python-exit-code 1.
''')
    for im in bpy.data.images:
        if im.packed_file and (SOURCE/(im.name+'.png')).exists():im.filepath='//'+im.name+'.png'
    bpy.ops.object.select_all(action='DESELECT')
    bpy.data.objects['WD_Mannequin_Rig'].show_in_front=False
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.overlay.show_overlays=False
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    print('WD_V2_DOCUMENTED',variant,flush=True)
