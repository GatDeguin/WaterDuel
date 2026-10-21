"""Additional editable dressing for the finished WaterDuel atelier.

Only the named dressing collection is owned by this refinement.  No external
models, textures, characters, logos or plant assets are loaded or changed.
"""


def refine_atelier():
    import bpy
    import math

    collection_name = "Workshop | depth and lived-in dressing"
    col = bpy.data.collections.get(collection_name)
    if col is None:
        col = bpy.data.collections.new(collection_name)
        bpy.context.scene.collection.children.link(col)
    else:
        # Re-running this pass replaces only its own editable objects.
        for old in tuple(col.objects):
            bpy.data.objects.remove(old, do_unlink=True)

    def existing(name):
        material = bpy.data.materials.get(name)
        if material is None:
            raise RuntimeError("Atelier refinement requires material: " + name)
        return material

    oak = existing("Oak | aged endgrain and open pores")
    walnut = existing("Walnut | smoke and worn varnish")
    brass = existing("Brass | tarnish, patina, polished edges")
    iron = existing("Blackened iron | worn workshop steel")
    glass = existing("Bottle glass | green crown glass")
    filament = existing("Lamp | warm tungsten filament")
    steel = existing("Steel | satin machined surface")
    leather = existing("Leather | oxblood oil and tooling")
    pi = math.pi

    def make_mesh(name, verts, faces, material, bevel=0.0, smooth=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        col.objects.link(obj)
        obj.data.materials.append(material)
        if bevel > 0:
            modifier = obj.modifiers.new("Worn workshop edges", "BEVEL")
            modifier.width = bevel
            modifier.segments = 2
        if smooth:
            for polygon in data.polygons:
                polygon.use_smooth = True
        return obj

    def box(name, loc, size, material, bevel=0.012, rotation=None):
        x, y, z = (s/2 for s in size)
        obj = make_mesh(name,
            [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),
             (-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
            [(3,2,1,0),(4,5,6,7),(0,1,5,4),
             (1,2,6,5),(2,3,7,6),(3,0,4,7)], material,
            min(bevel, min(size)*0.20))
        obj.location = loc
        if rotation:
            obj.rotation_euler = rotation
        return obj

    def cylinder(name, loc, radius, depth, material, rotation=None, segments=32):
        verts = []
        for zz in (-depth/2, depth/2):
            for i in range(segments):
                a = 2*pi*i/segments
                verts.append((radius*math.cos(a), radius*math.sin(a), zz))
        faces = [tuple(reversed(range(segments))), tuple(range(segments,2*segments))]
        faces.extend((i,(i+1)%segments,(i+1)%segments+segments,i+segments)
                     for i in range(segments))
        obj = make_mesh(name, verts, faces, material,
                        min(radius*0.06, 0.009), smooth=True)
        obj.location = loc
        if rotation:
            obj.rotation_euler = rotation
        return obj

    def rod(name, a, b, radius, material):
        d = tuple(b[k]-a[k] for k in range(3))
        length = sum(v*v for v in d)**0.5
        if length <= 0.000001:
            raise ValueError("Zero length atelier rod: " + name)
        rot = (0, math.acos(max(-1,min(1,d[2]/length))), math.atan2(d[1],d[0]))
        return cylinder(name, tuple((a[k]+b[k])/2 for k in range(3)),
                        radius, length, material, rot, segments=20)

    def path(name, points, radius, material):
        data = bpy.data.curves.new(name, "CURVE")
        data.dimensions = "3D"
        data.bevel_depth = radius
        data.bevel_resolution = 2
        spline = data.splines.new("BEZIER")
        spline.bezier_points.add(len(points)-1)
        for point, coordinate in zip(spline.bezier_points, points):
            point.co = coordinate
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(name, data)
        col.objects.link(obj)
        data.materials.append(material)
        return obj

    def ring(name, loc, radius, wire, material, rotation=None):
        verts, faces = [], []
        n, m = 40, 8
        for i in range(n):
            a = 2*pi*i/n
            for j in range(m):
                b = 2*pi*j/m
                rr = radius+wire*math.cos(b)
                verts.append((rr*math.cos(a),rr*math.sin(a),wire*math.sin(b)))
        for i in range(n):
            for j in range(m):
                faces.append((i*m+j,((i+1)%n)*m+j,
                    ((i+1)%n)*m+(j+1)%m,i*m+(j+1)%m))
        obj = make_mesh(name, verts, faces, material, smooth=True)
        obj.location = loc
        if rotation:
            obj.rotation_euler = rotation
        return obj

    def rounded(name, loc, radii, material):
        # A low-cost UV ellipsoid without context-sensitive mesh operators.
        seg, rings = 24, 12
        verts = [(0,0,-1)]
        for j in range(1,rings):
            phi = -pi/2+pi*j/rings
            for i in range(seg):
                a = 2*pi*i/seg
                verts.append((math.cos(phi)*math.cos(a),
                              math.cos(phi)*math.sin(a),math.sin(phi)))
        top = len(verts)
        verts.append((0,0,1))
        faces = [(0,1+(i+1)%seg,1+i) for i in range(seg)]
        for j in range(rings-2):
            for i in range(seg):
                faces.append((1+j*seg+i,1+j*seg+(i+1)%seg,
                    1+(j+1)*seg+(i+1)%seg,1+(j+1)*seg+i))
        faces.extend((top,1+(rings-2)*seg+i,1+(rings-2)*seg+(i+1)%seg)
                     for i in range(seg))
        obj = make_mesh(name, verts, faces, material, smooth=True)
        obj.location, obj.scale = loc, radii
        return obj

    front = (pi/2,0,0)
    across = (0,pi/2,0)

    # The tool rail sits below the banner. Its top remains well below z=4.1.
    box("Atelier lower tool rack oak rail", (0,7.35,3.54),
        (3.65,0.17,0.23), walnut, 0.018)
    for x in (-1.62,1.62):
        cylinder("Tool rail slotted fixing", (x,7.248,3.54),
                 0.035,0.026,brass,front,segments=12)
        box("Tool rail fixing slot", (x,7.231,3.54),
            (0.040,0.005,0.006),iron,0.001)
    for x in (-1.45,-0.96,-0.49,0.12,0.83,1.43):
        path("Hand forged upward tool hook",[(x,7.26,3.58),
            (x,7.13,3.50),(x,7.08,3.40),(x,7.07,3.45)],0.016,iron)

    # Bow saw: actual taut blade, bowed iron frame, and turned wood grip.
    path("Hanging bow saw iron frame",[(-1.61,7.08,2.78),
         (-1.69,7.08,3.27),(-1.44,7.08,3.43),
         (-1.19,7.08,3.27),(-1.26,7.08,2.78)],0.024,iron)
    rod("Hanging bow saw narrow blade",(-1.61,7.08,2.78),
        (-1.26,7.08,2.78),0.009,steel)
    cylinder("Bow saw beech grip",(-1.45,7.08,2.63),0.041,0.28,oak)
    cylinder("Bow saw brass grip ferrule",(-1.45,7.08,2.79),0.043,0.045,brass)

    cylinder("Hanging chisel walnut handle",(-0.96,7.08,3.28),0.055,0.30,walnut)
    ring("Hanging chisel end cap",(-0.96,7.08,3.43),0.043,0.010,brass)
    cylinder("Hanging chisel handle ferrule",(-0.96,7.08,3.105),0.047,0.055,brass)
    box("Hanging chisel ground steel blade",(-0.96,7.08,2.85),
        (0.068,0.024,0.48),steel,0.004)

    # Spring dividers with crossed tips and visible adjustment screw.
    rod("Dividers left leg",(-0.49,7.08,3.36),(-0.72,7.08,2.64),0.018,steel)
    rod("Dividers right leg",(-0.49,7.08,3.36),(-0.25,7.08,2.64),0.018,steel)
    cylinder("Dividers pivot boss",(-0.49,7.055,3.34),0.052,0.052,brass,front)
    rod("Dividers adjustment screw",(-0.64,7.06,2.99),(-0.35,7.06,2.99),
        0.010,brass)
    cylinder("Dividers adjustment wheel",(-0.35,7.06,2.99),0.034,0.033,
             brass,across,segments=16)

    # A small hand saw with a solid pierced wood handle and real teeth.
    outer = [(-0.025,3.47),(0.26,3.47),(0.28,3.26),(-0.02,3.24)]
    inner = [(0.035,3.42),(0.205,3.42),(0.215,3.30),(0.035,3.30)]
    verts = []
    for yy in (7.045,7.115):
        verts.extend((x,yy,z) for x,z in outer+inner)
    faces=[]
    for i in range(4):
        ni=(i+1)%4
        faces.extend([(i,ni,ni+4,i+4),(i+8,i+12,ni+12,ni+8),
                      (i,i+8,ni+8,ni),(i+4,ni+4,ni+12,i+12)])
    make_mesh("Pierced walnut handsaw handle",verts,faces,walnut,0.008)
    edge=[(0.01,3.28),(0.255,3.28),(0.49,2.57),(0.42,2.55)]
    for i in range(12):
        z=2.58+i*0.054
        x=0.015+(3.28-z)*0.23
        edge.extend([(x-0.033,z),(x+0.010,z+0.020)])
    verts=[(x,y,z) for y in (7.066,7.083) for x,z in edge]
    count=len(edge)
    faces=[tuple(reversed(range(count))),tuple(range(count,2*count))]
    faces.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
    make_mesh("Hanging handsaw toothed steel blade",verts,faces,steel,0.001)
    for x in (0.04,0.22):
        cylinder("Handsaw brass handle pin",(x,7.028,3.29),0.018,0.025,
                 brass,front,segments=12)

    rod("Hanging claw hammer hickory shaft",(0.83,7.07,2.69),
        (0.83,7.07,3.34),0.031,oak)
    box("Hanging hammer forged face",(0.78,7.07,3.30),
        (0.27,0.095,0.11),iron,0.023)
    path("Hammer curved claw",[(0.90,7.07,3.33),(1.02,7.07,3.35),
         (1.06,7.07,3.26)],0.025,steel)
    rod("Hanging tongs left arm",(1.36,7.08,3.39),(1.57,7.08,2.70),0.021,iron)
    rod("Hanging tongs right arm",(1.50,7.08,3.39),(1.29,7.08,2.70),0.021,iron)
    cylinder("Hanging tongs pivot",(1.43,7.06,3.14),0.040,0.045,brass,front)
    for x in (1.29,1.57):
        rounded("Tongs flattened grip",(x,7.08,2.71),(0.043,0.023,0.065),iron)

    # A narrow ladder and imperfectly stored stock add an asymmetric silhouette.
    # All wood remains deep in the atelier, outside the fighting stage.
    ladder_bottom_y=5.65
    ladder_top_y=6.54
    ladder_height=4.73
    for x in (-8.40,-7.63):
        box("Leaning ladder worn walnut stile",(x,6.095,2.40),
            (0.105,0.145,4.82),walnut,0.016,rotation=(-0.186,0,0))
        box("Ladder iron heel shoe",(x,ladder_bottom_y,0.13),
            (0.13,0.18,0.25),iron,0.014,rotation=(-0.186,0,0))
    for i in range(11):
        z=0.39+i*0.39
        y=ladder_bottom_y+(z/ladder_height)*(ladder_top_y-ladder_bottom_y)
        rod("Ladder worn oak rung",(-8.40,y,z),(-7.63,y,z),0.040,oak)
    for i in range(5):
        h=(3.03,2.57,3.45,2.86,3.20)[i]
        box("Stored rough oak board",(-7.18+i*0.20,6.91-i*0.075,h/2+0.09),
            (0.165,0.10,h),oak,0.009,rotation=(0.07+0.015*i,-0.045+0.02*i,0.015*i))
    for z in (0.58,1.68):
        box("Stored timber leather tie",(-6.78,6.58,z),
            (1.0,0.035,0.072),leather,0.008)

    table_z=1.695

    def crate(name,x,y,z,width,depth,height,material=oak):
        box(name+" bottom",(x,y,z+0.035),(width,depth,0.07),walnut)
        for xx in (x-width/2+0.035,x+width/2-0.035):
            box(name+" end",(xx,y,z+height/2),(0.07,depth,height),material)
        for yy in (y-depth/2+0.027,y+depth/2-0.027):
            box(name+" side",(x,yy,z+height/2),(width-0.10,0.055,height),material)
        for xx in (x-width/2+0.09,x+width/2-0.09):
            cylinder(name+" front pin",(xx,y-depth/2-0.005,z+height*0.75),
                     0.020,0.016,iron,front,segments=12)

    crate("Open tabletop maker's box",-3.25,6.35,table_z,1.02,0.62,0.38)
    box("Open box leaning lid",(-3.25,6.69,2.14),
        (1.03,0.065,0.45),walnut,0.015,rotation=(-0.30,0,0))
    for x in (-3.58,-2.92):
        cylinder("Maker's box brass hinge",(x,6.65,2.05),0.035,0.13,
                 brass,across)
    for i in range(3):
        cylinder("Box assorted metal spindle",(-3.52+i*0.23,6.31,1.99),
                 0.043,0.37,steel,rotation=(0.35,i*0.30,0))

    crate("Divided tabletop fittings tray",1.88,6.36,table_z,1.04,0.67,0.21)
    for x in (1.69,2.05):
        box("Fittings tray walnut divider",(x,6.36,1.81),
            (0.035,0.58,0.17),walnut,0.005)
    for i,(x,y) in enumerate(((1.52,6.26),(1.88,6.45),(2.18,6.22),(2.22,6.47))):
        ring("Tray loose brass washer",(x,y,1.79+0.012*(i%2)),0.067,0.017,brass)

    def bottle(name,x,y,height,radius):
        cylinder(name+" body",(x,y,table_z+height*0.33),radius,
                 height*0.59,glass)
        rounded(name+" shoulder",(x,y,table_z+height*0.65),
                (radius,radius,height*0.15),glass)
        cylinder(name+" glass neck",(x,y,table_z+height*0.85),radius*0.36,
                 height*0.25,glass)
        ring(name+" rolled glass lip",(x,y,table_z+height*0.98),
             radius*0.37,radius*0.08,glass)
        cylinder(name+" dark stopper",(x,y,table_z+height*1.02),radius*0.32,
                 height*0.07,walnut,segments=20)

    bottle("Rear tall green bottle",-2.35,6.49,0.70,0.14)
    bottle("Rear squat glass bottle",-1.94,6.34,0.44,0.14)
    bottle("Rear right stoppered bottle",3.05,6.52,0.80,0.15)
    # Lying tool roll with one open flap and a visible brass buckle.
    cylinder("Bench leather tool roll",(0.52,6.41,1.80),0.105,0.70,
             leather,across)
    box("Tool roll unfolded leather flap",(0.52,6.17,1.715),
        (0.69,0.40,0.025),leather,0.011,rotation=(0,0,-0.05))
    for x in (0.28,0.77):
        box("Tool roll worn leather strap",(x,6.35,1.91),
            (0.053,0.21,0.022),walnut,0.008)
    ring("Tool roll brass buckle",(0.77,6.245,1.94),0.040,0.009,brass)
    rod("Tool roll exposed chisel",(0.21,6.15,1.76),
        (0.85,6.12,1.76),0.016,steel)
    cylinder("Small tabletop timber bobbin core",(-0.94,6.48,1.88),
             0.085,0.29,walnut)
    for z in (1.735,2.025):
        cylinder("Small timber bobbin flange",(-0.94,6.48,z),0.15,0.025,oak)
    for i in range(5):
        ring("Bobbin dark winding",(-0.94,6.48,1.77+i*0.043),
             0.093,0.018,leather)

    def practical(name,x,y):
        # Brass reservoir, open-sided chimney and a tiny warm flame.
        cylinder(name+" foot",(x,y,table_z+0.035),0.17,0.065,brass)
        rounded(name+" oil reservoir",(x,y,table_z+0.14),
                (0.145,0.145,0.102),brass)
        cylinder(name+" burner",(x,y,table_z+0.25),0.070,0.115,brass)
        ring(name+" lower chimney rim",(x,y,table_z+0.30),0.090,0.012,brass)
        # A cylinder wall with open ends, rather than a solid glass plug.
        verts=[]
        n=32
        for z,r in ((table_z+0.30,0.095),(table_z+0.57,0.078),
                    (table_z+0.30,0.089),(table_z+0.57,0.072)):
            verts.extend((x+r*math.cos(2*pi*i/n),y+r*math.sin(2*pi*i/n),z)
                         for i in range(n))
        faces=[]
        for i in range(n):
            j=(i+1)%n
            faces.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
                          (n+i,n+j,3*n+j,3*n+i),(i,2*n+i,2*n+j,j)])
        make_mesh(name+" open crown glass chimney",verts,faces,glass,smooth=True)
        rounded(name+" tungsten warm flame",(x,y,table_z+0.39),
                (0.027,0.027,0.073),filament)
        ring(name+" chimney top lip",(x,y,table_z+0.57),0.076,0.007,glass)
        data=bpy.data.lights.new(name+" warm practical illumination","POINT")
        data.energy=16
        data.color=(1.0,0.55,0.24)
        data.shadow_soft_size=0.075
        light=bpy.data.objects.new(name+" warm practical illumination",data)
        col.objects.link(light)
        light.location=(x,y,table_z+0.42)

    practical("Left bench oil lamp",-4.08,6.37)
    practical("Right bench oil lamp",3.90,6.36)

    # A pair of storage boxes makes the lower workshop read as occupied too.
    # They are deliberately separated rather than mirrored in exact placement.
    crate("Left floor parts crate",-3.75,6.58,0.10,0.80,0.72,0.56,walnut)
    crate("Right floor hardware crate",3.75,6.73,0.10,0.78,0.68,0.43)
    cylinder("Floor crate spare wood turning",(-3.75,6.58,0.72),
             0.08,0.73,oak,rotation=(0.16,0.22,0))
    cylinder("Floor crate spare steel shaft",(3.75,6.73,0.58),
             0.045,0.67,steel,rotation=(-0.11,0.20,0))

    return {"collection":collection_name,"object_count":len(col.objects),
            "external_assets":0,"preserved_fighting_stage":True}
