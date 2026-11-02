"""Add workshop construction, original maker stamps and functional engraving.

Run with Blender --background --factory-startup --python this file.
Only v3 namespaces are written. Final GLBs append the new craft layer to the
unchanged v2 binary payload; no original accessor, UV, index or socket changes.
The editable source keeps every new named detail separate from the base model.
"""
import bpy
import copy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/assets/equipment/workshop/v2'
OUT = ROOT / 'public/assets/equipment/workshop/v3'
SOURCE = ROOT / 'docs/assets/equipment/v3'
PREVIEWS = OUT / 'previews'
IDS = ['sword', 'spear', 'axe', 'maul', 'short', 'long', 'knife']
NO_RENDER = '--no-render' in sys.argv
RENDER_FILTER = next((arg.split('=', 1)[1].split(',') for arg in sys.argv if arg.startswith('--render-assets=')), IDS)
TAU = math.pi * 2
EPSILON = .00016
MAKERS = {
    'sword': (0, .140, .0090, .00235),
    'spear': (0, 1.035, .0100, .00235),
    'axe': (.104, .748, .0180, .0035),
    'maul': (.121, .875, .0190, .0038),
    'short': (-.055, .115, .0180, .0035),
    'long': (.120, .078, .0170, .0035),
    'knife': (.0135, .170, .0090, .0022),
}
FEATURES = {
    'sword': ['canales finos de hoja', 'costura reforzada', 'testigos de ajuste de cazoleta'],
    'spear': ['escala de presión grabada', 'testigos de ferrula', 'costura de agarre'],
    'axe': ['testigos de unión del ojo', 'marcas de ensamblaje', 'costura de agarre'],
    'maul': ['referencias de bancada', 'tapones con testa visible', 'arandelas de unión'],
    'short': ['arcos de torneado concéntricos', 'testigos de remachado'],
    'long': ['numeración de duelas', 'tapones con testa visible', 'testigos de unión'],
    'knife': ['arcos de parada', 'costura reforzada', 'testigos de ajuste de guarda'],
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, total = struct.unpack_from('<III', data)
    if magic != 0x46546c67 or version != 2 or total != len(data):
        raise ValueError('Invalid GLB: ' + str(path))
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing JSON chunk')
    gltf = json.loads(data[20:20 + length])
    offset = 20 + length
    size, kind = struct.unpack_from('<II', data, offset)
    if kind != 0x004e4942:
        raise ValueError('Missing BIN chunk')
    return gltf, data[offset + 8:offset + 8 + size]


def write_glb(path, gltf, binary):
    binary += b'\0' * ((-len(binary)) % 4)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    header = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode()
    header += b' ' * ((-len(header)) % 4)
    Path(path).write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(header) + len(binary))
                          + struct.pack('<II', len(header), 0x4e4f534a) + header
                          + struct.pack('<II', len(binary), 0x004e4942) + binary)


def triangles(gltf):
    return sum(gltf['accessors'][p['indices']]['count'] // 3
               for m in gltf.get('meshes', []) for p in m['primitives'])


def append_layer(asset_id, layer_path):
    original, old_bin = read_glb(BASE / (asset_id + '.glb'))
    layer, layer_bin = read_glb(layer_path)
    gltf = copy.deepcopy(original)
    bv_offset = len(gltf.get('bufferViews', []))
    ac_offset = len(gltf.get('accessors', []))
    mesh_offset = len(gltf.get('meshes', []))
    node_offset = len(gltf.get('nodes', []))
    byte_offset = len(old_bin)
    for view in layer.get('bufferViews', []):
        view = copy.deepcopy(view)
        view['buffer'] = 0
        view['byteOffset'] = byte_offset + view.get('byteOffset', 0)
        gltf.setdefault('bufferViews', []).append(view)
    for accessor in layer.get('accessors', []):
        accessor = copy.deepcopy(accessor)
        if 'bufferView' in accessor:
            accessor['bufferView'] += bv_offset
        if 'sparse' in accessor:
            raise ValueError('Unexpected sparse detail accessor')
        gltf.setdefault('accessors', []).append(accessor)
    material_indices = {m['name']: i for i, m in enumerate(original['materials'])}
    remap = {}
    for i, material in enumerate(layer.get('materials', [])):
        name = material['name'].split('.')[0].replace('CraftMat_', '').replace('CraftExport_', '')
        remap[i] = material_indices[name]
    for mesh in layer.get('meshes', []):
        mesh = copy.deepcopy(mesh)
        for primitive in mesh['primitives']:
            primitive['indices'] += ac_offset
            primitive['attributes'] = {k: v + ac_offset for k, v in primitive['attributes'].items()}
            if 'material' in primitive:
                primitive['material'] = remap[primitive['material']]
        gltf.setdefault('meshes', []).append(mesh)
    for node in layer.get('nodes', []):
        node = copy.deepcopy(node)
        if 'mesh' in node:
            node['mesh'] += mesh_offset
        if 'children' in node:
            node['children'] = [i + node_offset for i in node['children']]
        node['extras'] = {**node.get('extras', {}), 'craftLayerV3': True, 'collision': False}
        gltf['nodes'].append(node)
    root_index = next(i for i, n in enumerate(gltf['nodes'][:node_offset])
                      if n.get('name') == 'WD_' + asset_id + '_Asset')
    added_roots = layer['scenes'][layer.get('scene', 0)]['nodes']
    gltf['nodes'][root_index].setdefault('children', []).extend(i + node_offset for i in added_roots)
    gltf.setdefault('asset', {}).setdefault('extras', {})['craftRevision'] = {
        'version': 3, 'maker': 'Taller del Cauce', 'proposals': [34, 36, 37],
        'originalGeometry': 'v2 BIN prefix and original accessors preserved', 'newColliders': False,
    }
    target = OUT / (asset_id + '.glb')
    write_glb(target, gltf, old_bin + layer_bin)
    before, after = triangles(original), triangles(gltf)
    if after > before * 1.15 + 1:
        raise ValueError('%s triangle growth: %d -> %d' % (asset_id, before, after))
    if target.stat().st_size > (BASE / target.name).stat().st_size * 1.25:
        raise ValueError(asset_id + ' exceeds 25% GLB growth')
    return {'id': asset_id, 'triangles_v2': before, 'triangles': after,
            'added_triangles': after - before, 'triangle_growth_pct': (after / before - 1) * 100,
            'bytes_v2': (BASE / target.name).stat().st_size, 'bytes': target.stat().st_size,
            'byte_growth_pct': (target.stat().st_size / (BASE / target.name).stat().st_size - 1) * 100,
            'sha256': sha(target), 'source_sha256': sha(BASE / target.name),
            'new_textures': 0, 'construction': FEATURES[asset_id]}


class CraftLayer:
    def __init__(self, asset_id, root, meshes, collection):
        self.id, self.root, self.collection = asset_id, root, collection
        self.objects, self.mats = [], {}
        verts, faces = [], []
        for obj in meshes:
            offset = len(verts)
            verts.extend(tuple(obj.matrix_world @ v.co) for v in obj.data.vertices)
            faces.extend(tuple(i + offset for i in p.vertices) for p in obj.data.polygons)
        self.bvh = BVHTree.FromPolygons(verts, faces)
        for obj in meshes:
            for mat in obj.data.materials:
                if mat:
                    target = mat.name.split('.')[0]
                    if target not in self.mats:
                        copy_mat = mat.copy(); copy_mat.name = 'CraftMat_' + target
                        self.mats[target] = copy_mat

    def surface(self, x, z):
        hit, normal, index, distance = self.bvh.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)), 6)
        return None if hit is None else (x, hit.y - EPSILON, z)

    def mesh(self, name, points, faces, material):
        verts = [self.surface(x, z) for x, z in points]
        if any(p is None for p in verts):
            print('CRAFT_SKIP_OUTSIDE', self.id, name, flush=True)
            return None
        data = bpy.data.meshes.new('V3_' + self.id + '_' + name)
        data.from_pydata(verts, [], faces); data.update()
        data.materials.append(self.mats['WD_' + material])
        uv = data.uv_layers.new(name='Craft_Surface_UV')
        for face in data.polygons:
            for li in face.loop_indices:
                p = data.vertices[data.loops[li].vertex_index].co
                uv.data[li].uv = (p.x * 20, p.z * 20)
        obj = bpy.data.objects.new('V3_' + self.id + '__' + name, data)
        self.collection.objects.link(obj); obj.parent = self.root
        obj['craft_feature'] = name; obj['collision'] = False
        self.objects.append(obj)
        return obj

    def line(self, name, path, width=.0005, material='steel_dark'):
        # A single straight chord can sink through a convex bowl or ferrule.
        # Resolve surface curvature before projecting each narrow strip quad.
        dense = [path[0]]
        for a, b in zip(path, path[1:]):
            steps = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / .001))
            dense.extend((a[0] + (b[0] - a[0]) * i / steps,
                          a[1] + (b[1] - a[1]) * i / steps) for i in range(1, steps + 1))
        points, faces = [], []
        for a, b in zip(dense, dense[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dz)
            if length < 1e-8:
                continue
            px, pz = -dz / length * width / 2, dx / length * width / 2
            start = len(points)
            points.extend([(a[0] + px, a[1] + pz), (a[0] - px, a[1] - pz),
                           (b[0] - px, b[1] - pz), (b[0] + px, b[1] + pz)])
            faces.append((start, start + 1, start + 2, start + 3))
        return self.mesh(name, points, faces, material) if faces else None

    def arc(self, name, x, z, radius, start=0, end=TAU, width=.0005, material='steel_dark', steps=28):
        points = [(x + radius * math.cos(start + (end - start) * i / steps),
                   z + radius * math.sin(start + (end - start) * i / steps)) for i in range(steps + 1)]
        return self.line(name, points, width, material)

    def text(self, name, label, x, z, size, material='steel_dark'):
        data = bpy.data.curves.new(name, 'FONT'); data.body = label
        data.size = size; data.align_x = 'CENTER'; data.resolution_u = 1; data.extrude = 0
        obj = bpy.data.objects.new(name, data); self.collection.objects.link(obj)
        obj.location = (x, -3, z); obj.rotation_euler = (math.pi / 2, 0, 0)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.ops.object.convert(target='MESH')
        matrix = obj.matrix_world.copy()
        points = [(matrix @ v.co).xzy for v in obj.data.vertices]
        planar = [(p[0], p[1]) for p in points]
        faces = [tuple(p.vertices) for p in obj.data.polygons]
        bpy.data.objects.remove(obj, do_unlink=True)
        return self.mesh(name, planar, faces, material)

    def maker(self):
        x, z, r, size = MAKERS[self.id]
        metal = 'steel_dark' if self.id in ('sword', 'spear', 'maul', 'long', 'knife') else 'brass_dark'
        self.arc('Maker_Outer_Stamp', x, z, r, width=.00045, material=metal, steps=24)
        # Original hydraulic emblem: an open conduit feeds a fork and two waves.
        # It is separate from the pre-existing H crest and creates no faction.
        self.line('Maker_Cauce_Conduit', [(x, z + r * .62), (x, z + r * .08),
                  (x - r * .42, z - r * .26)], r * .055, metal)
        self.line('Maker_Cauce_Fork', [(x, z + r * .08), (x + r * .42, z - r * .26)], r * .055, metal)
        for row in (0, 1):
            zz = z - r * (.40 + row * .20)
            self.line('Maker_Cauce_Wave_' + str(row), [(x - r * .55, zz),
                      (x - r * .18, zz + r * .07), (x + r * .18, zz - r * .04),
                      (x + r * .55, zz + r * .05)], r * .045, metal)
        self.text('Maker_Taller_Del_Cauce', 'TALLER DEL CAUCE', x, z - r - size * 1.7, size, metal)

    def stitches(self, z0=-.080, count=4, spacing=.037):
        for i in range(count):
            z = z0 + i * spacing
            self.line('Construction_Leather_Lockstitch_' + str(i),
                      [(-.009, z - .002), (-.004, z), (-.009, z + .002)], .0007, 'leather_edge')

    def dowel(self, name, x, z, radius=.004):
        ring = [(x + radius * math.cos(i * TAU / 20), z + radius * math.sin(i * TAU / 20)) for i in range(20)]
        self.mesh(name + '_Timber_Plug', [(x, z)] + ring,
                  [(0, i + 1, (i + 1) % 20 + 1) for i in range(20)], 'wood_dark')
        for j, factor in enumerate((.45, .76)):
            self.arc(name + '_Endgrain_Ring_' + str(j), x, z, radius * factor,
                     start=.15, end=TAU - .35, width=.00025, material='wood_light', steps=14)

    def build(self):
        self.maker()
        if self.id == 'sword':
            for side in (-1, 1):
                self.line('Engraving_Fine_Blade_Channel_' + str(side),
                          [(side * .0025, .237), (side * .0024, .310), (side * .0017, .410)], .00028, 'steel_dark')
                self.line('Construction_Cup_Witness_' + str(side),
                          [(side * .052, .125), (side * .056, .132)], .0006, 'steel_dark')
            self.stitches()
        elif self.id == 'spear':
            for i in range(5):
                z = .981 + i * .012
                self.line('Engraving_Pressure_Tick_' + str(i), [(.017, z), (.022 if i % 2 == 0 else .020, z)], .0006, 'brass')
            self.line('Construction_Ferrule_Witness', [(-.012, .935), (-.012, .961)], .0005, 'steel_dark')
            self.stitches(-.085, 4, .044)
        elif self.id == 'axe':
            for i in range(3):
                self.line('Engraving_Eye_Assembly_Mark_' + str(i),
                          [(.057 + i * .006, .663), (.057 + i * .006, .679)], .0007, 'brass_dark')
            for z in (.628, .801):
                self.line('Construction_Eye_Registration_' + str(z), [(-.066, z - .006), (-.061, z), (-.066, z + .006)], .00065, 'brass')
            self.stitches()
        elif self.id == 'maul':
            self.line('Engraving_Bench_Square', [(-.151, .908), (-.151, .846), (-.087, .846)], .0007, 'wood_dark')
            for i in range(4):
                x = -.140 + i * .014
                self.line('Engraving_Bench_Gauge_' + str(i), [(x, .846), (x, .851 if i % 2 else .855)], .00055, 'wood_dark')
            for x in (-.128, .128):
                for z in (.808, .937):
                    self.dowel('Construction_Head_Endgrain_%s_%s' % (x, z), x, z)
            for x in (-.152, .152):
                for z in (.760, .995):
                    self.arc('Construction_Clamp_Washer_%s_%s' % (x, z), x, z, .0114,
                             width=.00055, material='steel_dark', steps=20)
        elif self.id == 'short':
            for radius in (.107, .135, .161):
                for start in (math.radians(167), math.radians(303)):
                    self.arc('Engraving_Turned_Ring_%s_%s' % (radius, start), 0, 0, radius,
                             start, start + .36, .0005, 'brass_dark', steps=9)
            for i in (1, 5, 9, 13):
                a = i * TAU / 16
                self.line('Construction_Rivet_Witness_' + str(i),
                          [(.185 * math.cos(a), .185 * math.sin(a)), (.190 * math.cos(a), .190 * math.sin(a))], .00065, 'brass_dark')
        elif self.id == 'long':
            for i, label in enumerate(('I', 'II', 'III', 'IV', 'V', 'VI', 'VII')):
                self.text('Construction_Duela_Number_' + str(i + 1), label, -.18857 + i * .062857, -.157, .006, 'wood_dark')
            for x in (-.171, .171):
                for z in (-.105, .132):
                    self.dowel('Construction_Duela_Endgrain_%s_%s' % (x, z), x, z)
        elif self.id == 'knife':
            for i, radius in enumerate((.009, .013, .017)):
                self.arc('Engraving_Parry_Arc_' + str(i), 0, .230, radius,
                         math.radians(205), math.radians(335), .0004, 'steel_dark', steps=12)
            for side in (-1, 1):
                self.line('Construction_Guard_Witness_' + str(side),
                          [(side * .031, .087), (side * .035, .091)], .0005, 'steel_dark')
            self.stitches(-.075, 3, .046)


def export_layer(layer):
    collection = bpy.data.collections.new('V3_Export_Temporary')
    bpy.context.scene.collection.children.link(collection)
    bpy.ops.object.select_all(action='DESELECT')
    copies = []
    for source in layer.objects:
        obj = bpy.data.objects.new(source.name + '_Export', source.data.copy())
        collection.objects.link(obj); obj.matrix_world = source.matrix_world.copy()
        obj.select_set(True); copies.append(obj)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join(); joined = bpy.context.object
    joined.name = 'Craft_Detail_' + layer.id
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # PLACEHOLDER omits material assignments in Blender 5.2. Export tiny
    # texture-free named stubs, then remap them to the original v2 materials.
    for index, mat in enumerate(list(joined.data.materials)):
        target = mat.name.split('.')[0].replace('CraftMat_', '')
        stub = bpy.data.materials.new('CraftExport_' + target); stub.use_nodes = True
        p = stub.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = (.15, .15, .15, 1)
        p.inputs['Roughness'].default_value = .4
        joined.data.materials[index] = stub
    path = SOURCE / (layer.id + '-craft-layer.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_apply=True, export_extras=True, export_animations=False, export_yup=True,
        export_materials='EXPORT', export_normals=True, export_texcoords=True,
        export_cameras=False, export_lights=False)
    bpy.data.objects.remove(joined, do_unlink=True); bpy.data.collections.remove(collection)
    return path


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def import_asset(path, collection_name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(set(bpy.data.objects) - before)
    collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(collection)
    for obj in imported:
        for old in list(obj.users_collection): old.objects.unlink(obj)
        collection.objects.link(obj)
    root = next(o for o in imported if o.type == 'EMPTY' and o.parent is None)
    return collection, root, [o for o in imported if o.type == 'MESH']


def plain_material(name, color, roughness=.5, metallic=0):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness; p.inputs['Metallic'].default_value = metallic
    return mat


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def preview_setup():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.11, .14, .13, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    for name, loc, energy, size in [('Key', (-3, -4, 5), 800, 4), ('Fill', (4, -2, 3), 600, 3), ('Rim', (0, 1, 5), 900, 3)]:
        light = bpy.data.lights.new('V3_' + name, 'AREA'); light.energy = energy; light.shape = 'DISK'; light.size = size
        obj = bpy.data.objects.new('V3_' + name, light); scene.collection.objects.link(obj)
        obj.location = loc; aim(obj, (0, 0, 1.5))
    cam = bpy.data.cameras.new('V3_Proof_Camera'); camera = bpy.data.objects.new('V3_Proof_Camera', cam)
    scene.collection.objects.link(camera); cam.type = 'ORTHO'; scene.camera = camera
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGB'
    return camera


def presentation_text(name, text, x, z, size, material):
    data = bpy.data.curves.new(name, 'FONT'); data.body = text; data.size = size
    data.align_x = 'CENTER'; data.resolution_u = 2
    obj = bpy.data.objects.new(name, data); bpy.context.scene.collection.objects.link(obj)
    obj.location = (x, -.30, z); obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.data.materials.append(material)
    return obj


def render_proofs():
    if set(RENDER_FILTER) != set(IDS):
        previous_path = OUT / 'roundtrip-proof.json'
        previous = json.loads(previous_path.read_text(encoding='utf-8'))
        for asset_id in set(IDS) - set(RENDER_FILTER):
            if previous.get('asset_sha256', {}).get(asset_id) != sha(OUT / (asset_id + '.glb')):
                raise ValueError('Unchanged preview cannot be reused for changed GLB: ' + asset_id)
    clear_scene(); camera = preview_setup(); scene = bpy.context.scene
    placements = {'sword': (-1.80, 1.45), 'spear': (-.60, 1.32), 'axe': (.60, 1.45),
                  'maul': (1.80, 1.45), 'short': (-1.35, .42), 'long': (0, .42), 'knife': (1.45, .34)}
    imported = {}
    for asset_id in IDS:
        collection, root, meshes = import_asset(OUT / (asset_id + '.glb'), 'V3_Proof_' + asset_id)
        root.location = (placements[asset_id][0], 0, placements[asset_id][1])
        imported[asset_id] = (collection, root, meshes)
    text_mat = plain_material('V3_Presentation_Brass', (.64, .39, .13), .4, .3)
    labels = []
    labels.append(presentation_text('V3_Board_Title', 'TALLER DEL CAUCE', 0, 3.02, .105, text_mat))
    labels.append(presentation_text('V3_Board_Subtitle', 'CONSTRUCCION / SELLOS / GRABADOS PROPIOS - V3', 0, 2.90, .034, text_mat))
    names = {'sword': 'ESTOQUE', 'spear': 'LANZA', 'axe': 'HACHA', 'maul': 'MAZO A DOS MANOS',
             'short': 'BROQUEL', 'long': 'ESCUDO DE DUELAS', 'knife': 'DAGA DE PARADA'}
    for asset_id in IDS:
        x, z = placements[asset_id]
        zz = .910 if asset_id in IDS[:4] else -.045
        labels.append(presentation_text('V3_Label_' + asset_id, names[asset_id], x, zz, .043, text_mat))
    camera.location = (2.0, -9, 2.75); aim(camera, (0, 0, 1.48)); camera.data.ortho_scale = 5.05
    scene.render.resolution_x = 2200; scene.render.resolution_y = 1500; scene.render.resolution_percentage = 100
    scene.render.filepath = str(OUT / 'workshop-craft-v3-preview.png'); bpy.ops.render.render(write_still=True)
    for obj in labels: obj.hide_render = True
    scene.render.resolution_x = 1100; scene.render.resolution_y = 1100
    for asset_id in IDS:
        if asset_id not in RENDER_FILTER: continue
        for key, (collection, root, meshes) in imported.items(): collection.hide_render = key != asset_id
        x, z, radius, size = MAKERS[asset_id]
        root = imported[asset_id][1]
        target = Vector((x, -.10, z)) + root.location
        camera.location = target + Vector((.03, -2, .03)); aim(camera, target)
        camera.data.ortho_scale = .095 if asset_id in ('sword', 'spear', 'knife') else .145
        scene.render.filepath = str(PREVIEWS / (asset_id + '-maker-detail.png')); bpy.ops.render.render(write_still=True)
    for asset_id, center, scale, suffix in [('sword', (0, -.005, .323), .230, 'channels'),
                                           ('maul', (0, -.16, .875), .620, 'construction'),
                                           ('long', (0, -.09, -.150), .470, 'joints'),
                                           ('knife', (0, -.008, .230), .095, 'parry-arcs')]:
        if asset_id not in RENDER_FILTER: continue
        for key, (collection, root, meshes) in imported.items(): collection.hide_render = key != asset_id
        target = Vector(center) + imported[asset_id][1].location
        camera.location = target + Vector((.025, -2, .025)); aim(camera, target); camera.data.ortho_scale = scale
        scene.render.filepath = str(PREVIEWS / (asset_id + '-' + suffix + '-detail.png')); bpy.ops.render.render(write_still=True)
    proof = {'source': 'Final v3 GLBs reimported into a clean Blender scene', 'assets': IDS,
             'board': 'workshop-craft-v3-preview.png', 'detail_count': len(list(PREVIEWS.glob('*.png'))),
             'texture_max_dimension': 512, 'new_colliders': False,
             'asset_sha256': {asset_id: sha(OUT / (asset_id + '.glb')) for asset_id in IDS}}
    (OUT / 'roundtrip-proof.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    for directory in (OUT, SOURCE, PREVIEWS): directory.mkdir(parents=True, exist_ok=True)
    clear_scene(); bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene; scene.unit_settings.system = 'METRIC'; scene.unit_settings.scale_length = 1
    baseline = {str(p.relative_to(ROOT)): sha(p) for base in (BASE, BASE.parent)
                for p in base.glob('*.glb')}
    reports = []
    for asset_id in IDS:
        collection, root, meshes = import_asset(BASE / (asset_id + '.glb'), 'V3_Editable_' + asset_id)
        layer = CraftLayer(asset_id, root, meshes, collection); layer.build()
        layer_path = export_layer(layer)
        report = append_layer(asset_id, layer_path); report['new_named_details'] = len(layer.objects)
        report['maker_mark'] = {'name': 'Taller del Cauce', 'center_source_xz': list(MAKERS[asset_id][:2]),
                                'radius_m': MAKERS[asset_id][2], 'technique': 'surface-conforming microinlay'}
        reports.append(report)
        print('CRAFT_V3_EXPORTED ' + json.dumps(report, ensure_ascii=False), flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'workshop-craft-v3.blend'))
    contract = json.loads((BASE / 'asset-contract.json').read_text(encoding='utf-8'))
    contract.update({'version': 3, 'asset_set': 'WaterDuel - Taller del Cauce - construccion y grabados v3',
        'date': '2026-11-02', 'source': 'docs/assets/equipment/v3/workshop-craft-v3.blend',
        'author_script': 'scripts/create-equipment-craft-v3.py', 'selected_proposals': [34, 36, 37],
        'runtime_integrated': False, 'manufacturer': {'name': 'Taller del Cauce',
            'emblem': 'Conducto abierto, bifurcacion y dos ondas; original, sin facciones nuevas'},
        'revision_policy': {'original_glb_binary_prefix': 'preserved byte for byte',
            'original_accessors_nodes_sockets': 'preserved; detail nodes appended to existing root',
            'method': 'thin surface-conforming inlays; no base booleans or silhouette edits',
            'surface_offset_m': EPSILON, 'projection_max_segment_m': .001,
            'max_triangle_growth': .15, 'max_glb_growth': .25,
            'new_textures': 0, 'new_colliders': False}})
    by_id = {entry['id']: entry for entry in reports}
    for asset in contract['assets']:
        entry = by_id[asset['id']]
        asset.update({k: entry[k] for k in ('triangles', 'bytes', 'sha256')})
        asset['craft_revision'] = entry
    (OUT / 'asset-contract.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2), encoding='utf-8')
    for path, digest in baseline.items():
        if sha(ROOT / path) != digest: raise ValueError('Baseline changed: ' + path)
    (OUT / 'source-baseline-sha256.json').write_text(json.dumps(baseline, indent=2), encoding='utf-8')
    (OUT / 'growth-report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    readme = '''# Taller del Cauce - v3\n\nPropuestas 34, 36 y 37: detalles de construccion, sello original y motivos funcionales.\n\nLos siete GLB conservan el BIN v2 completo, sus accesores originales, ejes, escala y sockets.\nSolo se anexan capas de microincrustacion proyectadas; no hay cortes booleanos, desplazamiento,\ncolliders nuevos ni integracion automatica con el juego. Los materiales y texturas PBR son los de v2.\n\nLa fuente Blender contiene los originales importados y detalles nuevos con nombres V3_ separados;\nactivar una coleccion V3_Editable_* para editar una pieza en su origen de agarre.\n\nEjecutar el autor con Blender background y luego node scripts/validate-equipment-craft-v3.mjs.\nLos renders se realizan reimportando los GLB finales en una escena limpia.\n'''
    (SOURCE / 'README.md').write_text(readme, encoding='utf-8')
    if not NO_RENDER: render_proofs()


if __name__ == '__main__':
    main()
