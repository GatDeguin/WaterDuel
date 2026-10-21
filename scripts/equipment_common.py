"""Blender authoring helpers for the WaterDuel workshop arsenal.

Standalone source models use X across, -Y front, Z along the weapon/up the
shield. Each asset origin is its actual hand grip, in metres.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector
import numpy as np


def make_materials(texture_dir):
    texture_dir = Path(texture_dir)
    texture_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(41024)
    n = 512
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    grain_u = x + .012 * np.sin(y * 17) + .006 * np.sin(y * 39 + x * 9)
    grain = .026*np.sin(grain_u*340 + np.sin(y*18)*1.7)
    grain += .013*np.sin(grain_u*990 + y*4) + rng.normal(0, .006, (n,n))
    grain -= .045*np.maximum(0, np.sin(grain_u*160 + y*3))**18
    pores = rng.normal(0, .014, (n,n)) + .012*np.sin(x*1000)*np.sin(y*1100)
    brushed = .014*np.sin(y*1900 + rng.normal(0,.5,(n,n))) + rng.normal(0,.003,(n,n))

    def image(name, rgba, noncolor=False):
        im = bpy.data.images.new(name, n, n, alpha=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        im.pixels.foreach_set(np.asarray(rgba,dtype=np.float32).ravel())
        im.filepath_raw = str(texture_dir / (name+'.png'))
        im.file_format = 'PNG'
        im.save()
        im.pack()
        return im

    def normal_map(name, height, strength):
        dy, dx = np.gradient(height)
        normals = np.stack((-dx*strength,-dy*strength,np.ones_like(height)),axis=-1)
        normals /= np.linalg.norm(normals,axis=-1,keepdims=True)
        rgba = np.ones((n,n,4));rgba[:,:,:3] = normals*.5+.5
        return image(name,rgba,True)

    wood_pixels = np.ones((n,n,4))
    for i, base in enumerate((.77,.575,.345)):
        wood_pixels[:,:,i] = np.clip(base + grain*(1-i*.15),0,1)
    wood_image = image('Workshop_Beech_BaseColor',wood_pixels)
    wood_normal = normal_map('Workshop_Beech_Normal',grain,4)
    leather_pixels = np.ones((n,n,4))
    for i, base in enumerate((.29,.16,.085)):
        leather_pixels[:,:,i] = np.clip(base+pores,0,1)
    leather_image = image('Workshop_Leather_BaseColor',leather_pixels)
    leather_normal = normal_map('Workshop_Leather_Normal',pores,3)
    steel_normal = normal_map('Workshop_BrushedSteel_Normal',brushed,1.2)

    palette = {
        'wood':((.83,.72,.57),.39,0,wood_image,wood_normal),
        'wood_dark':((.53,.36,.20),.43,0,wood_image,wood_normal),
        'wood_light':((1,.91,.75),.38,0,wood_image,wood_normal),
        'brass':((.63,.36,.105),.27,.86,None,steel_normal),
        'brass_dark':((.27,.155,.045),.40,.78,None,steel_normal),
        'steel':((.59,.69,.71),.23,.94,None,steel_normal),
        'steel_dark':((.14,.195,.20),.36,.85,None,steel_normal),
        'leather':((.91,.82,.73),.52,0,leather_image,leather_normal),
        'leather_edge':((.53,.32,.15),.51,0,None,leather_normal),
        'mint':((.025,.32,.245),.30,.15,None,None),
        'amber':((.58,.18,.035),.31,.15,None,None),
        'enamel_black':((.018,.035,.032),.30,.22,None,None),
        'ivory':((.80,.66,.39),.47,0,None,None),
    }
    materials = {}
    for key,(color,roughness,metal,base,normal) in palette.items():
        mat = bpy.data.materials.new('WD_'+key)
        mat.diffuse_color = (*color,1);mat.use_nodes = True
        tree=mat.node_tree;bs=tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value=(*color,1)
        bs.inputs['Roughness'].default_value=roughness
        bs.inputs['Metallic'].default_value=metal
        if base:
            tex=tree.nodes.new('ShaderNodeTexImage');tex.image=base
            # Multiply the shared natural grain by the part's wood/leather stain.
            mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY'
            mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
            tree.links.new(tex.outputs['Color'],mix.inputs[1]);tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
        if normal:
            tex=tree.nodes.new('ShaderNodeTexImage');tex.image=normal
            nm=tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.40
            tree.links.new(tex.outputs['Color'],nm.inputs['Color']);tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        materials[key]=mat
    return materials


class EquipmentContext:
    def __init__(self,materials):
        self.materials=materials;self.assets=[]

    def new_asset(self,asset_id,label,role='primary'):
        b=Builder(self,asset_id,label,role);self.assets.append(b);return b


class Builder:
    def __init__(self,ctx,asset_id,label,role):
        self.ctx=ctx;self.id=asset_id;self.label=label;self.role=role;self.objects=[];self.sockets=[]
        self.collection=bpy.data.collections.new('Equipment_'+asset_id)
        bpy.context.scene.collection.children.link(self.collection)
        self.root=bpy.data.objects.new('WD_'+asset_id,None);self.collection.objects.link(self.root)
        self.root['asset_id']=asset_id;self.root['label']=label;self.root['role']=role
        self.root['units']='metres';self.root['source_forward']='+Z weapon length, -Y facing'
        self.root['grip_origin']='hand centre';self.root['art_direction']='W1 W2 W3 W4 / handcrafted workshop'

    def finish(self,obj,name,mat=None,bevel=0,smooth=False):
        obj.name=self.id+'__'+name
        for col in list(obj.users_collection):col.objects.unlink(obj)
        self.collection.objects.link(obj);obj.parent=self.root
        if mat:obj.data.materials.append(self.ctx.materials[mat] if isinstance(mat,str) else mat)
        if bevel and obj.type=='MESH':
            mod=obj.modifiers.new('Crafted_Edge_Bevel','BEVEL');mod.width=bevel;mod.segments=2
        if obj.type=='MESH':
            if not obj.data.uv_layers:
                uv=obj.data.uv_layers.new(name='Workshop_UV')
                low=[min(v.co[i] for v in obj.data.vertices) for i in range(3)]
                span=[max(v.co[i] for v in obj.data.vertices)-low[i] for i in range(3)]
                for face in obj.data.polygons:
                    axes=(0,2) if abs(face.normal.y)>.5 else (0,1) if abs(face.normal.z)>.5 else (1,2)
                    for li in face.loop_indices:
                        co=obj.data.vertices[obj.data.loops[li].vertex_index].co
                        u=(co[axes[0]]-low[axes[0]])/max(span[axes[0]],1e-8)
                        if isinstance(mat,str) and mat.startswith('wood'):
                            # Keep grain at timber scale, with one continuous V
                            # tile along a plank and a unique phase per piece.
                            phase=.12+(sum(ord(c) for c in name)%5)*.10
                            u=phase+(co[axes[0]]-low[axes[0]])*2
                        v=(co[axes[1]]-low[axes[1]])/max(span[axes[1]],1e-8)
                        uv.data[li].uv=(u,v)
            if smooth:
                for face in obj.data.polygons:face.use_smooth=True
        self.objects.append(obj);return obj

    def box(self,name,loc,dims,mat,bevel=.002):
        bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
        obj=bpy.context.object;obj.scale=dims
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return self.finish(obj,name,mat,bevel)

    def cylinder(self,name,loc,radius,depth,mat,vertices=24,axis=(0,0,1),radius2=None):
        if radius2 is None:
            bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
        else:
            bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius2,depth=depth,location=loc)
        obj=bpy.context.object;obj.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler()
        return self.finish(obj,name,mat,.0008,True)

    def sphere(self,name,loc,scale,mat,segments=16,rings=8):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
        obj=bpy.context.object;obj.scale=scale
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return self.finish(obj,name,mat,smooth=True)

    def torus(self,name,loc,major,minor,mat,axis=(0,0,1),segments=32,minor_segments=8):
        bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=minor_segments,location=loc,major_radius=major,minor_radius=minor)
        obj=bpy.context.object;obj.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler()
        return self.finish(obj,name,mat,smooth=True)

    def beam(self,name,a,b,radius,mat,vertices=16):
        start,end=Vector(a),Vector(b);delta=end-start
        return self.cylinder(name,(start+end)/2,radius,delta.length,mat,vertices,tuple(delta.normalized()))

    def curve(self,name,points,radius,mat):
        data=bpy.data.curves.new(self.id+'__'+name,'CURVE');data.dimensions='3D';data.resolution_u=1
        data.bevel_depth=radius;data.bevel_resolution=1;data.resolution_u=1
        spline=data.splines.new('POLY');spline.points.add(len(points)-1)
        for point,co in zip(spline.points,points):point.co=(*co,1)
        data.use_fill_caps=True;obj=bpy.data.objects.new(name,data);self.collection.objects.link(obj)
        return self.finish(obj,name,mat)

    def mesh(self,name,verts,faces,mat,bevel=0):
        data=bpy.data.meshes.new(self.id+'__'+name);data.from_pydata(verts,[],faces);data.update()
        obj=bpy.data.objects.new(name,data);self.collection.objects.link(obj)
        return self.finish(obj,name,mat,bevel)

    def profile(self,name,outline,y_front,y_back,mat,bevel=.002):
        if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))<0:
            outline=list(reversed(outline))
        n=len(outline);verts=[(x,y,z) for y in (y_front,y_back) for x,z in outline]
        faces=[tuple(range(n)),tuple(reversed(range(n,n*2)))]
        faces.extend((i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n))
        return self.mesh(name,verts,faces,mat,bevel)

    def socket(self,name,loc):
        obj=bpy.data.objects.new(self.id+'__'+name,None);self.collection.objects.link(obj);obj.parent=self.root;obj.location=loc
        obj.empty_display_type='ARROWS';obj.empty_display_size=.035;obj['socket']=True
        obj['role']='rigid attachment; authored local space'
        obj['socket_name']=name
        self.sockets.append(obj);return obj

    def rivet(self,name,loc,r=.006,mat='brass',axis=(0,-1,0),slot=True):
        direction=Vector(axis).normalized();loc=Vector(loc)
        obj=self.cylinder(name,loc,r,r*.65,mat,16,axis)
        # A single chamfer suits a tiny screw and keeps repeated fittings lean.
        for modifier in obj.modifiers:
            if modifier.type=='BEVEL':modifier.segments=1
        if slot:
            u=direction.cross(Vector((0,0,1)))
            if u.length<.1:u=Vector((1,0,0))
            u.normalize();center=loc+direction*r*.34
            self.beam(name+'_driver_slot',center-u*r*.68,center+u*r*.68,r*.10,'steel_dark',6)
        return obj

    def text(self,name,text,loc,size,mat,rotation=(math.pi/2,0,0)):
        data=bpy.data.curves.new(self.id+'__'+name,'FONT');data.body=text;data.size=size
        data.align_x='CENTER';data.align_y='CENTER';data.extrude=.00015;data.resolution_u=2
        obj=bpy.data.objects.new(name,data);self.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=rotation
        return self.finish(obj,name,mat)
