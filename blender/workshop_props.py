"""Vintage workshop dressing for the photorealistic Water Duel scene.

Invoked by the scene builder with its material/primitive helper dictionary.
All workshop objects are behind the playing surface, except two edge props.
"""

import math
import random


def build_workshop_props(api):
    box = api["box"]
    cyl = api["cyl"]
    uv = api["uv"]
    torus = api["torus"]
    rod = api["rod"]
    curve = api["curve"]
    mesh = api["mesh"]
    collection = api["collection"]
    mats = api.get("mats", api.get("mat"))
    oak = mats["oak"]
    darkwood = mats["darkwood"]
    brass = mats["brass"]
    iron = mats["iron"]
    steel = mats["steel"]
    copper = mats["copper"]
    glass = mats["glass"]
    ceramic = mats["ceramic"]
    leather = mats["leather"]
    black = mats["black"]
    rng = random.Random(47)
    pi = math.pi
    face_front = (pi / 2, 0, 0)
    axis_x = (0, pi / 2, 0)

    def tabletop(name, x, y, width=3.9, depth=1.9, height=1.8):
        """Heavy, visibly assembled timber workbench with its own joinery."""
        for plank in range(5):
            py = y - depth / 2 + (plank + 0.5) * depth / 5
            box(name + " oak top %02d" % plank,
                (x, py, height), (width, depth / 5 - 0.012, 0.18), oak,
                bevel=0.018)
        box(name + " front apron", (x, y-depth/2+0.08, height-0.28),
            (width-0.14, 0.16, 0.39), darkwood, bevel=0.025)
        box(name + " back apron", (x, y+depth/2-0.08, height-0.28),
            (width-0.14, 0.16, 0.39), darkwood, bevel=0.025)
        for side in (-1, 1):
            lx = x + side * (width / 2 - 0.23)
            for front in (-1, 1):
                ly = y + front * (depth / 2 - 0.20)
                box(name + " mortised leg", (lx, ly, (height-0.17)/2),
                    (0.23, 0.23, height-0.17), oak, bevel=0.015)
                box(name + " iron foot", (lx, ly, 0.13),
                    (0.255, 0.255, 0.24), iron, bevel=0.02)
            box(name + " trestle crossbar", (lx, y, 0.40),
                (0.17, depth-0.18, 0.16), darkwood, bevel=0.016)
        box(name + " lower shelf", (x, y, 0.49),
            (width-0.45, depth-0.28, 0.09), darkwood, bevel=0.015)
        # Round through-bolt heads break up the apron at actual joints.
        for side in (-1, 1):
            cyl(name + " apron through bolt", (x+side*(width/2-0.23),
                y-depth/2-0.006, height-0.27), 0.047, 0.023,
                brass, rotation=face_front, vertices=12)

    def bottle(name, x, y, z, radius=0.14, height=0.65, material=None):
        m = material or glass
        cyl(name + " body", (x, y, z+height*0.33), radius,
            height*0.60, m)
        uv(name + " shoulder", (x, y, z+height*0.64),
           (radius, radius, height*0.145), m)
        cyl(name + " neck", (x, y, z+height*0.84), radius*0.37,
            height*0.27, m)
        torus(name + " lip", (x, y, z+height*0.972),
              radius*0.39, radius*0.085, m)
        cyl(name + " stopper", (x, y, z+height*1.012),
            radius*0.34, height*0.08, darkwood, vertices=24)

    def book(name, x, y, z, width=0.48, depth=0.34, height=0.10, angle=0.0):
        # The text block remains inset between individual thick leather covers.
        box(name + " pages", (x, y, z+height/2),
            (width-0.028, depth-0.018, height*0.69), ceramic,
            bevel=0.006, rotation=(0, 0, angle))
        for zz in (z+0.012, z+height-0.012):
            box(name + " leather cover", (x, y, zz),
                (width, depth, 0.024), leather, bevel=0.007,
                rotation=(0, 0, angle))

    def cog(name, x, y, z, radius=0.24, thickness=0.055, teeth=14):
        """Actual toothed silhouette, with a dark inset bore toward camera."""
        verts = []
        count = teeth * 4
        for yy in (y-thickness/2, y+thickness/2):
            for i in range(count):
                a = 2*pi*i/count
                r = radius * (1.0 if i % 4 in (1, 2) else 0.80)
                verts.append((x+r*math.cos(a), yy, z+r*math.sin(a)))
        faces = [tuple(reversed(range(count))), tuple(range(count, count*2))]
        faces.extend((i, (i+1)%count, (i+1)%count+count, i+count)
                     for i in range(count))
        mesh(name, verts, faces, brass)
        cyl(name + " axle bore", (x, y-thickness/2-0.006, z),
            radius*0.21, 0.012, black, rotation=face_front, vertices=24)
        torus(name + " hub collar", (x, y-thickness/2-0.013, z),
              radius*0.28, radius*0.055, brass, rotation=face_front)

    collection("Workshop | workbenches and cabinets")
    tabletop("Left maker's bench", -6.55, 4.12, 4.25, 1.98, 1.80)
    tabletop("Right machinist's bench", 6.65, 4.28, 4.15, 2.20, 1.80)
    # Three front drawers, with raised brass label holders and separate pulls.
    for side, bx, by in (("L", -6.55, 4.12), ("R", 6.65, 4.28)):
        front_y = by - (0.99 if side == "L" else 1.10) - 0.012
        for i in range(3):
            dx = bx + (i-1)*1.12
            box(side + " bench drawer %d" % (i+1),
                (dx, front_y, 1.47), (1.04, 0.065, 0.31), oak,
                bevel=0.018)
            box(side + " drawer label frame", (dx-0.24, front_y-0.043, 1.47),
                (0.20, 0.026, 0.10), brass, bevel=0.006)
            box(side + " drawer label", (dx-0.24, front_y-0.059, 1.47),
                (0.157, 0.009, 0.059), ceramic, bevel=0.002)
            curve(side + " curved drawer pull", [
                (dx+0.05, front_y-0.055, 1.48),
                (dx+0.08, front_y-0.12, 1.40),
                (dx+0.29, front_y-0.12, 1.40),
                (dx+0.32, front_y-0.055, 1.48)], 0.018, brass)
        # Stacked shallow parts trays under the bench.
        for level in range(2):
            box(side + " underbench wood tool chest", (bx, by+0.10, 0.68+level*0.25),
                (1.85, 1.10, 0.23), darkwood, bevel=0.025)
            box(side + " tool chest drawer front", (bx, by-0.46, 0.68+level*0.25),
                (1.73, 0.055, 0.18), oak, bevel=0.012)
            torus(side + " tool chest ring pull", (bx, by-0.51, 0.68+level*0.25),
                  0.061, 0.012, iron, rotation=face_front)

    collection("Workshop | antique brass fan")
    fx, fy, fz = -6.50, 3.39, 3.30
    uv("Fan broad cast iron foot", (fx, 3.75, 1.96), (0.56, 0.43, 0.095), iron)
    uv("Fan base brass rim", (fx, 3.74, 1.995), (0.48, 0.36, 0.063), brass)
    cyl("Fan pedestal socket", (fx, 3.70, 2.10), 0.16, 0.20, brass)
    rod("Fan tapered support column", (fx, 3.70, 2.17), (fx, 3.69, 2.88),
        0.105, brass)
    torus("Fan pedestal collar", (fx, 3.69, 2.33), 0.113, 0.026, darkwood)
    # Small switch and a power cord describe its human scale.
    cyl("Fan rotary speed switch", (fx+0.29, 3.54, 2.047), 0.075, 0.045,
        black, vertices=32)
    box("Fan speed switch index", (fx+0.29, 3.54, 2.074),
        (0.010, 0.060, 0.012), ceramic, bevel=0.003)
    curve("Fan cloth covered power lead", [
        (fx+0.14, 3.99, 1.97), (fx+0.64, 4.15, 1.91),
        (fx+0.89, 4.24, 1.88), (fx+1.03, 4.35, 1.87),
        (fx+1.39, 4.43, 1.88)], 0.023, black)
    # Motor and adjustable fork sit behind the five blades.
    cyl("Fan cylindrical motor body", (fx, fy+0.37, fz), 0.27, 0.51,
        iron, rotation=face_front)
    cyl("Fan rear motor cap", (fx, fy+0.66, fz), 0.23, 0.08,
        brass, rotation=face_front)
    for a in range(8):
        th = 2*pi*a/8
        cyl("Motor rear ventilation boss", (fx+0.175*math.cos(th), fy+0.709,
            fz+0.175*math.sin(th)), 0.020, 0.018, black,
            rotation=face_front, vertices=12)
    curve("Fan tilting yoke", [
        (fx-0.34, fy+0.31, fz+0.07), (fx-0.35, fy+0.31, fz-0.30),
        (fx, fy+0.31, fz-0.49), (fx+0.35, fy+0.31, fz-0.30),
        (fx+0.34, fy+0.31, fz+0.07)], 0.050, brass)
    for side in (-1, 1):
        cyl("Fan tilt knurled locking screw", (fx+side*0.37, fy+0.31, fz),
            0.065, 0.12, brass, rotation=axis_x, vertices=16)

    # Broad rounded blades are solid double surfaces with a changing pitch.
    # The radial sweep and varying tangential width make true curved paddles.
    for blade in range(5):
        angle = blade*2*pi/5 + 0.17
        verts = []
        rows = 13
        for layer in (-1, 1):
            for j in range(rows):
                t = j/(rows-1)
                rad = 0.19 + t*0.86
                center_ang = angle + 0.52*t
                half_width = 0.055 + 0.205*math.sin(pi*t)**0.7
                if j == rows-1:
                    half_width = 0.065
                for side in (-1, 1):
                    tangential = side*half_width
                    xx = rad*math.cos(center_ang) - tangential*math.sin(center_ang)
                    zz = rad*math.sin(center_ang) + tangential*math.cos(center_ang)
                    yy = fy + 0.055 + side*0.105*t + layer*0.007
                    verts.append((fx+xx, yy, fz+zz))
        faces = []
        n = rows*2
        for j in range(rows-1):
            k = j*2
            faces.append((k, k+2, k+3, k+1))
            faces.append((n+k+1, n+k+3, n+k+2, n+k))
            faces.append((k, n+k, n+k+2, k+2))
            faces.append((k+1, k+3, n+k+3, n+k+1))
        faces.extend([(0, 1, n+1, n),
                      (n-2, 2*n-2, 2*n-1, n-1)])
        obj = mesh("Fan swept brass blade %02d" % (blade+1), verts, faces, brass)
        if obj is not None and hasattr(obj, "data"):
            for poly in obj.data.polygons:
                poly.use_smooth = True
    # Concentric front rings, depth rings and bowed radial cage wires.
    # Every wire is geometry, so the cage remains editable and casts shadows.
    for radius in (0.27, 0.43, 0.60, 0.78, 0.96, 1.13):
        torus("Fan front concentric cage", (fx, fy-0.24, fz),
              radius, 0.012 if radius < 1.0 else 0.020,
              brass, rotation=face_front)
    for yy in (fy-0.10, fy+0.24):
        torus("Fan rolled outer safety hoop", (fx, yy, fz),
              1.135, 0.022, brass, rotation=face_front)
    for i in range(20):
        a = 2*pi*i/20
        c, s = math.cos(a), math.sin(a)
        curve("Fan bowed radial cage wire", [
            (fx+0.19*c, fy-0.265, fz+0.19*s),
            (fx+0.72*c, fy-0.245, fz+0.72*s),
            (fx+1.105*c, fy-0.17, fz+1.105*s),
            (fx+1.135*c, fy+0.24, fz+1.135*s),
            (fx+0.32*c, fy+0.30, fz+0.32*s)], 0.013, brass)
    uv("Fan domed brass center badge", (fx, fy-0.29, fz),
       (0.205, 0.056, 0.205), brass)
    cyl("Fan badge dark center", (fx, fy-0.349, fz), 0.096, 0.013,
        darkwood, rotation=face_front, vertices=48)
    torus("Fan badge inset ring", (fx, fy-0.36, fz), 0.114, 0.009,
          brass, rotation=face_front)
    # Four individual nuts hold front and back guard halves together.
    for a in (0, pi/2, pi, 3*pi/2):
        cyl("Fan cage clasp screw", (fx+1.13*math.cos(a), fy-0.12,
            fz+1.13*math.sin(a)), 0.033, 0.050, iron,
            rotation=face_front, vertices=6)

    collection("Workshop | miniature wood lathe")
    lx, ly, lz = 6.75, 3.86, 2.17
    box("Lathe cast iron base", (lx, ly, 1.97), (2.55, 0.65, 0.17),
        iron, bevel=0.055)
    for yy in (ly-0.19, ly+0.19):
        box("Lathe ground steel bed rail", (lx, yy, 2.105),
            (2.51, 0.085, 0.11), steel, bevel=0.012)
    for xx in (lx-1.00, lx+1.00):
        box("Lathe mounting foot", (xx, ly, 1.90),
            (0.43, 0.81, 0.08), iron, bevel=0.025)
        for yy in (ly-0.30, ly+0.30):
            cyl("Lathe mounting bolt", (xx, yy, 1.951), 0.037,
                0.033, brass, vertices=6)
    box("Lathe headstock casting", (lx-0.92, ly, lz+0.24),
        (0.40, 0.46, 0.53), iron, bevel=0.065)
    cyl("Lathe spindle bearing", (lx-0.67, ly, lz+0.34),
        0.17, 0.21, brass, rotation=axis_x)
    cyl("Lathe chuck", (lx-0.52, ly, lz+0.34), 0.14, 0.13,
        steel, rotation=axis_x, vertices=32)
    # Turned spindle has a visible changing profile along the X axis.
    profile = [(0.00,0.07),(0.08,0.085),(0.13,0.15),(0.20,0.16),
               (0.26,0.10),(0.33,0.075),(0.43,0.11),(0.56,0.12),
               (0.69,0.075),(0.76,0.08),(0.80,0.14),(0.87,0.15),
               (0.93,0.08),(1.03,0.06)]
    spindle_verts = []
    radial_segments = 48
    start = lx-0.44
    center_z = lz+0.34
    for xx, rr in profile:
        for k in range(radial_segments):
            a = 2*pi*k/radial_segments
            spindle_verts.append((start+xx, ly+rr*math.cos(a),
                                  center_z+rr*math.sin(a)))
    spindle_faces = []
    for j in range(len(profile)-1):
        for k in range(radial_segments):
            nxt = (k+1)%radial_segments
            spindle_faces.append((j*radial_segments+k,
                (j+1)*radial_segments+k, (j+1)*radial_segments+nxt,
                j*radial_segments+nxt))
    mesh("Lathe shaped timber spindle", spindle_verts, spindle_faces, oak)
    box("Lathe sliding tailstock", (lx+0.83, ly, lz+0.18),
        (0.33, 0.42, 0.40), iron, bevel=0.050)
    cyl("Lathe tailstock quill", (lx+0.68, ly, center_z),
        0.070, 0.37, steel, rotation=axis_x)
    cyl("Lathe tailstock screw", (lx+1.08, ly, center_z),
        0.033, 0.29, steel, rotation=axis_x)
    torus("Lathe tailstock hand wheel", (lx+1.25, ly, center_z),
          0.15, 0.022, brass, rotation=axis_x)
    rod("Lathe hand wheel spoke", (lx+1.25, ly-0.14, center_z),
        (lx+1.25, ly+0.14, center_z), 0.014, brass)
    box("Lathe toolrest carriage", (lx+0.02, ly-0.19, lz+0.01),
        (0.48, 0.44, 0.14), iron, bevel=0.025)
    rod("Lathe toolrest support", (lx+0.02, ly-0.27, lz+0.06),
        (lx+0.02, ly-0.27, center_z+0.015), 0.035, brass)
    rod("Lathe toolrest steel bar", (lx-0.34, ly-0.27, center_z+0.04),
        (lx+0.40, ly-0.27, center_z+0.04), 0.035, steel)
    rod("Lathe toolrest lock lever", (lx+0.13, ly-0.30, lz+0.08),
        (lx+0.33, ly-0.45, lz+0.08), 0.023, brass)
    uv("Lathe toolrest lever knob", (lx+0.33, ly-0.45, lz+0.08),
       (0.046,0.046,0.046), black)
    # Drive wheel on the far left gives the machine a period silhouette.
    cyl("Lathe headstock drive flywheel", (lx-1.18, ly, center_z),
        0.22, 0.12, darkwood, rotation=axis_x)
    torus("Lathe drive belt pulley rim", (lx-1.24, ly, center_z),
          0.221, 0.019, brass, rotation=axis_x)
    for i in range(12):
        # Tangled wood curls are intentionally restrained, with exact 3D curves.
        sx = lx + rng.uniform(-0.45, 0.78)
        sy = ly + rng.uniform(-0.45, 0.43)
        curl = []
        for j in range(15):
            a = j*0.52
            rr = 0.023+j*0.0025
            curl.append((sx+rr*math.cos(a)+j*0.006,
                         sy+rr*math.sin(a), 1.902+0.004*j))
        curve("Lathe pale timber shaving", curl, 0.008, oak)

    collection("Workshop | bottles books and hand tools")
    bottle("Tall reagent bottle", -8.08, 4.42, 1.90, 0.13, 0.77)
    bottle("Small oil bottle", -7.73, 4.50, 1.90, 0.115, 0.49)
    bottle("Stoppered workshop bottle", -4.92, 4.37, 1.90, 0.14, 0.70)
    bottle("Opaque ceramic oil flask", 8.08, 4.90, 1.90, 0.16, 0.62, ceramic)
    bottle("Fine glass bottle", 8.47, 4.87, 1.90, 0.115, 0.81)
    # Glazed jar with a rolled metal lid and separate neck.
    cyl("Glazed workshop jar", (-4.76, 3.50, 2.13), 0.18, 0.42, ceramic)
    torus("Workshop jar lip", (-4.76, 3.50, 2.35), 0.16, 0.024, brass)
    cyl("Workshop jar brass lid", (-4.76, 3.50, 2.38), 0.18, 0.055, brass)
    uv("Workshop jar lid grip", (-4.76, 3.50, 2.423), (0.048,0.048,0.029), darkwood)
    book("Lower worn notebook", -5.18, 4.66, 1.90, 0.70, 0.47, 0.13, -0.08)
    book("Upper workshop notebook", -5.17, 4.65, 2.03, 0.65, 0.43, 0.10, 0.035)
    book("Machinist handbook", 8.13, 3.59, 1.90, 0.66, 0.42, 0.13, 0.09)
    # Little oak tool caddy, deliberately hollow with open partitions.
    tx, ty = -7.89, 3.64
    box("Open carpenter tool caddy bottom", (tx, ty, 1.955),
        (0.85, 0.60, 0.10), oak, bevel=0.016)
    for xx in (tx-0.40, tx+0.40):
        box("Tool caddy end", (xx, ty, 2.10), (0.06, 0.60, 0.35),
            oak, bevel=0.014)
    for yy in (ty-0.27, ty+0.27):
        box("Tool caddy side", (tx, yy, 2.04), (0.80, 0.055, 0.23),
            darkwood, bevel=0.012)
    rod("Tool caddy arched carrying grip", (tx-0.39, ty, 2.30),
        (tx+0.39, ty, 2.30), 0.037, darkwood)
    for i in range(3):
        x = tx-0.22+i*0.20
        rod("Chisel polished shaft", (x, ty+0.06, 2.08),
            (x+0.035, ty+0.04, 2.55+i*0.055), 0.022, steel)
        rod("Chisel turned wood handle", (x+0.035, ty+0.04, 2.55+i*0.055),
            (x+0.050, ty+0.02, 2.78+i*0.055), 0.044, darkwood)
        torus("Chisel brass ferrule", (x+0.035, ty+0.04, 2.55+i*0.055),
              0.044, 0.010, brass)
    # Two measuring instruments lying flat, still individually editable.
    box("Brass folding rule blade", (-5.58, 3.34, 1.915),
        (0.73,0.075,0.022), brass, bevel=0.005, rotation=(0,0,0.14))
    box("Brass folding rule second blade", (-5.11, 3.46, 1.936),
        (0.67,0.075,0.022), brass, bevel=0.005, rotation=(0,0,0.52))
    cyl("Folding rule pivot", (-5.25,3.39,1.958), 0.027,0.018,iron,vertices=16)
    rod("Right bench wood mallet handle", (7.64,4.76,1.94),
        (7.20,4.20,1.94), 0.037, darkwood)
    cyl("Right bench mallet head", (7.66,4.78,1.99), 0.105, 0.32,
        oak, rotation=axis_x, vertices=24)
    for i in range(2):
        sx, sy = -5.63+i*0.42, 4.57+i*0.11
        cyl("Copper winding reel core", (sx,sy,2.045), 0.12,0.28,darkwood)
        for zz in (1.914,2.178):
            cyl("Copper winding reel flange", (sx,sy,zz),0.178,0.032,oak)
        for j in range(7):
            torus("Fine copper winding", (sx,sy,1.94+j*0.032),
                  0.126,0.014,copper)

    collection("Workshop | mechanical parts and edge dressing")
    cog("Loose brass mechanism wheel", 5.10, 3.42, 2.09, 0.20, 0.06, 13)
    cog("Large spare clock gear", -4.91, 4.74, 2.28, 0.32, 0.07, 18)
    # A turned brass bearing, steel washers and loose shaft on the right bench.
    cyl("Spare steel spindle", (7.89,4.27,1.95),0.035,0.51,steel,rotation=axis_x)
    for i in range(3):
        torus("Loose brass washer", (8.11+i*0.10,4.08,1.918),
              0.061,0.015,brass)
    cyl("Spare bearing housing", (5.03,4.77,2.03),0.145,0.26,brass)
    cyl("Spare bearing dark bore", (5.03,4.77,2.166),0.069,0.012,iron)
    # Small edge crates sit fully outside the central playing silhouette.
    for side in (-1,1):
        ex, ey = side*6.64, -2.65
        ez = 0.37
        box("Foreground parts crate base", (ex,ey,0.10),
            (0.90,0.65,0.14),darkwood,bevel=0.02)
        for j in range(3):
            z = 0.23+j*0.15
            for yy in (ey-0.31,ey+0.31):
                box("Foreground crate front slat",(ex,yy,z),
                    (0.90,0.055,0.12),oak,bevel=0.009)
            for xx in (ex-0.42,ex+0.42):
                box("Foreground crate side slat",(xx,ey,z),
                    (0.055,0.60,0.12),oak,bevel=0.009)
        for xx in (ex-0.36,ex+0.36):
            box("Foreground crate upright strap",(xx,ey-0.348,ez),
                (0.045,0.022,0.53),iron,bevel=0.006)
        if side < 0:
            bottle("Foreground vintage bottle", ex-0.07,ey+0.04,0.19,0.13,0.69)
        else:
            for j in range(3):
                cyl("Foreground timber offcut",(ex-0.21+j*0.20,ey,0.47),
                    0.065,0.57,oak,rotation=(0.12,0.25*(j-1),0),vertices=24)

    return {"fan_center": (fx, fy, fz), "left_bench": (-6.55,4.12,1.80),
            "right_bench": (6.65,4.28,1.80)}
