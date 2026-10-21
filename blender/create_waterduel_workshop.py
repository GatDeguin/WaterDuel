"""Editable WaterDuel workshop, modeled from the local w1--w4 references.
Run with Blender 5.2: blender -b --factory-startup --python this_file.py
No remote resources or external add-ons are required.
"""
import bpy
import math
import random
import os
import json
import sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'output', 'blender')
os.makedirs(OUT, exist_ok=True)
random.seed(41)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.collections):
    if data.name != 'Collection' and data.users == 0:
        bpy.data.collections.remove(data)
scene = bpy.context.scene
scene.name = 'WATERDUEL | Atelier'
active_collection = None

def collection(name):
    global active_collection
    active_collection = bpy.data.collections.get(name)
    if active_collection is None:
        active_collection = bpy.data.collections.new(name)
        scene.collection.children.link(active_collection)
    print('BUILD_COLLECTION',name,flush=True)
    return active_collection

def link(obj):
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    active_collection.objects.link(obj)
    return obj

def rgb(h):
    if isinstance(h, str):
        h = int(h.lstrip('#'), 16)
    c = [(h >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in c) + (1,)

def basic(name, color, metallic=0, rough=.4):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgb(color)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = rgb(color)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    return mat

def noise(nodes, scale, detail=3):
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = .72
    return n

def ramp(nodes, colors, pos=None):
    r = nodes.new('ShaderNodeValToRGB')
    for e in list(r.color_ramp.elements)[2:]:
        r.color_ramp.elements.remove(e)
    for i,c in enumerate(colors):
        e = r.color_ramp.elements[i] if i < 2 else r.color_ramp.elements.new(i/(len(colors)-1))
        e.position = pos[i] if pos else i / (len(colors)-1)
        e.color = rgb(c)
    return r

def timber(name, colors, wet=False):
    m = basic(name, colors[1], rough=.24 if wet else .39)
    n,l = m.node_tree.nodes,m.node_tree.links
    p = n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord')
    mapping=n.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(1.2,38,23)
    l.new(tc.outputs['Generated'],mapping.inputs[0])
    grain=noise(n,3.6,5); l.new(mapping.outputs[0],grain.inputs['Vector'])
    r=ramp(n,colors,[.16,.51,.86]); l.new(grain.outputs['Fac'],r.inputs[0]); l.new(r.outputs[0],p.inputs['Base Color'])
    pores=noise(n,180,2); l.new(mapping.outputs[0],pores.inputs['Vector'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.24; bump.inputs['Distance'].default_value=.006
    l.new(pores.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs[0],p.inputs['Normal'])
    rough=n.new('ShaderNodeMapRange'); rough.inputs['From Min'].default_value=.1; rough.inputs['From Max'].default_value=.9
    rough.inputs['To Min'].default_value=.13 if wet else .27; rough.inputs['To Max'].default_value=.31 if wet else .53
    l.new(grain.outputs['Fac'],rough.inputs[0]); l.new(rough.outputs[0],p.inputs['Roughness'])
    p.inputs['Coat Weight'].default_value=.68 if wet else .18
    p.inputs['Coat Roughness'].default_value=.12 if wet else .24
    return m

def metal(name, colors, rough=.28, metallic=1):
    m=basic(name,colors[1],metallic,rough)
    n,l=m.node_tree.nodes,m.node_tree.links; p=n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord'); pat=noise(n,5.7,5)
    l.new(tc.outputs['Object'],pat.inputs['Vector'])
    r=ramp(n,colors,[.18,.49,.8]); l.new(pat.outputs['Fac'],r.inputs[0]); l.new(r.outputs[0],p.inputs['Base Color'])
    scratches=noise(n,210,2); l.new(tc.outputs['Object'],scratches.inputs['Vector'])
    b=n.new('ShaderNodeBump'); b.inputs['Strength'].default_value=.16; b.inputs['Distance'].default_value=.0014
    l.new(scratches.outputs['Fac'],b.inputs['Height']); l.new(b.outputs[0],p.inputs['Normal'])
    mr=n.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value=rough*.65; mr.inputs['To Max'].default_value=rough*1.55
    l.new(pat.outputs['Fac'],mr.inputs[0]); l.new(mr.outputs[0],p.inputs['Roughness'])
    return m

def fabric(name,color):
    m=basic(name,color,rough=.78);n,l=m.node_tree.nodes,m.node_tree.links;p=n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord'); woven=noise(n,220,2);l.new(tc.outputs['Generated'],woven.inputs['Vector'])
    b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.32;b.inputs['Distance'].default_value=.0012
    l.new(woven.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],p.inputs['Normal'])
    p.inputs['Sheen Weight'].default_value=.28
    return m

mats={}
mats['oak']=timber('Oak | aged endgrain and open pores',['#302015','#8b592f','#c19457'])
mats['darkwood']=timber('Walnut | smoke and worn varnish',['#100e0b','#3e2819','#765033'])
for i,colors in enumerate([
    ['#402414','#925e32','#bd8c51'],['#352213','#7a4e2a','#c2995f'],
    ['#422c18','#a16f3b','#d2a668'],['#291b10','#714626','#b57e49'],
    ['#47301c','#9d693a','#c89558']]):
    mats['plank'+str(i)]=timber('Stage | wet oak '+str(i+1),colors,True)
mats['brass']=metal('Brass | tarnish, patina, polished edges',['#3a3020','#a47a38','#dfbf71'],.27)
mats['gold']=metal('Gold thread | brushed antique gold',['#705529','#c39a4d','#e1c97c'],.42,.76)
mats['iron']=metal('Blackened iron | worn workshop steel',['#080d0e','#242c2b','#4a5150'],.42)
mats['steel']=metal('Steel | satin machined surface',['#444a4b','#9aa8ab','#d9d8cd'],.25)
mats['copper']=metal('Copper | oxidized plumbing',['#23352b','#7b492b','#b46b3a'],.39)
mats['leather']=fabric('Leather | oxblood oil and tooling','#442419')
mats['green']=fabric('Canvas | WaterDuel deep forest','#123d33')
mats['mint']=basic('Mint | enamel','#4aaf8c',.4,.32)
mats['black']=basic('Carbon black','#090e0e',0,.72)
mats['ceramic']=basic('Stoneware | chalk glaze','#d0b78e',0,.25)
mats['parchment']=basic('Paper | warm vellum','#c2aa7e',0,.83)
mats['ink']=basic('Technical drawing | charcoal ink','#343b36',0,.85)
mats['leaf']=basic('Leaves | dusty wax green','#305637',0,.41)
mats['leaf'].node_tree.nodes.get('Principled BSDF').inputs['Subsurface Weight'].default_value=.07
mats['glass']=basic('Bottle glass | green crown glass','#849b68',0,.14)
gp=mats['glass'].node_tree.nodes.get('Principled BSDF');gp.inputs['Transmission Weight'].default_value=1;gp.inputs['IOR'].default_value=1.46
mats['emission']=basic('Lamp | warm tungsten filament','#ffd4a0',0,.28)
ep=mats['emission'].node_tree.nodes.get('Principled BSDF');ep.inputs['Emission Color'].default_value=rgb('#ffba65');ep.inputs['Emission Strength'].default_value=5
mats['water']=basic('Water | clean surface tension','#d1e5df',0,.025)
wp=mats['water'].node_tree.nodes.get('Principled BSDF');wp.inputs['Transmission Weight'].default_value=1;wp.inputs['IOR'].default_value=1.333
mats['water'].diffuse_color=(.2,.45,.42,1)
mats['wall']=basic('Wall | limewash, soot and age','#343934',0,.89)
n,l=mats['wall'].node_tree.nodes,mats['wall'].node_tree.links;p=n.get('Principled BSDF');tc=n.new('ShaderNodeTexCoord');nn=noise(n,2.3,6);l.new(tc.outputs['Object'],nn.inputs[0]);r=ramp(n,['#191f1b','#3c4036','#636052'],[.1,.5,.9]);l.new(nn.outputs['Fac'],r.inputs[0]);l.new(r.outputs[0],p.inputs['Base Color']);b=n.new('ShaderNodeBump');b.inputs['Distance'].default_value=.038;b.inputs['Strength'].default_value=.5;l.new(nn.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],p.inputs['Normal'])
mats['brick']=basic('Brick | terracotta softened by dust','#655144',0,.88)
for i,c in enumerate(['#4b4238','#6d5848','#735b47','#594d40']): mats['brick'+str(i)]=basic('Brick '+str(i),c,0,.85)
mats['window']=basic('Window | cold diffuse daylight','#b6d0db',0,.4)
p=mats['window'].node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=rgb('#a0bed0');p.inputs['Emission Strength'].default_value=.7
mats['cork']=basic('Cork','#635035',0,.92)

def assign(obj,mat):
    if mat: obj.data.materials.append(mat)
    return obj

def bevelobj(obj,amount,segments=3):
    if amount>0:
        mod=obj.modifiers.new('Soft worn edges','BEVEL');mod.width=amount;mod.segments=segments
    if obj.type=='MESH':
        for poly in obj.data.polygons: poly.use_smooth=True
        try:
            mod=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
        except Exception: pass
    return obj

def box(name,loc,size,mat,bevel=.02,rotation=None):
    x,y,z=[s/2 for s in size]
    data=bpy.data.meshes.new(name)
    data.from_pydata([(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],[],[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    data.update();o=bpy.data.objects.new(name,data);o.location=loc;active_collection.objects.link(o)
    if rotation:o.rotation_euler=rotation
    link(o);assign(o,mat);bevelobj(o,min(bevel,min(size)*.23))
    return o

def cyl(name,loc,r,depth,mat,rotation=None,vertices=48):
    n=vertices;verts=[]
    for z in [-depth/2,depth/2]:
        for k in range(n):
            t=math.tau*k/n;verts.append((r*math.cos(t),r*math.sin(t),z))
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    faces.extend((k,(k+1)%n,(k+1)%n+n,k+n) for k in range(n))
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);o.location=loc;active_collection.objects.link(o)
    if rotation:o.rotation_euler=rotation
    link(o);assign(o,mat);bevelobj(o,min(r*.09,.012),2)
    return o

sphere_cache={}
def uv(name,loc,scale,mat):
    key=mat.name
    if key not in sphere_cache:
        verts=[(0,0,-1)];faces=[];seg=32;rings=16
        for j in range(1,rings):
            phi=-math.pi/2+math.pi*j/rings
            for k in range(seg):
                t=math.tau*k/seg;verts.append((math.cos(phi)*math.cos(t),math.cos(phi)*math.sin(t),math.sin(phi)))
        top=len(verts);verts.append((0,0,1))
        for k in range(seg):faces.append((0,1+(k+1)%seg,1+k))
        for j in range(rings-2):
            for k in range(seg):
                a=1+j*seg+k;b=1+j*seg+(k+1)%seg;faces.append((a,b,b+seg,a+seg))
        for k in range(seg):faces.append((top,1+(rings-2)*seg+k,1+(rings-2)*seg+(k+1)%seg))
        data=bpy.data.meshes.new('Shared sphere | '+key);data.from_pydata(verts,[],faces);data.update();data.materials.append(mat)
        for p in data.polygons:p.use_smooth=True
        sphere_cache[key]=data
    o=bpy.data.objects.new(name,sphere_cache[key]);o.location=loc;o.scale=scale;active_collection.objects.link(o)
    return o

def torus(name,loc,major,minor,mat,rotation=None):
    verts=[];faces=[];n=48;s=10
    for j in range(n):
        a=math.tau*j/n
        for k in range(s):
            b=math.tau*k/s;rad=major+minor*math.cos(b);verts.append((rad*math.cos(a),rad*math.sin(a),minor*math.sin(b)))
    for j in range(n):
        for k in range(s):faces.append((j*s+k,((j+1)%n)*s+k,((j+1)%n)*s+(k+1)%s,j*s+(k+1)%s))
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);o.location=loc;active_collection.objects.link(o)
    if rotation:o.rotation_euler=rotation
    link(o);assign(o,mat)
    for p in o.data.polygons:p.use_smooth=True
    return o

def rod(name,a,b,r,mat):
    d=Vector(b)-Vector(a);o=cyl(name,(Vector(a)+Vector(b))/2,r,d.length,mat,vertices=20)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return o

def curve(name,points,r,mat):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=12
    data.bevel_depth=r;data.bevel_resolution=2
    spl=data.splines.new('POLY');spl.points.add(len(points)-1)
    for p,co in zip(spl.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,data);active_collection.objects.link(o);assign(o,mat)
    return o

def mesh(name,verts,faces,mat):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);active_collection.objects.link(o);assign(o,mat)
    for p in data.polygons:p.use_smooth=True
    return o

def text(name,body,loc,size,mat,rotation=(math.pi/2,0,0),align='CENTER'):
    data=bpy.data.curves.new(name,'FONT');data.body=body;data.align_x=align;data.size=size;data.extrude=.0006;data.bevel_depth=.0003
    o=bpy.data.objects.new(name,data);o.location=loc;o.rotation_euler=rotation;active_collection.objects.link(o);assign(o,mat)
    return o

def area(name,loc,target,power,color,size,shape='DISK',size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=rgb(color)[:3];data.shape=shape;data.size=size
    if shape=='RECTANGLE':data.size_y=size_y or size
    o=bpy.data.objects.new(name,data);active_collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    return o

def point(name,loc,power,color,radius=.12):
    data=bpy.data.lights.new(name,'POINT');data.energy=power;data.color=rgb(color)[:3];data.shadow_soft_size=radius
    o=bpy.data.objects.new(name,data);active_collection.objects.link(o);o.location=loc
    return o

def camera(name,loc,target,lens,focus=None,fstop=5.6):
    data=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,data);active_collection.objects.link(o)
    o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();data.lens=lens;data.clip_end=200
    data.dof.use_dof=True;data.dof.focus_distance=(Vector(focus or target)-o.location).length;data.dof.aperture_fstop=fstop
    return o

# Architecture. All units are metres; the design is an oversized artisan workbench.
collection('01 | Architecture / timber and masonry')
box('Workshop floor',(0,3,-.20),(24,25,.4),mats['darkwood'],.025)
box('Sooted limewash back wall',(0,8.15,5.5),(22,.38,11.6),mats['wall'],.06)
for side in (-1,1):
    box('Side workshop wall',(side*10.5,4.4,5.5),(.35,8,11.6),mats['wall'],.06)
    for x in [side*2,side*7.9,side*10.1]:
        box('Structural oak upright',(x,7.82,5.2),(.28,.4,10.7),mats['darkwood'],.025)
        for z in [1.1,3.5,7.5,9.5]:
            box('Iron column strap',(x,7.57,z),(.36,.07,.19),mats['iron'],.012)
            for dx in (-.115,.115):cyl('Strap rivet',(x+dx,7.52,z),.028,.035,mats['brass'],(math.pi/2,0,0),16)
for z in [2.7,7.8,10.3]:
    box('Back wall long beam',(0,7.68,z),(21.3,.5,.27),mats['darkwood'],.025)
for x in (-9,-4.5,0,4.5,9):
    box('Ceiling joist',(x,3.0,10.4),(.25,12,.36),mats['darkwood'],.03)
    rod('Diagonal timber bracket',(x,6.1,9.1),(x,7.8,10.25),.12,mats['darkwood'])
# Exposed low brick courses, with deliberate missing/crooked bricks.
for row in range(6):
    z=.18+row*.29
    for j in range(37):
        x=-10.7+j*.59+(row%2)*.3
        box('Exposed handmade brick',(x,7.88,z),(.565,.17,.262),mats['brick'+str(random.randrange(4))],.023)
# High iron studio windows with recessed panes and separate reveals.
collection('02 | Tall studio windows')
for wi,x in enumerate([-4.65,4.65]):
    box('Window deep reveal',(x,7.77,6.3),(3.35,.17,7.18),mats['black'],.02)
    for col in range(4):
        for row in range(8):
            px=x-1.36+col*.907;pz=3.2+row*.88
            pane=box('Old daylight glass',(px,7.65,pz),(.855,.05,.82),mats['window'],.009)
    for dx in [-1.81,-.91,0,.91,1.81]:
        box('Slim iron window mullion',(x+dx,7.53,6.28),(.07,.16,7.12),mats['iron'],.009)
    for row in range(9):
        box('Window transom',(x,7.52,2.76+row*.88),(3.70,.17,.061),mats['iron'],.009)
    box('Oak window sill',(x,7.42,2.7),(3.96,.54,.17),mats['darkwood'],.027)
# Side panels / cabinetry and elevated gallery from w4.
collection('03 | Gallery and pipework')
for side in [-1,1]:
    x=side*8.7
    box('Gallery deck',(x,6.35,7.15),(3.5,2.35,.24),mats['darkwood'],.03)
    for xx in [side*7.15,side*8.0,side*8.85,side*9.7,side*10.1]:
        rod('Gallery spindle',(xx,5.22,7.25),(xx,5.22,8.17),.033,mats['iron'])
        uv('Gallery finial',(xx,5.22,8.18),(.058,.058,.058),mats['brass'])
    rod('Gallery top rail',(side*7.0,5.22,8.19),(side*10.25,5.22,8.19),.065,mats['darkwood'])
    rod('Gallery lower rail',(side*7.0,5.22,7.5),(side*10.25,5.22,7.5),.026,mats['iron'])
    for z in [3.3,5.1,9.1]:
        rod('Horizontal copper pipe',(side*7.15,7.35,z),(side*10.15,7.35,z),.058,mats['copper'])
        for xx in [side*7.45,side*9.7]:
            cyl('Pipe union',(xx,7.35,z),.086,.12,mats['brass'],(0,math.pi/2,0),24)
    rod('Vertical plumbing',(side*9.85,7.35,.3),(side*9.85,7.35,9.1),.067,mats['copper'])
    for z in [2.0,4.7,8.6]:
        torus('Valve wheel',(side*9.85,7.14,z),.2,.027,mats['iron'],(math.pi/2,0,0))
        for angle in [0,math.pi/2]:
            rod('Valve wheel spoke',(side*9.85-math.cos(angle)*.18,7.14,z-math.sin(angle)*.18),(side*9.85+math.cos(angle)*.18,7.14,z+math.sin(angle)*.18),.015,mats['iron'])
# A long high shelf behind banners, with irregular workshop storage.
for z in [2.08,4.95,9.15]:
    for sx in [-8.7,8.7]:
        box('Wall shelf',(sx,7.14,z),(2.6,.85,.11),mats['oak'],.012)
        for k in range(8):
            x=sx-1.05+k*.30
            if k%3==0:
                cyl('Dusty tins',(x,7.15,z+.28),.11,.43,mats['iron'],vertices=24)
                cyl('Tin lip',(x,7.15,z+.50),.116,.025,mats['brass'],vertices=24)
            else:
                box('Workshop ledger',(x,7.20,z+.32),(.18,.34,.50+random.random()*.2),mats['leather'] if k%2 else mats['green'],.006,rotation=(0,random.uniform(-.08,.08),0))

# Primary wet arena: separate irregular boards, nail heads, joinery and brass clamps.
collection('04 | Arena / hand planed wet oak')
box('Workbench solid apron',(0,0,.63),(12.15,5.45,.55),mats['darkwood'],.075)
box('Table top substrate',(0,0,.97),(11.95,5.28,.21),mats['oak'],.045)
for j in range(17):
    y=-2.45+j*.306
    # Staggered plank ends and narrow dark joints are physical geometry.
    split=(-1.5 if j%2 else 1.8)+random.uniform(-.7,.7)
    for a,b in [(-5.88,split-.009),(split+.009,5.88)]:
        top=1.149+random.uniform(-.001,.001)
        box('Oak board %02d'%j,((a+b)/2,y,top-.04),(b-a,.294,.08),mats['plank'+str((j+int(a))%5)],.012)
        for x in [a+.11,b-.11]:
            cyl('Dark nail with patina',(x,y-.081,top+.001),.017,.007,mats['iron'],vertices=16)
            box('Nail screwdriver slit',(x,y-.081,top+.005),(.019,.003,.0015),mats['black'],.0002)
for y in [-2.72,2.72]:
    box('Worn brass table edge',(0,y,.98),(12.2,.075,.16),mats['brass'],.018)
    for x in [-5.88,-3.6,-1.3,1.3,3.6,5.88]:
        cyl('Apron rivet',(x,y-.047,.97),.048,.024,mats['brass'],(math.pi/2,0,0),24)
for x in [-6.03,6.03]:box('Brass short table edge',(x,0,.98),(.07,5.45,.16),mats['brass'],.016)
for x in [-5.65,-3.9,3.9,5.65]:
    for y in [-2.76,2.76]:
        box('Heavy corner clamp',(x,y,.85),(.24,.11,.62),mats['brass'],.022)
        for z in [.65,1.03]:cyl('Clamp bolt',(x,y-.075,z),.054,.035,mats['iron'],(math.pi/2,0,0),6)
for x in [-4.8,4.8]:
    for y in [-1.9,1.9]:
        box('Workbench oak leg',(x,y,.05),(.44,.48,1.6),mats['darkwood'],.04)
    rod('Under table cross brace',(x,-2,.0),(x,2,.0),.13,mats['darkwood'])
# Foreground clapboard face and green fabric panels are handled by decor module.
box('Front apron inner bevel',(0,-2.77,.5),(11.7,.12,.14),mats['darkwood'],.025)

collection('05 | Water / puddles, droplets and rings')
# Thin nonuniform menisci sit on real wet boards; no transparent flat image.
for i in range(30):
    x=random.uniform(-5.55,5.55);y=random.uniform(-2.38,2.3)
    rx=random.uniform(.12,.67);ry=random.uniform(.05,.29);count=48
    ring=[]
    for j in range(count):
        t=j*2*math.pi/count;r=1+.10*math.sin(t*3+i)+.06*math.cos(t*7+i*2)
        ring.append((x+math.cos(t)*rx*r,y+math.sin(t)*ry*r,1.15+.0015*math.sin(t*2)))
    verts=[(x,y,1.154)]+ring+[(px,py,pz-.008) for px,py,pz in ring]
    faces=[(0,j+1,(j+1)%count+1) for j in range(count)]
    faces.extend((j+1,(j+1)%count+1,(j+1)%count+1+count,j+1+count) for j in range(count))
    faces.append(tuple(range(count+1,count*2+1)))
    mesh('Water pooled between the grain',verts,faces,mats['water'])
# Shared droplet mesh keeps the file compact.
prototype=uv('Surface tension drop 000',(0,0,1.155),(.018,.018,.008),mats['water'])
for i in range(280):
    o=bpy.data.objects.new('Surface tension drop %03d'%(i+1),prototype.data);active_collection.objects.link(o)
    r=random.uniform(.007,.034);o.location=(random.uniform(-5.7,5.7),random.uniform(-2.36,2.36),1.15+r*.25);o.scale=(r,r*random.uniform(.7,1.2),r*.45)
for x,y in [(-3.4,-1.7),(2.6,-1.25),(4.8,.7)]:
    for r in [.12,.20,.29]:
        o=torus('Capillary ripple',(x,y,1.157),r,.002,mats['water']);o.scale.y=.65

# Lamps are modeled as open spun brass shades, not closed cylinders.
collection('06 | Lamps / spun brass and tungsten')
def pendant(x,y,z,r):
    rod('Pendant cable',(x,y,z+.1),(x,y,10.4),.017,mats['black'])
    cyl('Shade cap',(x,y,z+.3),.09,.24,mats['brass'])
    profile=[(.08,.30),(.18,.24),(.28,.15),(.46,-.02),(.61,-.16),(.65,-.18)]
    verts=[]
    for radius,h in profile:
        for k in range(64):
            a=k*math.tau/64;verts.append((x+radius*r*math.cos(a),y+radius*r*math.sin(a),z+h*r))
    faces=[]
    for j in range(len(profile)-1):
        for k in range(64):faces.append((j*64+k,j*64+(k+1)%64,(j+1)*64+(k+1)%64,(j+1)*64+k))
    o=mesh('Spun brass reflector',verts,faces,mats['brass']);sol=o.modifiers.new('Sheet metal thickness','SOLIDIFY');sol.thickness=.014
    torus('Rolled shade rim',(x,y,z-.18*r),.65*r,.018,mats['brass'])
    uv('Tungsten frosted envelope',(x,y,z-.17*r),(.10,.10,.19),mats['emission'])
    cyl('Bulb socket',(x,y,z+.025*r),.065,.13,mats['iron'])
    point('Practical warm bulb',(x,y,z-.36*r),65,'#ffbb73',.16)
    area('Shade downlight',(x,y,z-.30*r),(x,y,1.15),550,'#ffd3a0',1.4)
for v in [(-4.35,3.6,6.75,1.25),(4.25,3.7,7.1,1.35),(0,6.4,8.9,1.05),(-8.4,6,8.8,.8)]:pendant(*v)
for x in [-8,-6.6,-2.6,2.6,6.6,8]:
    z=2.5 if abs(x)>6 else 3.0;y=6.9
    box('Sconce wall mount',(x,y+.25,z-.2),(.16,.07,.30),mats['iron'],.02)
    rod('Sconce swept bracket',(x,y+.2,z-.25),(x,y-.12,z-.2),.025,mats['brass'])
    cyl('Sconce base',(x,y-.14,z-.18),.11,.08,mats['brass'])
    uv('Sconce flame glass',(x,y-.14,z),(.065,.065,.19),mats['emission'])
    point('Background amber pool',(x,y-.22,z+.05),24,'#ffb660',.16)

# Specialist authored props share these native helpers and material datablocks.
api={name:globals()[name] for name in ['box','cyl','uv','torus','rod','curve','mesh','text','collection']}
api['mats']=mats
for fname,entry in [('workshop_props.py','build_workshop_props'),('workshop_decor.py','build_workshop_decor')]:
    namespace={}
    with open(os.path.join(os.path.dirname(__file__),fname),encoding='utf-8') as f:exec(compile(f.read(),fname,'exec'),namespace)
    print(entry,namespace[entry](api),flush=True)

# Motivated photographic lighting. Warm key + broad cool window fills.
collection('07 | Lighting / warm practicals and cool daylight')
area('Key | warm workshop softbox',(-3.5,-2.5,7.8),(0,0,1.2),1700,'#ffdbad',5,'RECTANGLE',3)
area('Left tall window | blue bounce',(-4.65,7.05,6.4),(-2,0,1.8),2600,'#b7d6f1',3,'RECTANGLE',6)
area('Right tall window | blue rim',(4.65,7.05,6.8),(2,-1,1.5),3200,'#bdd9f0',3,'RECTANGLE',6)
area('Right table glancing reflection',(6,1.5,4),(-1,-1,1.1),950,'#ffd4a0',3,'RECTANGLE',2)
area('Soft front return',(0,-8,5.5),(0,1,2.4),420,'#c8dbd9',6,'RECTANGLE',4)
area('Back banner wash',(-1,4.7,7.7),(0,7.4,6.3),160,'#ffd09b',2.4)
world=bpy.data.worlds.new('Workshop dusk outside') if not scene.world else scene.world
scene.world=world;world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=rgb('#8ca1af');world.node_tree.nodes.get('Background').inputs[1].default_value=.15

collection('08 | Cameras')
main=camera('01 | Duel view / w1',(0,-15.8,4.8),(0,1.4,2.65),40,focus=(0,.4,1.5),fstop=6.3)
wide=camera('02 | Grand atelier / w4',(9.8,-16.7,7.1),(-.8,3,4.5),37,focus=(0,3,4),fstop=8)
detail=camera('03 | Wet oak / material study',(-6.7,-8.8,3.7),(0,1.2,2.2),52,focus=(-2,0,1.2),fstop=3.2)
scene.camera=main

# Store the supplied source references in a separate hidden collection and pack them.
collection('09 | References w1 w2 w3 w4 / hidden in render')
for i in range(1,5):
    path=os.path.join(ROOT,'docs','referencias','w%d.png'%i)
    img=bpy.data.images.load(path,check_existing=True);img.pack()
    obj=bpy.data.objects.new('w%d | reference only'%i,None);obj.empty_display_type='IMAGE';obj.data=img;obj.empty_display_size=4;obj.location=(-15,(i-1)*5,3)
    active_collection.objects.link(obj);obj.hide_render=True;obj.hide_viewport=True

collection('10 | Scene notes')
scene['Art direction']='WaterDuel | photorealistic workshop environment, based on local w1, w2, w3 and w4. Empty dueling stage; editable geometry, no background image.'
scene['References']='w1 / workshop duel; w2 / material closeup; w3 / wet deck; w4 / upper workshop gallery'
scene['Delivery']='Cycles, packed source reference images, procedural native PBR materials, 3 cameras. No third-party assets.'
scene['Build script']='blender/create_waterduel_workshop.py + workshop_props.py + workshop_decor.py'
scene.unit_settings.system='METRIC'
scene.render.engine='CYCLES';scene.cycles.samples=160;scene.cycles.use_denoising=True
scene.cycles.preview_samples=24
scene.cycles.max_bounces=10;scene.cycles.transmission_bounces=8;scene.cycles.transparent_max_bounces=8
scene.cycles.adaptive_threshold=.025
scene.cycles.sample_clamp_indirect=4
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=(d.type=='OPTIX')
    scene.cycles.device='GPU'
except Exception as e:print('CPU fallback:',e,flush=True)
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
scene.view_settings.view_transform='AgX'
try:scene.view_settings.look='AgX - Medium High Contrast'
except Exception:pass
scene.view_settings.exposure=.5
scene.render.film_transparent=False
# Gentle glare from the practical bulbs. No artificial lens dirt.
nt=bpy.data.node_groups.new('WaterDuel | optical finishing','CompositorNodeTree')
scene.compositing_node_group=nt
nt.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
rl=nt.nodes.new('CompositorNodeRLayers');glare=nt.nodes.new('CompositorNodeGlare')
glare.inputs['Type'].default_value='Fog Glow';glare.inputs['Quality'].default_value='High'
glare.inputs['Threshold'].default_value=2.0;glare.inputs['Strength'].default_value=.22
comp=nt.nodes.new('NodeGroupOutput');nt.links.new(rl.outputs['Image'],glare.inputs['Image']);nt.links.new(glare.outputs['Image'],comp.inputs['Image'])
# Save a useful camera view when the file is opened interactively.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT')
manifest={'objects':len(scene.objects),'mesh_objects':sum(o.type=='MESH' for o in scene.objects),'materials':len(bpy.data.materials),'cameras':[o.name for o in scene.objects if o.type=='CAMERA'],'references_packed':4,'renderer':'Cycles / OPTIX','geometry':'fully editable','version':bpy.app.version_string}
with open(os.path.join(OUT,'scene_manifest.json'),'w',encoding='utf-8') as f:json.dump(manifest,f,indent=2,ensure_ascii=False)
blendpath=os.path.join(OUT,'WaterDuel_Atelier.blend')
scene.render.filepath=os.path.join(OUT,'WaterDuel_Atelier_duelo.png')
bpy.ops.wm.save_as_mainfile(filepath=blendpath)
print('SCENE_READY',json.dumps(manifest),flush=True)
# A small Cycles proof lets composition be checked before the final render.
scene.render.resolution_percentage=50;scene.cycles.samples=32
scene.render.filepath=os.path.join(OUT,'preview_duelo.png')
bpy.ops.render.render(write_still=True)
print('PREVIEW_READY',flush=True)
