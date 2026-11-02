"""Open only the historical-facade bay in the protected 360-degree extension.

Run in Blender 5.2 background mode to also create the optional editable .blend:
  blender -b --factory-startup --python scripts/create-workshop-360-v4.py

The GLB change is an exact constructive box-minus-aperture operation. Only the
12 triangles of ``outer rear closure`` in Workshop360_wall are replaced by a
closed aperture frame. Original binary data stays as the unchanged prefix;
14 material definitions, 33 embedded image payloads, all other primitives,
and every unselected wall triangle retain their original bytes/attributes.
No old GLB, old contract, old .blend, engine code or GUI state is changed.
"""

import copy
import hashlib
import json
import math
import struct
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "public/assets/environment/workshop"
OLD_GLB = FOLDER / "workshop-360.glb"
OLD_JSON = FOLDER / "workshop-360.json"
NEW_GLB = FOLDER / "workshop-360-v4.glb"
NEW_JSON = FOLDER / "workshop-360-v4.json"
NEW_BLEND = ROOT / "output/blender/WaterDuel_Workshop360_v4.blend"
OLD_SHA256 = "18a1d202cee0b05b0b627880e775906350b877bf6e159099d607d0c70575e7d2"
OPENING = {"min": [-7.11, -0.419, -6.480000019073486],
           "max": [7.11, 6.885, -6.199999809265137]}
TYPE_SIZE = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
COMPONENT = {5121: ("B",1), 5123: ("H",2), 5125: ("I",4), 5126: ("f",4)}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(path):
    raw=Path(path).read_bytes()
    magic,version,length=struct.unpack_from("<III",raw,0)
    assert magic==0x46546C67 and version==2 and length==len(raw)
    json_length,json_type=struct.unpack_from("<II",raw,12)
    assert json_type==0x4E4F534A
    document=json.loads(raw[20:20+json_length])
    binary_length,binary_type=struct.unpack_from("<II",raw,20+json_length)
    assert binary_type==0x004E4942
    binary=raw[28+json_length:28+json_length+binary_length]
    return document,binary,raw


def read_accessor(document,binary,index):
    accessor=document["accessors"][index]
    assert not accessor.get("sparse")
    view=document["bufferViews"][accessor["bufferView"]]
    code,size=COMPONENT[accessor["componentType"]]
    count=TYPE_SIZE[accessor["type"]]
    stride=view.get("byteStride",count*size)
    offset=view.get("byteOffset",0)+accessor.get("byteOffset",0)
    return [struct.unpack_from("<"+code*count,binary,offset+i*stride)
            for i in range(accessor["count"])]


def pack_glb(document,binary):
    data=json.dumps(document,separators=(",",":"),ensure_ascii=False).encode("utf-8")
    data+=b" "*((-len(data))%4)
    binary+=b"\0"*((-len(binary))%4)
    return (struct.pack("<IIIII",0x46546C67,2,28+len(data)+len(binary),
                        len(data),0x4E4F534A)+data+
            struct.pack("<II",len(binary),0x004E4942)+binary)


def sub(a,b):
    return tuple(a[i]-b[i] for i in range(3))


def cross(a,b):
    return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])


def dot(a,b):
    return sum(a[i]*b[i] for i in range(3))


def ray_triangle(origin,direction,triangle,max_distance):
    a,b,c=triangle
    ab,ac=sub(b,a),sub(c,a)
    h=cross(direction,ac)
    determinant=dot(ab,h)
    if abs(determinant)<1e-10:
        return None
    inv=1/determinant
    displacement=sub(origin,a)
    u=inv*dot(displacement,h)
    if u < -1e-8 or u > 1+1e-8:
        return None
    q=cross(displacement,ab)
    v=inv*dot(direction,q)
    if v < -1e-8 or u+v > 1+1e-8:
        return None
    distance=inv*dot(ac,q)
    return distance if 1e-7<distance<=max_distance else None


def triangles(document,binary):
    result=[]
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            vertices=read_accessor(document,binary,primitive["attributes"]["POSITION"])
            indices=[row[0] for row in read_accessor(document,binary,primitive["indices"])]
            result.extend(tuple(vertices[indices[i+j]] for j in range(3))
                          for i in range(0,len(indices),3))
    return result


def image_hashes(document,binary):
    result=[]
    for image in document.get("images",[]):
        view=document["bufferViews"][image["bufferView"]]
        offset=view.get("byteOffset",0)
        result.append(sha(binary[offset:offset+view["byteLength"]]))
    return result


def make_frame(source_positions,source_normals,source_colors,selected,uv_rect):
    closure_points=[source_positions[i] for i in selected]
    low=[min(p[k] for p in closure_points) for k in range(3)]
    high=[max(p[k] for p in closure_points) for k in range(3)]
    ox0,oy0,zback=low
    ox1,oy1,zfront=high
    ix0,iy0=OPENING["min"][:2]
    ix1,iy1=OPENING["max"][:2]
    outer=((ox0,oy0),(ox1,oy0),(ox1,oy1),(ox0,oy1))
    inner=((ix0,iy0),(ix1,iy0),(ix1,iy1),(ix0,iy1))
    positions=[];normals=[];uvs=[];colors=[];indices=[]

    def face(points):
        normal=cross(sub(points[1],points[0]),sub(points[2],points[0]))
        length=math.sqrt(dot(normal,normal))
        assert length>1e-12
        normal=tuple(v/length for v in normal)
        reference=min(selected,key=lambda i:sum((source_normals[i][k]-normal[k])**2
                                                for k in range(3)))
        axis=max(range(3),key=lambda k:abs(normal[k]))
        dims=(1,2) if axis==0 else (0,2) if axis==1 else (0,1)
        lower=[min(p[k] for p in points) for k in dims]
        upper=[max(p[k] for p in points) for k in dims]
        start=len(positions)
        for point in points:
            u=(point[dims[0]]-lower[0])/max(1e-9,upper[0]-lower[0])
            v=(point[dims[1]]-lower[1])/max(1e-9,upper[1]-lower[1])
            positions.append(tuple(point));normals.append(normal)
            uvs.append((uv_rect[0]+u*(uv_rect[2]-uv_rect[0]),
                        uv_rect[1]+v*(uv_rect[3]-uv_rect[1])))
            colors.append(source_colors[reference])
        indices.extend((start,start+1,start+2,start,start+2,start+3))

    # Four trapezoids partition each ring face without an opening-spanning face.
    for i in range(4):
        j=(i+1)%4
        front=[(*outer[i],zfront),(*outer[j],zfront),
               (*inner[j],zfront),(*inner[i],zfront)]
        face(front)
        face([(p[0],p[1],zback) for p in reversed(front)])
        face([(*outer[i],zback),(*outer[j],zback),
              (*outer[j],zfront),(*outer[i],zfront)])
        face([(*inner[i],zfront),(*inner[j],zfront),
              (*inner[j],zback),(*inner[i],zback)])
    edges=Counter()
    volume=0.0
    for i in range(0,len(indices),3):
        tri=[positions[k] for k in indices[i:i+3]]
        volume+=dot(tri[0],cross(tri[1],tri[2]))/6
        for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
            edges[tuple(sorted((tuple(round(v,6) for v in a),
                                tuple(round(v,6) for v in b))))]+=1
    expected=((ox1-ox0)*(oy1-oy0)-(ix1-ix0)*(iy1-iy0))*(zfront-zback)
    assert all(count==2 for count in edges.values()),"Aperture frame is not closed"
    assert volume>0 and abs(volume-expected)<1e-5,"Incorrect frame winding or volume"
    return positions,normals,uvs,colors,indices,{"min":low,"max":high},volume


def build_native(contract):
    try:
        import bpy
        from mathutils import Vector
    except ImportError:
        return None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(NEW_GLB))
    scene=bpy.context.scene
    used_materials={material for obj in scene.objects if obj.type=="MESH"
                    for material in obj.data.materials if material}
    for material in tuple(bpy.data.materials):
        if material not in used_materials:
            bpy.data.materials.remove(material,do_unlink=True)
    assert len(used_materials)==14
    scene.name="WaterDuel | 360 v4 facade aperture"
    scene["coordinate_contract"]="Runtime(x,y,z) -> Blender(x,-z,y), metres, right-handed"
    scene["camera_interior"]=json.dumps(contract["cameraInterior"])
    scene["protected_360_sha256"]=OLD_SHA256
    scene["exterior_opening_runtime"]=json.dumps(OPENING)
    scene["native_source_glb"]=NEW_GLB.name
    scene["native_source_glb_sha256"]=contract["sha256"]
    for image in bpy.data.images:
        if image.source=="FILE" and not image.packed_file:
            image.pack()
    for hint in contract["lighting"]["hints"]:
        data=bpy.data.lights.new(hint["name"],hint["type"])
        data.energy=hint["scaledWatts"]
        data.color=hint["colorLinear"]
        data.shadow_soft_size=0.23
        obj=bpy.data.objects.new(hint["name"],data)
        scene.collection.objects.link(obj)
        p=hint["position"];obj.location=(p[0],-p[2],p[1])
    data=bpy.data.cameras.new("360 v4 interior review")
    camera=bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(camera)
    camera.location=(0,-9,2.4)
    target=Vector((0,5,2.7))
    camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()
    data.lens=26
    scene.camera=camera
    scene.world.color=(0.1,0.12,0.13)
    scene.render.engine="CYCLES"
    scene.cycles.samples=24
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(NEW_BLEND))
    mesh_objects=[obj for obj in scene.objects if obj.type=="MESH"]
    return {"path":str(NEW_BLEND.relative_to(ROOT)).replace("\\","/"),
            "sha256":sha(NEW_BLEND.read_bytes()),"meshes":len(mesh_objects),
            "materials":len(used_materials),
            "lights":len([obj for obj in scene.objects if obj.type=="LIGHT"]),
            "embeddedImages":len([image for image in bpy.data.images if image.packed_file])}


def build_workshop_360_v4(create_native=True):
    contract=json.loads(OLD_JSON.read_text(encoding="utf-8"))
    source_doc,source_bin,source_raw=read_glb(OLD_GLB)
    assert sha(source_raw)==OLD_SHA256==contract["sha256"]
    assert len(source_doc["materials"])==14 and len(source_doc["meshes"])==14
    assert len(contract["lighting"]["hints"])==2
    protected_paths=[OLD_GLB,OLD_JSON,FOLDER/contract["protectedV3"]["asset"],
                     ROOT/"output/blender/WaterDuel_Workshop360.blend",
                     ROOT/"output/blender/WaterDuel_Atelier_v3.blend"]
    protected_before={str(p.relative_to(ROOT)).replace("\\","/"):sha(p.read_bytes())
                      for p in protected_paths if p.exists()}
    assert protected_before["public/assets/environment/workshop/"+
                            contract["protectedV3"]["asset"]]==contract["protectedV3"]["sha256"]
    document=copy.deepcopy(source_doc)
    wall=next(mesh for mesh in document["meshes"] if mesh["name"]=="Workshop360_wall")
    primitive=wall["primitives"][0]
    original_primitive=copy.deepcopy(primitive)
    assert set(primitive["attributes"])=={"POSITION","NORMAL","TEXCOORD_0","COLOR_0"}
    original={name:read_accessor(source_doc,source_bin,index)
              for name,index in primitive["attributes"].items()}
    original_indices=[r[0] for r in read_accessor(source_doc,source_bin,primitive["indices"])]
    positions=original["POSITION"]
    # No other original wall component extends behind z=-6.2; this selects the
    # complete 24-vertex/12-triangle rear box, including all its UV seam vertices.
    selected={i for i,p in enumerate(positions) if p[2]<-6.20-1e-6 or
              (abs(p[2]+6.20)<1e-5 and abs(abs(p[0])-12)<1e-5)}
    selected={i for i in selected if -6.481<positions[i][2]<-6.199}
    # Outer side walls share front corner positions at z=-6.2. Restrict by the
    # rear box's known contiguous component vertex range after triangle scan.
    rear_triangles=[]
    for start in range(0,len(original_indices),3):
        ids=original_indices[start:start+3]
        if all(-6.481<positions[i][2]<-6.199 and
               abs(positions[i][0])<=12.00001 for i in ids):
            rear_triangles.append(start)
    selected={i for start in rear_triangles for i in original_indices[start:start+3]}
    assert len(rear_triangles)==12 and len(selected)==24,"Unexpected protected closure topology"
    retained=[i for start in range(0,len(original_indices),3) if start not in rear_triangles
              for i in original_indices[start:start+3]]
    wall_material=document["materials"][primitive["material"]]["name"]
    uv_rect=contract["materialReuse"]["atlasPatches"][wall_material]["gltfUVRect"]
    new_pos,new_norm,new_uv,new_col,new_index,closure_bounds,volume=make_frame(
        positions,original["NORMAL"],original["COLOR_0"],selected,uv_rect)
    count=len(positions)
    all_values={"POSITION":positions+new_pos,
                "NORMAL":original["NORMAL"]+new_norm,
                "TEXCOORD_0":original["TEXCOORD_0"]+new_uv,
                "COLOR_0":original["COLOR_0"]+new_col}
    new_indices=retained+[count+i for i in new_index]
    binary=bytearray(source_bin)

    def append_accessor(values,template,target):
        binary.extend(b"\0"*((-len(binary))%4))
        offset=len(binary)
        accessor=copy.deepcopy(template)
        code,size=COMPONENT[accessor["componentType"]]
        width=TYPE_SIZE[accessor["type"]]
        for value in values:
            binary.extend(struct.pack("<"+code*width,*value))
        view_index=len(document["bufferViews"])
        document["bufferViews"].append({"buffer":0,"byteOffset":offset,
            "byteLength":len(binary)-offset,"target":target})
        accessor["bufferView"]=view_index
        accessor.pop("byteOffset",None)
        accessor["count"]=len(values)
        if "min" in accessor or "max" in accessor:
            accessor["min"]=[min(v[k] for v in values) for k in range(width)]
            accessor["max"]=[max(v[k] for v in values) for k in range(width)]
        index=len(document["accessors"])
        document["accessors"].append(accessor)
        return index

    for name,values in all_values.items():
        template=source_doc["accessors"][original_primitive["attributes"][name]]
        primitive["attributes"][name]=append_accessor(values,template,34962)
    primitive["indices"]=append_accessor([(i,) for i in new_indices],
        source_doc["accessors"][original_primitive["indices"]],34963)
    document["buffers"]=[{"byteLength":len(binary)}]
    document["asset"]["generator"]="WaterDuel v4 / exact rear closure aperture; protected v3 PBR payloads"
    raw=pack_glb(document,bytes(binary))
    NEW_GLB.write_bytes(raw)
    result_doc,result_bin,result_raw=read_glb(NEW_GLB)
    assert result_bin[:len(source_bin)]==source_bin
    assert result_doc["materials"]==source_doc["materials"]
    assert result_doc["images"]==source_doc["images"]
    assert image_hashes(result_doc,result_bin)==image_hashes(source_doc,source_bin)
    assert result_doc["nodes"]==source_doc["nodes"]
    assert result_doc["textures"]==source_doc["textures"]
    assert result_doc.get("samplers")==source_doc.get("samplers")
    final_wall=next(mesh for mesh in result_doc["meshes"]
                    if mesh["name"]=="Workshop360_wall")["primitives"][0]
    for name,values in original.items():
        decoded=read_accessor(result_doc,result_bin,final_wall["attributes"][name])
        assert decoded[:len(values)]==values,"Unselected wall vertex attributes changed"
    final_indices=[row[0] for row in read_accessor(result_doc,result_bin,final_wall["indices"])]
    assert final_indices[:len(retained)]==retained,"Unselected wall indices changed"
    for old,new in zip(source_doc["meshes"],result_doc["meshes"]):
        if old["name"]!="Workshop360_wall":
            assert old==new,"Unselected primitive metadata changed"
    assert retained==[i for start in range(0,len(original_indices),3)
                      if start not in rear_triangles for i in original_indices[start:start+3]]

    old_triangles=triangles(source_doc,source_bin)
    new_triangles=triangles(result_doc,result_bin)
    rays=[]
    s=95/147;t=0.3245-1.15*s
    for window,center in enumerate((-4.65,4.65)):
        for col in range(4):
            for row in range(8):
                x=(center-1.36+col*0.907)*s
                y=(3.2+row*0.88)*s+t
                origin=(x,y,-4.80)
                old_hits=[hit for tri in old_triangles
                          if (hit:=ray_triangle(origin,(0,0,-1),tri,3.2)) is not None]
                new_hits=[hit for tri in new_triangles
                          if (hit:=ray_triangle(origin,(0,0,-1),tri,3.2)) is not None]
                assert old_hits and not new_hits,"Exterior projection is still closed"
                rays.append({"window":window,"pane":[col,row],"origin":origin,
                             "direction":[0,0,-1],"distance":3.2,
                             "oldHits":len(old_hits),"v4Hits":len(new_hits),"passed":True})
    guards=[]
    for name,origin,direction,distance in (
        ("left rear return",(-9,3,-5),(0,0,-1),2),
        ("right rear return",(9,3,-5),(0,0,-1),2),
        ("upper rear panel",(0,7.5,-5),(0,0,-1),2),
        ("bottom rear seal",(0,-0.422,-5),(0,0,-1),2),
        ("left outer wall",(0,3.5,8),(-1,0,0),14),
        ("right outer wall",(0,3.5,8),(1,0,0),14),
        ("front outer wall",(0,3.5,8),(0,0,1),10),
        ("roof",(0,3.5,8),(0,1,0),6),
        ("floor extension",(0,3.5,8),(0,-1,0),5)):
        old_hits=[hit for tri in old_triangles
                  if (hit:=ray_triangle(origin,direction,tri,distance)) is not None]
        hits=[hit for tri in new_triangles
              if (hit:=ray_triangle(origin,direction,tri,distance)) is not None]
        assert old_hits and hits
        assert abs(min(old_hits)-min(hits))<1e-5,"A protected wall moved"
        guards.append({"id":name,"origin":origin,"direction":direction,
                       "nearestHit":min(hits),"oldNearestHit":min(old_hits),"passed":True})

    new_contract=copy.deepcopy(contract)
    new_contract.update({"version":4,"stable":False,"release":"v4 exterior compatibility",
        "asset":NEW_GLB.name,"sha256":sha(result_raw),"bytes":len(result_raw),
        "triangles":len(new_triangles),"batches":len(result_doc["meshes"]),
        "source":{"python":"scripts/create-workshop-360-v4.py",
            "protectedInput":"public/assets/environment/workshop/workshop-360.glb",
            "protectedInputSHA256":OLD_SHA256,
            "operation":"Exact constructive rear box minus facade aperture; all other faces retained"},
        "protected360":{"asset":OLD_GLB.name,"sha256":OLD_SHA256,"preserved":True},
        "selectedV4":{"asset":"workshop-runtime-v4.glb","sha256":None,
                      "hashStatus":"pending main v4 export; root will patch"},
        "rearFacadeAperture":{"id":"historic-facade-exterior-view","runtimeBounds":OPENING,
            "removedOriginalTriangles":len(rear_triangles),"newFrameTriangles":len(new_index)//3,
            "retainedOriginalWallTriangles":len(retained)//3,
            "originalClosureBounds":closure_bounds,"closedFrameVolume":volume,
            "preserved":"Both lateral returns, upper panel and lower seal; original historic facade provides its two true window openings"},
        "verification":{"passed":True,"windowProjectionRays":rays,"closedRoomGuards":guards,
            "materialDefinitionsExact":True,"embeddedImageBytesExact":True,
            "embeddedImageCount":len(result_doc["images"]),"newTextures":0,
            "originalBinaryPrefixExact":True,"other13PrimitivesExact":True,
            "unselectedWallTrianglesExact":True,"cameraInteriorExact":True,
            "twoLightingHintsExact":True,"frameManifoldAfterWeldingPositions":True}})
    assert new_contract["cameraInterior"]==contract["cameraInterior"]
    assert new_contract["lighting"]==contract["lighting"]
    assert new_contract["lightDirections"]==contract["lightDirections"]
    if create_native:
        native=build_native(new_contract)
        if native:
            new_contract["source"]["editable"]=native["path"]
            new_contract["nativeEditable"]=native
    protected_after={str(p.relative_to(ROOT)).replace("\\","/"):sha(p.read_bytes())
                     for p in protected_paths if p.exists()}
    assert protected_before==protected_after,"A protected source asset changed"
    new_contract["protectedInputs"]=protected_after
    NEW_JSON.write_text(json.dumps(new_contract,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    return {"asset":NEW_GLB.name,"sha256":new_contract["sha256"],"bytes":len(raw),
            "triangles":len(new_triangles),"batches":new_contract["batches"],
            "windowRaysPassed":len(rays),"closedRoomGuardsPassed":len(guards),
            "imagesPreserved":len(result_doc["images"]),
            "nativeEditable":new_contract.get("nativeEditable"),"oldAssetsPreserved":True}


if __name__=="__main__":
    print("WORKSHOP360_V4_READY",json.dumps(build_workshop_360_v4(),ensure_ascii=False),flush=True)
