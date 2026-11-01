"""Separate, material-batched 360-degree workshop extension, in runtime metres.

Blender 5.2: blender -b --factory-startup --python blender/create_workshop_360.py
Then: node scripts/build-workshop-360.mjs --pack-only
No historical scene, mesh, material, texture or camera is opened for writing.
The shipping packer copies the exact protected v3 PBR materials/image bytes.
"""
import bpy
import math
import json
import random
import hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.runtime/workshop-360-1.11'
OUT.mkdir(parents=True, exist_ok=True)
RNG = random.Random(1110360)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
SCENE = bpy.context.scene
SCENE.name = 'WaterDuel | 360 workshop extension only'

KEYS = {
 'wall':'wall-limewash-soot-and-age', 'wood':'walnut-smoke-and-worn-varnish',
 'oak':'oak-aged-endgrain-and-open-pores', 'floor':'walnut-smoke-and-worn-varnish-grain-y-floor',
 'iron':'blackened-iron-worn-workshop-steel', 'brass':'brass-tarnish-patina-polished-edges',
 'copper':'copper-oxidized-plumbing', 'steel':'steel-satin-machined-surface',
 'leather':'leather-oxblood-oil-and-tooling', 'canvas':'canvas-waterduel-deep-forest',
 'paper':'paper-warm-vellum', 'ceramic':'stoneware-chalk-glaze',
 'bulb':'lamp-warm-tungsten-filament', 'glass':'window-cold-diffuse-daylight'
}
CONTRACT = json.loads((ROOT/'public/assets/environment/workshop/asset-contract-v3.json').read_text())
SOURCE = {m['runtimeMaterial']:m for m in CONTRACT['materials']}
GROUPS = {}
COUNTS = {}
ATLAS_PATCHES = {}

def atlas_patch(source):
    """Sample one padded material island, never the atlas's empty black space.

    The original maps are baked object atlases, not repeatable textures. A
    largest-valid-rectangle scan keeps their bytes/materials fully shareable.
    Per-face UV normalization below stays inside this proven safe rectangle.
    """
    filename=source.get('textures',{}).get('basecolor')
    if not filename:return (.1,.1,.9,.9)
    path=ROOT/'public/assets/environment/workshop'/filename
    image=bpy.data.images.load(str(path),check_existing=False)
    width,height=image.size
    values=np.empty(width*height*4,np.float32);image.pixels.foreach_get(values)
    valid=np.max(values.reshape((height,width,4))[:,:,:3],axis=2)>2e-5
    bpy.data.images.remove(image)
    heights=[0]*width;best=(0,0,0,0,0)
    for row in range(height):
        for col in range(width):heights[col]=heights[col]+1 if valid[row,col] else 0
        stack=[]
        for col in range(width+1):
            h=heights[col] if col<width else 0
            while stack and heights[stack[-1]]>h:
                k=stack.pop();left=stack[-1]+1 if stack else 0
                area=heights[k]*(col-left)
                if area>best[0]:best=(area,left,row-heights[k]+1,col,row+1)
            stack.append(col)
    _,left,bottom,right,top=best
    margin=max(2,min(8,(right-left)//8,(top-bottom)//8))
    left+=margin;bottom+=margin;right-=margin;top-=margin
    assert right>left and top>bottom and np.all(valid[bottom:top,left:right]),'No valid atlas patch: '+filename
    rect=(left/width,bottom/height,right/width,top/height)
    ATLAS_PATCHES[source['runtimeMaterial']]={'source':filename,'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'dimensions':[width,height],'validPixelRect':[left,bottom,right,top],'blenderUVRect':rect,
        'gltfUVRect':[rect[0],1-rect[3],rect[2],1-rect[1]],'marginPixels':margin,'emptyPixels':0}
    return rect

def B(p):
    """Runtime Y-up/+Z-front to Blender Z-up/-Y-front. Export inverts once."""
    return (p[0], -p[2], p[1])

def group(key):
    if key not in GROUPS:
        GROUPS[key] = {'verts':[], 'faces':[], 'shades':[]}
    return GROUPS[key]

def geometry(key, verts, faces, shade=None):
    data=group(key);start=len(data['verts'])
    data['verts'].extend(B(v) for v in verts)
    data['faces'].extend(tuple(start+i for i in face) for face in faces)
    tone=RNG.uniform(.79,1.02) if shade is None else shade
    data['shades'].extend([tone]*len(faces))

def box(label, center, size, key='wood', bevel=0):
    COUNTS[label]=COUNTS.get(label,0)+1
    x,y,z=center;hx,hy,hz=[v/2 for v in size]
    vertices=[(x+sx*hx,y+sy*hy,z+sz*hz) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    # Y-up faces are transformed by B, a proper rotation with determinant +1.
    geometry(key,vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

def rod(label, start, end, radius, key='iron', sides=12):
    COUNTS[label]=COUNTS.get(label,0)+1
    a,b=Vector(start),Vector(end);axis=(b-a).normalized()
    seed=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))
    u=axis.cross(seed).normalized();v=axis.cross(u).normalized()
    verts=[]
    for p in (a,b):
        for i in range(sides):
            angle=math.tau*i/sides;verts.append(tuple(p+radius*(u*math.cos(angle)+v*math.sin(angle))))
    faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
    faces.extend((i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides))
    geometry(key,verts,faces)

def ring(label, center, radius, tube, key='brass', axis='z'):
    COUNTS[label]=COUNTS.get(label,0)+1
    verts=[];n,m=20,6
    for i in range(n):
        a=math.tau*i/n
        for j in range(m):
            b=math.tau*j/m;r=radius+tube*math.cos(b)
            q=(r*math.cos(a),r*math.sin(a),tube*math.sin(b))
            if axis=='x':q=(q[2],q[1],q[0])
            if axis=='y':q=(q[0],q[2],q[1])
            verts.append(tuple(center[k]+q[k] for k in range(3)))
    geometry(key,verts,[(i*m+j,((i+1)%n)*m+j,((i+1)%n)*m+(j+1)%m,i*m+(j+1)%m) for i in range(n) for j in range(m)])

FLOOR=-.4186972789
# All new shell geometry lies outside the conservative camera corridor.
box('left outer limewash wall',(-12.14,3.85,4.9),(.28,8.55,22.2),'wall')
box('right outer limewash wall',(12.14,3.85,4.9),(.28,8.55,22.2),'wall')
box('front limewash wall',(0,3.85,16.14),(24,8.55,.28),'wall')
box('outer rear closure',(0,3.85,-6.34),(24,8.55,.28),'wall')
box('left old side return',(-9.4,3.05,-.34),(5.2,7,.24),'wall')
box('right old side return',(9.4,3.05,-.34),(5.2,7,.24),'wall')

# Underlay and restrained plank lines extend around, never over, the v3 floor.
regions=[(-12,-7.7542601,-6.2,16),(7.7542601,12,-6.2,16),(-7.7542601,7.7542601,6.1385475,16)]
for x0,x1,z0,z1 in regions:
    box('floor extension underlay',((x0+x1)/2,FLOOR-.08,(z0+z1)/2),(x1-x0,.16,z1-z0),'floor')
    width=.34;n=math.ceil((x1-x0)/width)
    for i in range(n):
        left=x0+(x1-x0)*i/n;right=x0+(x1-x0)*(i+1)/n
        # Wide boards with irregular butt joints: geometry, not a tiled image.
        z=z0
        while z<z1-1e-6:
            end=min(z1,z+RNG.uniform(2.1,3.8))
            box('aged aisle floorboard',((left+right)/2,FLOOR+.003,(z+end)/2),(right-left-.009,.016,end-z-.012),'floor')
            z=end

# The roof is closed; old v3 joists remain visible as the lower original bays.
for i in range(61):
    x=-12+(i+.5)*24/61
    box('smoked ceiling plank',(x,8.15,4.9),(24/61-.012,.18,22.2),'wood')
for z in (-5.9,-.05,3.8,7.8,11.8,15.7):
    box('full transverse roof timber',(0,7.78,z),(24,.42,.30),'wood')
    for side in (-1,1):
        x=side*11.76
        box('wall oak upright',(x,3.65,z),(.30,8.15,.34),'wood')
        for y in (.35,2.5,5.1,7.5):
            box('wrought post strap',(x-side*.17,y,z),(.055,.17,.42),'iron')
            for dz in (-.14,.14):rod('strap rivet',(x-side*.21,y,z+dz),(x-side*.245,y,z+dz),.029,'brass',8)
        # Knee brace stays at the outer wall, above the declared camera box.
        rod('outer roof knee',(side*11.6,7.35,z),(side*10.75,7.66,z),.11,'wood',8)
for side in (-1,1):
    for y in (.12,1.25,4.1,7.5):
        box('side timber belt',(side*11.89,y,4.9),(.18,.17,22.2),'wood')
    for z in (1.8,5.8,9.8,13.8):
        # Recessed, boarded clerestories give the new walls real depth.
        box('side recessed window',(side*11.97,5.9,z),(.08,1.75,2.4),'glass')
        for dz in (-1.25,1.25):box('window oak jamb',(side*11.80,5.9,z+dz),(.22,2.02,.12),'wood')
        for y in (4.95,5.55,6.2,6.86):box('window iron transom',(side*11.72,y,z),(.055,.05,2.4),'iron')
        for dz in (-.6,0,.6):box('window iron upright',(side*11.72,5.9,z+dz),(.055,1.85,.045),'iron')

# Front wall: a worn service door, deep timber lintel and workshop badge.
box('door shadow reveal',(0,1.66,15.92),(2.95,4.25,.13),'iron')
for i in range(9):box('door reclaimed board',(-1.24+i*.31,1.66,15.79),(.298,4.08,.13),'oak')
for x in (-1.56,1.56):box('door mortised jamb',(x,1.72,15.72),(.22,4.5,.24),'wood')
box('door deep lintel',(0,4.04,15.72),(3.5,.31,.28),'wood')
for y in (.45,2.8):box('door iron cross brace',(0,y,15.67),(2.65,.14,.055),'iron')
rod('door latch plate',(.94,1.35,15.64),(.94,1.35,15.51),.1,'brass',12)
ring('door pull',(.94,1.23,15.48),.12,.024,'iron')
box('front forest textile',(0,5.77,15.86),(3.1,2.35,.05),'canvas')
for x in (-1.58,1.58):rod('banner weighted edge',(x,4.57,15.80),(x,6.97,15.80),.021,'brass',8)
for x in (-.64,.64):
    for dx in (-.34,.34):box('workshop badge upright',(x+dx,5.86,15.77),(.10,.96,.045),'brass')
    box('workshop badge foot',(x,5.35,15.77),(.69,.10,.045),'brass')
    box('workshop badge crown',(x,6.37,15.77),(.69,.10,.045),'brass')

def cabinet(side,z):
    x=side*11.63
    for y in (.65,2.3,3.95):
        box('side storage shelf',(x,y,z),(.62,.14,2.65),'oak')
        for dz in (-1.1,1.1):
            rod('shelf iron bracket',(side*11.95,y-.34,z+dz),(side*11.32,y-.03,z+dz),.025,'iron',8)
        for j in range(6):
            zz=z-1.04+j*.4
            if j%3==0:
                rod('dusty storage tin',(x,y+.1,zz),(x,y+.52,zz),.13,'iron',14)
                rod('tin brass lip',(x,y+.51,zz),(x,y+.54,zz),.14,'brass',14)
            elif j%3==1:
                box('leather workshop ledger',(x,y+.37,zz),(.38,.58,.17),'leather')
                box('ledger page block',(x-side*.02,y+.37,zz),(.37,.49,.11),'paper')
            else:
                box('lidded parts drawer',(x,y+.25,zz),(.39,.34,.28),'wood')
                rod('drawer pull',(side*11.36,y+.26,zz),(side*11.31,y+.26,zz),.035,'brass',8)
for side in (-1,1):
    for z in (1.8,7.4,12.8):cabinet(side,z)
    x=side*8
    for y in (.75,2.3,4.0):
        box('front storage shelf',(x,y,15.58),(3.25,.13,.62),'oak')
        for dx in (-1.25,1.25):rod('front shelf bracket',(x+dx,y-.3,15.95),(x+dx,y,15.28),.028,'iron',8)
        for j in range(7):
            xx=x-1.28+j*.42
            if j%2:
                box('front bound notebook',(xx,y+.35,15.59),(.23,.55,.38),'canvas' if j%3 else 'leather')
                box('front notebook pages',(xx,y+.35,15.55),(.16,.48,.31),'paper')
            else:
                rod('ceramic oil pot',(xx,y+.09,15.58),(xx,y+.42,15.58),.13,'ceramic',14)
                rod('oil pot rim',(xx,y+.41,15.58),(xx,y+.44,15.58),.145,'ceramic',14)

# Tools remain on the outer walls, never in a duelist or camera corridor.
for side in (-1,1):
    x=side*4.5
    box('front tool rack',(x,2.16,15.82),(2.65,.22,.13),'wood')
    for j in range(6):
        xx=x-1.05+j*.42
        rod('tool hanging pin',(xx,2.24,15.72),(xx,2.24,15.57),.027,'brass',8)
        rod('worn tool handle',(xx,1.3,15.62),(xx,2.15,15.62),.044,'oak',10)
        if j%3==0:box('hammer machined head',(xx,1.40,15.60),(.40,.13,.13),'steel')
        elif j%3==1:ring('open wrench head',(xx,1.36,15.60),.10,.025,'steel')
        else:box('screwdriver steel blade',(xx,1.17,15.60),(.048,.28,.03),'steel')
    # Repaired skirting: visible patch boards and short non-floating fasteners.
    for j in range(7):
        xx=side*(2.2+j*.48)
        box('scuffed front skirting repair',(xx,.06,15.90),(.45,.59,.045),'oak')

# Oxidized service plumbing, wheels, collars and two motivated warm practicals.
rod('front high copper main',(-11.5,6.98,15.48),(11.5,6.98,15.48),.067,'copper',14)
for side in (-1,1):
    x=side*10.2
    rod('vertical copper feed',(x,.02,15.55),(x,6.98,15.55),.058,'copper',14)
    for y in (.35,2.5,5.2,6.98):rod('plumbing union',(x,y-.065,15.55),(x,y+.065,15.55),.083,'brass',14)
    ring('service valve wheel',(x,2.8,15.29),.19,.027,'iron')
    for d in (-1,1):rod('valve wheel spoke',(x-.15*d,2.65,15.29),(x+.15*d,2.95,15.29),.018,'iron',8)
    lx=side*6.2
    box('sconce wall base',(lx,5.28,15.85),(.34,.52,.12),'iron')
    rod('sconce curved support',(lx,5.3,15.8),(lx,5.42,15.25),.046,'brass',12)
    # Rounded cage and cap, with the emitter behind the camera-volume boundary.
    rod('sconce tungsten glass',(lx,5.08,15.19),(lx,5.38,15.19),.092,'bulb',16)
    for y in (5.04,5.43):rod('sconce spun cap',(lx,y-.04,15.19),(lx,y+.04,15.19),.23,'brass',20)
    for j in range(8):
        a=math.tau*j/8;dx,dz=.17*math.cos(a),.17*math.sin(a)
        rod('sconce iron safety cage',(lx+dx,5.05,15.19+dz),(lx+dx,5.42,15.19+dz),.012,'iron',6)

# Material groups are the shipping hierarchy. No per-prop nodes/draw calls.
for key,data in GROUPS.items():
    mesh=bpy.data.meshes.new('Workshop360_'+key)
    mesh.from_pydata(data['verts'],[],data['faces']);mesh.update()
    material=bpy.data.materials.new('Workshop v2 PBR | '+KEYS[key]);material.use_nodes=True
    source=SOURCE[material.name]
    patch=atlas_patch(source)
    bsdf=material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=source['baseColorLinear']
    bsdf.inputs['Roughness'].default_value=source['roughness'];bsdf.inputs['Metallic'].default_value=source['metallic']
    material.diffuse_color=source['baseColorLinear']
    mesh.materials.append(material)
    # Each physical face samples only an existing atlas island. These v3 maps
    # are not tileable: world-planar repetition would expose black atlas gaps.
    uv=mesh.uv_layers.new(name='Runtime metres')
    color=mesh.color_attributes.new(name='Workshop patina',type='FLOAT_COLOR',domain='CORNER')
    for polygon,tone in zip(mesh.polygons,data['shades']):
        n=polygon.normal;axis=max(range(3),key=lambda k:abs(n[k]))
        dims=(1,2) if axis==0 else (0,2) if axis==1 else (0,1)
        coords=[mesh.vertices[mesh.loops[loop].vertex_index].co for loop in polygon.loop_indices]
        low=[min(p[k] for p in coords) for k in dims];high=[max(p[k] for p in coords) for k in dims]
        for loop in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[loop].vertex_index].co
            u=(p[dims[0]]-low[0])/max(1e-8,high[0]-low[0]);v=(p[dims[1]]-low[1])/max(1e-8,high[1]-low[1])
            uv.data[loop].uv=(patch[0]+u*(patch[2]-patch[0]),patch[1]+v*(patch[3]-patch[1]))
            # Baked per-piece age/dust variation, no additional texture or pass.
            light=min(1.0,tone+(0.045 if n.z>.5 else 0))
            color.data[loop].color=(light,light*.985,light*.96,1)
    obj=bpy.data.objects.new('Workshop360_'+key,mesh);SCENE.collection.objects.link(obj)
    # Tiny physical bevels give fittings/wood silhouettes a caught highlight.
    # One segment keeps this extension well below its geometry/byte budget.
    if key in {'wood','oak'}:
        bevel=obj.modifiers.new('Worn edge highlight','BEVEL');bevel.width=.009;bevel.segments=1;bevel.affect='EDGES'
        bevel.angle_limit=.55;bevel.limit_method='ANGLE'
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        # Bevel UV extrapolation can cross an atlas margin even though all
        # original face loops were inside it. Keep its new loops in the same
        # safe island; do not expand the receipt or relax the UV guard.
        for loop in obj.data.uv_layers.active.data:
            loop.uv.x=max(patch[0],min(patch[2],loop.uv.x))
            loop.uv.y=max(patch[1],min(patch[3],loop.uv.y))

SCENE['coordinate_contract']='Authored directly in runtime metres; Blender XYZ=(runtime.x,-runtime.z,runtime.y).'
SCENE['historical_v3']='Read-only input. This file contains the new extension exclusively.'
SCENE['camera_interior']=json.dumps({'min':[-10.5,.7745,2.4],'max':[10.5,6.9,14.3]})
SCENE['build_seed']=1110360
SCENE.world.color=(.1,.12,.13)
SCENE.render.engine='CYCLES';SCENE.cycles.samples=24
bpy.context.preferences.filepaths.save_version=0
editable=ROOT/'output/blender/WaterDuel_Workshop360.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(editable))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'workshop-360-geometry.glb'),export_format='GLB',
 use_selection=True,export_yup=True,export_apply=True,export_normals=True,export_texcoords=True,
 export_attributes=True,export_vertex_color='NAME',export_vertex_color_name='Workshop patina',export_materials='EXPORT',export_cameras=False,
 export_lights=False,export_animations=False,export_extras=False)
(OUT/'authoring.json').write_text(json.dumps({'source':str(editable.relative_to(ROOT)).replace('\\','/'),
 'materialKeys':KEYS,'counts':COUNTS,'materialGroups':len(GROUPS),'seed':1110360,'atlasPatches':ATLAS_PATCHES},indent=2))
print('WORKSHOP360_GEOMETRY_READY',len(GROUPS),'material batches',flush=True)
