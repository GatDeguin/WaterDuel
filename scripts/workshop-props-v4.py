"""WaterDuel v4: proposals 15, 16, 21 and 22 only.

The caller owns merging, export, runtime integration and saving. This module
never opens, renders, saves or writes a file. New geometry is authored in the
original atelier's metre-based Z-up frame and stored in scaled Blender Z-up:
    Blender = (s*x, s*y, s*z + translation_y)
    glTF    = (s*x, s*z + translation_y, -s*y)
Both frames are right handed. Native constant PBR materials avoid assigning
old atlas textures to new geometry with unrelated UV coordinates.
"""

import math

import bpy
from mathutils import Vector


REVISION = "workshop-props-v4.1"
COLLECTION = "V4 | selected repairs and workshop details"


def build_v4_details(scene, materials, scale=95 / 147,
                     translation_y=0.3245 - 1.15 * (95 / 147)):
    """Return objects plus a measured report; no existing geometry is changed.

    ``objects`` contains bpy objects, including editable FONT labels. Convert
    FONT objects through the evaluated dependency graph before material merge.
    Everything else in the result is JSON serializable. Existing atelier
    collections, cameras, lights, fan animation and source meshes are untouched.
    """
    if scene != bpy.context.scene:
        raise ValueError("Use the active Blender scene for measured v4 details")
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("scale must be finite and positive")
    if not math.isfinite(translation_y):
        raise ValueError("translation_y must be finite")

    collection = bpy.data.collections.get(COLLECTION)
    if collection and len(collection.objects):
        raise RuntimeError("V4 detail collection already exists; use a fresh source scene")
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(collection)

    objects = []
    category_objects = {"15": [], "16": [], "21": [], "22": []}
    created_materials = []
    font_labels = []

    def linear(hex_color):
        values = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
        return tuple(v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4
                     for v in values)+(1.0,)

    def material(key, color, roughness, metallic=0.0, coat=0.0):
        name = "WD_V4_DETAIL_"+key
        mat = materials.get(name) or bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
            bsdf = next((node for node in mat.node_tree.nodes
                         if node.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
            output = next((node for node in mat.node_tree.nodes
                           if node.type == "OUTPUT_MATERIAL"), None)
            if output is None:
                output = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
            if not output.inputs["Surface"].is_linked:
                mat.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
            bsdf.inputs["Base Color"].default_value = linear(color)
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = metallic
            bsdf.inputs["Coat Weight"].default_value = coat
            bsdf.inputs["Coat Roughness"].default_value = 0.23
            mat.diffuse_color = linear(color)
            mat["workshop_v4_detail"] = True
        if not mat.get("workshop_v4_detail"):
            raise ValueError("Refusing to reuse an unrelated material: "+name)
        materials[name] = mat
        created_materials.append(mat)
        return mat

    wood_raw = material("wood_wax_pale", "A68155", 0.56, coat=0.06)
    wood_oil = material("wood_oil_dark", "59402B", 0.34, coat=0.17)
    wood_lac = material("wood_shellac_amber", "9E5F2F", 0.24, coat=0.35)
    repair_steel = material("repair_satin_steel", "8B8980", 0.38, metallic=0.90)
    cream = material("cream_workshop_paint", "C7B993", 0.79)
    charcoal = material("charcoal_workshop_paint", "252A25", 0.73)

    def mapped(point):
        return (scale*point[0], scale*point[1], scale*point[2]+translation_y)

    def mesh(name, vertices, faces, mat, proposal):
        data = bpy.data.meshes.new("V4P_"+name)
        data.from_pydata([mapped(v) for v in vertices], [], faces)
        data.update()
        obj = bpy.data.objects.new("V4P_"+name, data)
        collection.objects.link(obj)
        data.materials.append(mat)
        obj["proposal"] = int(proposal)
        obj["source_frame"] = "original atelier metres, Z-up"
        objects.append(obj)
        category_objects[proposal].append(obj)
        return obj

    def box(name, center, size, mat, proposal, rotation=None):
        half = [d/2 for d in size]
        vertices = [(-half[0],-half[1],-half[2]),
                    (half[0],-half[1],-half[2]),
                    (half[0],half[1],-half[2]),
                    (-half[0],half[1],-half[2]),
                    (-half[0],-half[1],half[2]),
                    (half[0],-half[1],half[2]),
                    (half[0],half[1],half[2]),
                    (-half[0],half[1],half[2])]
        if rotation is not None:
            # Euler XYZ composed locally; the final vertices remain world-native.
            rx, ry, rz = rotation
            def rotate(p):
                x,y,z=p
                y,z=y*math.cos(rx)-z*math.sin(rx),y*math.sin(rx)+z*math.cos(rx)
                x,z=x*math.cos(ry)+z*math.sin(ry),-x*math.sin(ry)+z*math.cos(ry)
                x,y=x*math.cos(rz)-y*math.sin(rz),x*math.sin(rz)+y*math.cos(rz)
                return (x,y,z)
            vertices = [rotate(v) for v in vertices]
        vertices = [tuple(center[k]+v[k] for k in range(3)) for v in vertices]
        return mesh(name, vertices,
            [(3,2,1,0),(4,5,6,7),(0,1,5,4),
             (1,2,6,5),(2,3,7,6),(3,0,4,7)], mat, proposal)

    def plane_basis(normal):
        n = Vector(normal).normalized()
        reference = Vector((0,0,1)) if abs(n.z) < 0.9 else Vector((0,1,0))
        u = reference.cross(n).normalized()
        v = n.cross(u).normalized()
        return u,v,n

    def cylinder(name, center, radius, depth, mat, proposal,
                 normal=(0,0,1), sides=16, inner=0.0, phase=0.0):
        c=Vector(center)
        u,v,n=plane_basis(normal)
        vertices=[]
        radii=(radius,inner) if inner else (radius,)
        for r in radii:
            for z in (-depth/2,depth/2):
                for k in range(sides):
                    a=phase+2*math.pi*k/sides
                    vertices.append(tuple(c+u*(r*math.cos(a))+v*(r*math.sin(a))+n*z))
        faces=[]
        if inner:
            for k in range(sides):
                j=(k+1)%sides
                faces.extend([(k,j,sides+j,sides+k),
                    (2*sides+k,3*sides+k,3*sides+j,2*sides+j),
                    (k,2*sides+k,2*sides+j,j),
                    (sides+k,sides+j,3*sides+j,3*sides+k)])
        else:
            faces=[tuple(reversed(range(sides))),tuple(range(sides,sides*2))]
            faces.extend((k,(k+1)%sides,(k+1)%sides+sides,k+sides)
                         for k in range(sides))
        return mesh(name,vertices,faces,mat,proposal)

    def profile(name, points, center, u, v, normal, thickness, mat, proposal):
        c=Vector(center);u=Vector(u);v=Vector(v);n=Vector(normal)
        vertices=[tuple(c+u*x+v*z+n*d)
                  for d in (-thickness/2,thickness/2) for x,z in points]
        count=len(points)
        faces=[tuple(reversed(range(count))),tuple(range(count,2*count))]
        faces.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
        return mesh(name,vertices,faces,mat,proposal)

    def label(name, body, location, size, mat, proposal, rotation=(math.pi/2,0,0)):
        data=bpy.data.curves.new("V4P_"+name,"FONT")
        data.body=body
        data.size=size*scale
        data.align_x="CENTER"
        data.align_y="CENTER"
        data.resolution_u=2
        data.extrude=0.0
        obj=bpy.data.objects.new("V4P_"+name,data)
        obj.location=mapped(location)
        obj.rotation_euler=rotation
        data.materials.append(mat)
        collection.objects.link(obj)
        obj["proposal"]=int(proposal)
        obj["convert_to_mesh_before_merge"]=True
        objects.append(obj)
        category_objects[proposal].append(obj)
        font_labels.append({"name":obj.name,"text":body,
            "sourceLocation":list(location),"blenderLocation":list(obj.location),
            "runtimeLocation":[obj.location.x,obj.location.z,-obj.location.y]})
        return obj

    # 15 -- Restrained carpentry repairs on actual existing exposed wood faces.
    # These thin repair caps intentionally meet the host face; they are not
    # floating props or freestanding objects on the active arena surface.
    bow=[(-0.13,-0.075),(-0.035,-0.042),(0.035,-0.042),(0.13,-0.075),
         (0.13,0.075),(0.035,0.042),(-0.035,0.042),(-0.13,0.075)]
    for i,x in enumerate((-1.72,1.14)):
        profile("P15 front apron butterfly %02d"%(i+1),bow,(x,-2.728,0.69),
                (1,0,0),(0,0,1),(0,-1,0),0.006,wood_raw,"15")
    for i,(x,width) in enumerate(((-3.05,0.34),(2.79,0.27))):
        outline=[(-width/2,-0.041),(width/2-0.043,-0.041),
                 (width/2,0.041),(-width/2+0.043,0.041)]
        profile("P15 scarfed apron insert %02d"%(i+1),outline,(x,-2.728,0.76),
                (1,0,0),(0,0,1),(0,-1,0),0.006,wood_lac,"15")
    for side in (-1,1):
        for i,y in enumerate((-1.28,1.16)):
            cylinder("P15 endgrain oak plug %s %d"%("L" if side<0 else "R",i+1),
                (side*6.079,y,0.67+0.035*i),0.046,0.008,wood_raw,"15",
                normal=(side,0,0),sides=14,phase=0.21*i)
    for i,(x,y) in enumerate(((-8.04,3.132),(-5.12,3.132),
                               (5.04,3.182),(8.19,3.182))):
        cylinder("P15 side bench repaired dowel %02d"%(i+1),
            (x,y,1.795),0.031+0.004*(i%2),0.008,
            wood_lac if i%2 else wood_raw,"15",normal=(0,-1,0),sides=14)
    for i,x in enumerate((-4.47,3.46)):
        profile("P15 rear counter inset repair %02d"%(i+1),
            [(-0.14,-0.041),(0.14,-0.041),(0.11,0.041),(-0.12,0.041)],
            (x,5.767,1.62),(1,0,0),(0,0,1),(0,-1,0),0.006,wood_oil,"15")

    # 16 -- Replaced heads and proper annular washers, varied by fastening job.
    def fastening(name, surface, radius, style, age=False, washer=True):
        x,y,z=surface
        if washer:
            cylinder(name+" open washer",(x,y-0.005,z),radius*1.42,0.010,
                charcoal if age else repair_steel,"16",normal=(0,-1,0),
                sides=18,inner=radius*0.54,phase=0.13)
        head_depth=radius*0.43
        outward=0.010+head_depth/2
        cylinder(name+" replaced "+style+" head",(x,y-outward,z),radius,
            head_depth,repair_steel if not age else charcoal,"16",normal=(0,-1,0),
            sides=6 if style=="hex" else 4 if style=="square" else 18,
            phase=0.21 if style=="hex" else math.pi/4 if style=="square" else 0)
        if style=="slotted":
            box(name+" recessed driver mark",(x,y-outward-head_depth/2-0.0006,z),
                (radius*1.37,0.0012,radius*0.18),charcoal,"16")

    for i,(x,y) in enumerate(((-7.27,3.0855),(-6.15,3.0855),(-5.03,3.0855),
                              (5.93,3.1355),(7.05,3.1355),(8.17,3.1355))):
        fastening("P16 side drawer fixing %02d"%(i+1),(x,y,1.565),
                  0.028+(i%3)*0.004,("slotted","hex","square")[i%3],
                  age=i in (1,4))
    for i,x in enumerate((-4.92,4.96)):
        fastening("P16 rear counter service screw %02d"%(i+1),
                  (x,5.767,1.62),0.030,"slotted",age=False)
    for i,(x,y) in enumerate(((-8.445,3.214),(8.495,3.264))):
        fastening("P16 bench leg reinforcing bolt %02d"%(i+1),
                  (x,y,1.08),0.042,"hex",age=i==0)

    # 21 -- Three labelled real wood finish samples on the rear side counter.
    sx,sy=-4.84,6.27
    box("P21 sample tray base",(sx,sy,1.723),(0.94,0.60,0.050),wood_oil,"21")
    for xx in (sx-0.45,sx+0.45):
        box("P21 sample tray end rail",(xx,sy,1.763),(0.036,0.60,0.065),wood_raw,"21")
    samples=((sx-0.285,"CERA",wood_raw),(sx,"ACEITE",wood_oil),
             (sx+0.285,"GOMA LACA",wood_lac))
    for i,(x,text,mat) in enumerate(samples):
        box("P21 finish sample %02d %s"%(i+1,text),(x,6.37,1.965),
            (0.235,0.040,0.435),mat,"21",rotation=(-0.20,0,0))
        box("P21 finish sample label plate %02d"%(i+1),(x,5.982,1.767),
            (0.257,0.012,0.083),cream,"21")
        label("P21 finish label %02d"%(i+1),text,(x,5.975,1.768),
              0.042 if len(text)>6 else 0.054,charcoal,"21")
    label("P21 sample collection title","ACABADOS",(sx,6.53,1.7488),
          0.065,cream,"21",rotation=(0,0,0))

    # 22 -- Shadow-board paint silhouettes and intentionally empty hook sites.
    # Supports land on the rear counter instead of floating over its props.
    for x in (2.03,2.77):
        box("P22 shadow board iron upright",(x,6.92,2.37),
            (0.035,0.055,1.35),charcoal,"22")
        box("P22 shadow board counter foot",(x,6.88,1.714),
            (0.15,0.19,0.038),repair_steel,"22")
    box("P22 tool shadow board backing",(2.40,6.895,3.45),
        (0.98,0.070,1.03),wood_oil,"22")
    for x in (1.932,2.868):
        box("P22 shadow board upright frame",(x,6.845,3.45),
            (0.044,0.035,1.075),wood_raw,"22")
    for z in (2.935,3.965):
        box("P22 shadow board cross frame",(2.40,6.845,z),
            (0.98,0.035,0.044),wood_raw,"22")
    hammer=[(-0.019,0),(.019,0),(.019,.415),(.105,.415),
            (.105,.485),(.052,.500),(-.048,.485),(-.105,.460),
            (-.100,.420),(-.019,.415)]
    wrench=[(-.022,0),(.022,0),(.038,.035),(.035,.09),(.018,.12),
            (.018,.40),(.070,.46),(.073,.52),(.032,.55),(.028,.48),
            (-.028,.48),(-.032,.55),(-.073,.52),(-.070,.46),
            (-.018,.40),(-.018,.12),(-.035,.09),(-.038,.035)]
    chisel=[(-.016,0),(.016,0),(.016,.25),(.041,.29),(.044,.48),
            (.026,.52),(-.026,.52),(-.044,.48),(-.041,.29),(-.016,.25)]
    for i,(x,points,text) in enumerate(((2.12,chisel,"FORMON"),
                                       (2.40,wrench,"LLAVE"),
                                       (2.68,hammer,"MARTILLO"))):
        profile("P22 painted absent tool %02d"%(i+1),points,(x,6.858,3.105),
                (1,0,0),(0,0,1),(0,-1,0),0.0012,cream,"22")
        # Bare peg and a small upturned lip describe an empty storage location.
        cylinder("P22 empty tool peg %02d"%(i+1),(x,6.8175,3.685),
                 0.010,0.085,repair_steel,"22",normal=(0,-1,0),sides=10)
        box("P22 empty peg upturn %02d"%(i+1),(x,6.768,3.699),
            (0.018,0.018,0.034),repair_steel,"22")
        label("P22 missing tool name %02d"%(i+1),text,(x,6.857,3.023),
              0.039 if len(text)>6 else 0.047,cream,"22")
    label("P22 shadow board title","CADA PIEZA EN SU SITIO",(2.40,6.857,3.823),
          0.043,cream,"22")

    bpy.context.view_layer.update()
    depsgraph=bpy.context.evaluated_depsgraph_get()

    def bounds(points):
        return {"min":[min(p[a] for p in points) for a in range(3)],
                "max":[max(p[a] for p in points) for a in range(3)]}

    rows=[]
    all_points=[]
    category_points={key:[] for key in category_objects}
    total_triangles=0
    intrusions=[]
    for obj in objects:
        evaluated=obj.evaluated_get(depsgraph)
        data=evaluated.to_mesh()
        try:
            data.calc_loop_triangles()
            world=[tuple(obj.matrix_world@v.co) for v in data.vertices]
            triangle_count=len(data.loop_triangles)
            total_triangles+=triangle_count
            proposal=str(obj["proposal"])
            all_points.extend(world)
            category_points[proposal].extend(world)
            runtime=[(p[0],p[2],-p[1]) for p in world]
            for p in runtime:
                if abs(p[0])<3.7 and abs(p[2])<1.31 and p[1]>0.36:
                    intrusions.append(obj.name)
                    break
            rows.append({"name":obj.name,"proposal":int(proposal),"type":obj.type,
                "trianglesAfterFontConversion":triangle_count,
                "runtimeBounds":bounds(runtime),
                "material":obj.data.materials[0].name})
        finally:
            evaluated.to_mesh_clear()
    if intrusions:
        raise RuntimeError("New details enter the active fighting field: "+str(intrusions))
    if total_triangles>15000:
        raise RuntimeError("V4 detail geometry exceeds the 15k triangle allocation")
    if len(created_materials)>6:
        raise RuntimeError("V4 detail materials exceed the six-material allocation")

    def frame_bounds(points):
        source=[(p[0]/scale,p[1]/scale,(p[2]-translation_y)/scale) for p in points]
        runtime=[(p[0],p[2],-p[1]) for p in points]
        return {"sourceZUp":bounds(source),"blenderZUp":bounds(points),
                "runtimeYUp":bounds(runtime)}

    categories={key:{"proposal":int(key),"objectCount":len(group),
        "objectNames":[obj.name for obj in group],
        "geometryBounds":frame_bounds(category_points[key])}
        for key,group in category_objects.items()}
    return {"revision":REVISION,"objects":objects,"categories":categories,
        "geometryBounds":frame_bounds(all_points),"objectCount":len(objects),
        "trianglesAfterFontConversion":total_triangles,
        "materialNames":[mat.name for mat in created_materials],
        "newMaterialCount":len(created_materials),"fontLabels":font_labels,
        "objectReport":rows,"activeFieldIntrusions":intrusions,
        "coordinateContract":{"authoring":"source metres, right-handed Z-up",
            "blender":"(s*x,s*y,s*z+translation_y), right-handed Z-up",
            "runtime":"(s*x,s*z+translation_y,-s*y), right-handed Y-up",
            "scale":scale,"translation_y":translation_y,
            "linearDeterminant":scale**3},
        "hostContacts":"Thin carpentry repair caps and replacement hardware intentionally contact their existing host faces.",
        "existingSceneModified":False,"savedOrExportedFiles":False}
