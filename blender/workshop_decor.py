"""Editable textile, drafting and foliage details for the WaterDuel workshop.

Call build_workshop_decor(api) from the scene builder inside Blender.
No operators or scene-wide changes are made at module import time.
"""

import math
import random


def build_workshop_decor(api):
    import bpy
    from mathutils import Vector

    box, cyl, torus = api['box'], api['cyl'], api['torus']
    rod, curve, mesh, text = api['rod'], api['curve'], api['mesh'], api['text']
    mats = api.get('mats', api.get('materials', api))
    rng = random.Random(29041)
    pi = math.pi
    api['collection']('07 | Textiles, workshop drawings and plants')

    def getmat(key):
        return mats[key]

    def solidify(obj, thickness):
        if obj is not None:
            mod = obj.modifiers.new('Physical textile thickness', 'SOLIDIFY')
            mod.thickness = thickness
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
        return obj

    # The textile weave is geometric at silhouette scale and procedural below it.
    cloth = bpy.data.materials.new('Forest green | woven cotton velvet')
    cloth.use_nodes = True
    nt = cloth.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.012, 0.061, 0.043, 1)
    bsdf.inputs['Roughness'].default_value = .83
    if 'Sheen Weight' in bsdf.inputs:
        bsdf.inputs['Sheen Weight'].default_value = .31
    texcoord = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 420
    noise.inputs['Detail'].default_value = 2.1
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .21
    bump.inputs['Distance'].default_value = .018
    nt.links.new(texcoord.outputs['Generated'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    def banner(name, cx, y, cz, w, h, phase=0.0):
        nx, nz = 64, 72
        verts, faces = [], []
        for iz in range(nz + 1):
            v = iz / nz
            for ix in range(nx + 1):
                u = ix / nx
                xx = cx + (u - .5) * w
                # Hanging folds develop below the tightly attached header.
                fold = math.sin(u * pi * 10 + phase) * .047
                fold += math.sin(u * pi * 23 + .7) * .009
                yy = y + fold * (.18 + .82 * math.sin(v * pi / 2))
                yy += .038 * math.sin(u * pi) * math.sin(v * pi)
                zz = cz + h / 2 - v * h
                zz -= .045 * math.sin(pi * u) ** 2 * min(1, v * 6)
                zz += .015 * math.sin(u * 26 + phase) * v ** 12
                verts.append((xx, yy, zz))
        for iz in range(nz):
            for ix in range(nx):
                a = iz * (nx + 1) + ix
                faces.append((a, a + 1, a + nx + 2, a + nx + 1))
        obj = solidify(mesh(name + ' | folded fabric', verts, faces, cloth), .008)
        # Bound selvedges follow the same folds rather than floating straight.
        for side in (0.012, .988):
            pts = []
            for iz in range(41):
                v = iz / 40
                f = math.sin(side * pi * 10 + phase) * .047 + math.sin(side * pi * 23 + .7) * .009
                pts.append((cx + (side - .5) * w, y + f * (.18 + .82 * math.sin(v * pi / 2)) - .006,
                            cz + h / 2 - v * h - .045 * math.sin(pi * side) ** 2 * min(1, v * 6)))
            curve(name + ' | stitched edge', pts, .0065, getmat('gold'))
        topz = cz + h / 2 + .055
        rod(name + ' | brass hanging rod', (cx - w * .58, y, topz), (cx + w * .58, y, topz), .032, getmat('brass'))
        for side in (-1, 1):
            cyl(name + ' | pole finial', (cx + side * w * .60, y, topz), .075, .052, getmat('brass'), rotation=(0, pi / 2, 0))
        for i in range(max(3, int(w / .43))):
            gx = cx - w * .43 + (i / max(1, int(w / .43) - 1)) * w * .86
            torus(name + ' | sewn brass eyelet', (gx, y - .025, topz - .10), .033, .009, getmat('brass'), rotation=(pi / 2, 0, 0))
        return obj

    def shield_outline(name, cx, y, cz, scale, mat, mirror=False):
        # An angular, hollow U/shield sewn onto the canvas, as in w1-w4.
        outer = [(-.34, .60), (.34, .72), (.34, -.48), (0, -.72), (-.34, -.56)]
        inner = [(-.16, .40), (.16, .46), (.16, -.33), (0, -.45), (-.16, -.37)]
        if mirror:
            outer = [(-x, z) for x, z in outer]
            inner = [(-x, z) for x, z in inner]
        verts = [(cx + x * scale, y, cz + z * scale) for x, z in outer + inner]
        faces = [(i, (i + 1) % 5, (i + 1) % 5 + 5, i + 5) for i in range(5)]
        return solidify(mesh(name, verts, faces, mat), .005)

    def emblem(name, cx, y, cz, size):
        shield_outline(name + ' | mint shield', cx - .40 * size, y, cz, size, getmat('mint'))
        shield_outline(name + ' | amber shield', cx + .40 * size, y - .001, cz + .065 * size, size, getmat('gold'), True)

    banner('Grand WaterDuel standard', 0, 7.63, 6.42, 3.18, 4.62, .1)
    emblem('Grand embroidered insignia', 0, 7.48, 6.95, 1.21)
    text('Grand standard lettering', 'WATERDUEL', (0, 7.45, 5.64), .335, getmat('parchment'))
    text('Grand standard subtitle', 'P U P P E T   A R E N A', (0, 7.44, 5.25), .126, getmat('gold'))
    rod('Grand banner lower weighted hem', (-1.54, 7.62, 4.11), (1.54, 7.62, 4.11), .023, getmat('darkwood'))
    for x, y, z, phase in ((-8.28, 7.40, 6.18, .9), (8.55, 7.40, 6.54, 1.4), (-6.92, 4.20, 3.56, 2.0)):
        banner('Workshop pennant', x, y, z, 1.18, 2.12, phase)
        emblem('Pennant woven emblem', x, y - .13, z + .19, .56)
        text('Pennant serial', 'W D  /  0 1', (x, y - .14, z - .64), .069, getmat('gold'))
    for x in (-3.8, 3.8):
        banner('Arena apron pennant', x, -2.606, .56, 1.52, 1.03, x)
        emblem('Apron woven insignia', x, -2.732, .57, .47)

    # An aged paper drawing pinned to a wood backing, not a glowing interface.
    board_x, board_y, board_z = 6.65, 7.47, 4.05
    bw, bh = 3.05, 3.70
    box('Drafting board oak backing', (board_x, board_y + .075, board_z), (bw + .16, .11, bh + .16), getmat('darkwood'), bevel=.04)
    pv, pf = [], []
    for j in range(13):
        for i in range(11):
            u, v = i / 10, j / 12
            pv.append((board_x + (u - .5) * bw, board_y - .03 + .009 * math.sin(u * 15) * math.sin(v * 17), board_z + (v - .5) * bh))
    for j in range(12):
        for i in range(10):
            a = j * 11 + i
            pf.append((a, a + 1, a + 12, a + 11))
    solidify(mesh('Puppet construction drawing | curled parchment', pv, pf, getmat('parchment')), .003)
    iy = board_y - .058

    def line(name, points, radius=.007):
        return curve('Blueprint | ' + name, [(x, iy, z) for x, z in points], radius, getmat('ink'))

    def circle(name, x, z, rad, radius=.006):
        return line(name, [(x + math.cos(t * 2 * pi / 48) * rad, z + math.sin(t * 2 * pi / 48) * rad) for t in range(49)], radius)

    def label(name, body, x, z, sz=.078, align='LEFT'):
        return text('Blueprint | ' + name, body, (x, iy - .003, z), sz, getmat('ink'), align=align)

    l, r = board_x - bw / 2 + .13, board_x + bw / 2 - .13
    b, t = board_z - bh / 2 + .13, board_z + bh / 2 - .13
    line('paper ruling border', [(l, b), (r, b), (r, t), (l, t), (l, b)], .004)
    label('drawing title', 'HYDRAULIC PUPPET', l + .1, t - .26, .135)
    label('drawing subtitle', 'WORKSHOP SERIES  /  ARTICULATION STUDY', l + .1, t - .42, .050)
    line('header rule', [(l, t - .54), (r, t - .54)], .005)
    cx, cz = board_x - .22, board_z - .05
    # Front elevation with double-line bones, joint rings and small fasteners.
    circle('balloon head envelope', cx, cz + 1.09, .265, .009)
    circle('neck collar', cx, cz + .773, .065)
    line('head center cross', [(cx - .37, cz + 1.09), (cx + .37, cz + 1.09)], .003)
    line('centerline', [(cx, cz - 1.24), (cx, cz + 1.46)], .0025)
    line('head tie', [(cx - .045, cz + 1.35), (cx - .070, cz + 1.45), (cx + .062, cz + 1.44), (cx + .043, cz + 1.35)])
    line('thorax outline', [(cx - .28, cz + .73), (cx + .28, cz + .73), (cx + .235, cz + .11), (cx - .235, cz + .11), (cx - .28, cz + .73)], .009)
    line('thorax central plank', [(cx - .04, cz + .70), (cx - .04, cz + .13), (cx + .04, cz + .13), (cx + .04, cz + .70)], .004)
    line('pelvis block', [(cx - .20, cz - .02), (cx + .20, cz - .02), (cx + .18, cz - .26), (cx - .18, cz - .26), (cx - .20, cz - .02)], .008)
    circle('spinal pivot', cx, cz + .045, .073)

    def bone(name, a, q, width):
        ax, az = a
        qx, qz = q
        dx, dz = qx - ax, qz - az
        length = math.hypot(dx, dz)
        nx, nz = -dz / length * width / 2, dx / length * width / 2
        line(name, [(ax + nx, az + nz), (qx + nx, qz + nz), (qx - nx, qz - nz), (ax - nx, az - nz), (ax + nx, az + nz)], .007)
        line(name + ' | grain', [(ax + nx * .3, az + nz * .3), (qx + nx * .3, qz + nz * .3)], .0025)

    for s in (-1, 1):
        shoulder = (cx + s * .34, cz + .64)
        elbow = (cx + s * .59, cz + .16)
        wrist = (cx + s * .68, cz - .23)
        hip = (cx + s * .15, cz - .25)
        knee = (cx + s * .23, cz - .76)
        ankle = (cx + s * .28, cz - 1.20)
        bone('upper arm', shoulder, elbow, .115)
        bone('forearm', elbow, wrist, .09)
        bone('thigh', hip, knee, .16)
        bone('shin', knee, ankle, .12)
        line('foot sole', [(ankle[0] - .07, ankle[1]), (ankle[0] + s * .22, ankle[1] - .085), (ankle[0] - .07, ankle[1] - .085), (ankle[0] - .07, ankle[1])], .007)
        for nm, point, rr in (('shoulder bearing', shoulder, .09), ('elbow bearing', elbow, .068), ('wrist ring', wrist, .053), ('hip disc', hip, .075), ('knee bearing', knee, .077), ('ankle pin', ankle, .051)):
            circle(nm, point[0], point[1], rr)
            circle(nm + ' | screw', point[0], point[1], rr * .34, .003)
    # Fine hatching suggests the bronze mechanics and sectioned blocks.
    for i in range(9):
        x = cx - .22 + i * .05
        line('thorax hatch', [(x, cz + .16), (x + .08, cz + .25)], .002)
    # Drafting dimensions and their arrow ticks.
    dx = r - .23
    line('overall dimension', [(dx, cz - 1.285), (dx, cz + 1.43)], .0035)
    for z in (cz - 1.285, cz + 1.43):
        line('dimension extension', [(cx + .41, z), (dx + .10, z)], .0025)
        line('dimension slash', [(dx - .055, z - .055), (dx + .055, z + .055)], .005)
    label('dimension measurement', '1420', dx + .06, cz - .1, .073)
    line('shoulder callout', [(cx - .35, cz + .64), (l + .22, cz + .91), (l + .04, cz + .91)], .0035)
    label('shoulder annotation', 'BRASS', l + .04, cz + 1.01, .052)
    label('shoulder annotation two', 'BUSH / 12', l + .04, cz + .92, .049)
    line('neck hose callout', [(cx + .06, cz + .76), (cx + .66, cz + .98), (r - .1, cz + .98)], .0035)
    label('neck annotation', 'SEAL No. 07', cx + .60, cz + 1.07, .057)
    line('lower title block', [(l, b + .29), (r, b + .29)], .0035)
    label('drawing footer', 'W D  /  ENGINEERING ARCHIVE', l + .08, b + .15, .058)
    label('drawing revision', 'FIG. 04   -   REV. B', r - .05, b + .04, .054, align='RIGHT')
    for x in (board_x - bw / 2 + .06, board_x + bw / 2 - .06):
        for z in (board_z - bh / 2 + .08, board_z + bh / 2 - .08):
            cyl('Drawing board brass tack', (x, board_y - .065, z), .029, .024, getmat('brass'), rotation=(pi / 2, 0, 0), vertices=20)

    # Curled notes on the rear workbench: individual readable paper silhouettes.
    # Rear bench is approximately z=1.65, away from the performance platform.
    for idx, (px, py, rz) in enumerate(((-3.25, 6.26, .13), (-2.64, 6.35, -.17), (3.56, 6.38, .06))):
        pw, ph, pz = .66, .47, 1.70 + idx * .007
        verts = []
        for j in range(5):
            for i in range(8):
                u, v = i / 7, j / 4
                xx, yy = (u - .5) * pw, (v - .5) * ph
                x = px + xx * math.cos(rz) - yy * math.sin(rz)
                y = py + xx * math.sin(rz) + yy * math.cos(rz)
                z = pz + .032 * u ** 9 + .008 * math.sin(v * 3)
                verts.append((x, y, z))
        faces = [(j * 8 + i, j * 8 + i + 1, (j + 1) * 8 + i + 1, (j + 1) * 8 + i) for j in range(4) for i in range(7)]
        solidify(mesh('Bench loose construction sheet', verts, faces, getmat('parchment')), .0015)
        for n in range(5):
            xx0, xx1, yy0 = -.25, .20 - .06 * (n % 2), -.12 + n * .055
            pts = []
            for xx in (xx0, xx1):
                pts.append((px + xx * math.cos(rz) - yy0 * math.sin(rz), py + xx * math.sin(rz) + yy0 * math.cos(rz), pz + .014))
            curve('Bench note ink rule', pts, .0012, getmat('ink'))

    # Plants are mesh leaves with tapered, bent, cupped blades. Every plant uses
    # one foliage mesh and one vein mesh, keeping the scene easy to edit.
    leafmat = bpy.data.materials.new('Ivy | waxy variegated deep green')
    leafmat.use_nodes = True
    nt = leafmat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = .39
    if 'Subsurface Weight' in bsdf.inputs:
        bsdf.inputs['Subsurface Weight'].default_value = .055
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 7
    noise.inputs['Detail'].default_value = 3
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (.015, .048, .006, 1)
    ramp.color_ramp.elements[1].color = (.105, .215, .036, 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .11
    bump.inputs['Distance'].default_value = .009
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    veinmat = bpy.data.materials.new('Ivy | pale leaf veins')
    veinmat.diffuse_color = (.10, .18, .027, 1)
    veinmat.use_nodes = True
    veinmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.10, .18, .027, 1)
    veinmat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .53

    def foliage(name, leaves):
        vv, ff, veins_v, veins_f = [], [], [], []
        for base, end, width, roll in leaves:
            a, q = Vector(base), Vector(end)
            direction = q - a
            length = direction.length
            direction.normalize()
            sideways = direction.cross(Vector((0, 0, 1)))
            if sideways.length < .1:
                sideways = direction.cross(Vector((0, 1, 0)))
            sideways.normalize()
            normal = sideways.cross(direction).normalized()
            # Tilt each blade so that it catches side light independently.
            side = sideways * math.cos(roll) + normal * math.sin(roll)
            norm = side.cross(direction).normalized()
            off = len(vv)
            centers = []
            for j in range(7):
                t = j / 6
                center = a + direction * length * t + norm * (math.sin(pi * t) * length * .16 - t * t * length * .08)
                profile = max(.001, math.sin(pi * t) ** .80) * width
                centers.append(center + norm * .004)
                for edge in (-1, 0, 1):
                    p = center + side * profile * edge + norm * (abs(edge) * .033 * math.sin(pi * t))
                    vv.append(tuple(p))
            for j in range(6):
                for k in range(2):
                    p = off + j * 3 + k
                    ff.append((p, p + 1, p + 4, p + 3))
            # A geometric central rib and three pairs of branching veins.
            def ribbon(p0, p1, radius):
                vo = len(veins_v)
                s = side * radius
                veins_v.extend([tuple(p0 - s), tuple(p0 + s), tuple(p1 + s), tuple(p1 - s)])
                veins_f.append((vo, vo + 1, vo + 2, vo + 3))
            for j in range(6):
                ribbon(centers[j], centers[j + 1], .0018)
            for j in (2, 3, 4):
                t = j / 6
                for sign in (-1, 1):
                    target = centers[min(6, j + 1)] + side * width * math.sin(pi * t) ** .8 * .76 * sign + norm * .025
                    ribbon(centers[j], target, .001)
        obj = mesh(name + ' | individual curved leaf blades', vv, ff, leafmat)
        solidify(obj, .0016)
        mesh(name + ' | leaf venation', veins_v, veins_f, veinmat)

    def pot(name, x, y, z, scale=1.0):
        # Terracotta-style turned ceramic, with a real hollow rim and soil inset.
        nv, nf = [], []
        profile = [(.36, 0), (.40, .06), (.53, .68), (.56, .72), (.55, .78), (.48, .78), (.47, .70)]
        segments = 48
        for rr, zz in profile:
            for k in range(segments):
                a = k * 2 * pi / segments
                nv.append((x + rr * scale * math.cos(a), y + rr * scale * math.sin(a), z + zz * scale))
        for j in range(len(profile) - 1):
            for k in range(segments):
                a = j * segments + k
                nf.append((a, j * segments + (k + 1) % segments, (j + 1) * segments + (k + 1) % segments, a + segments))
        obj = mesh(name + ' | thrown ceramic pot', nv, nf, getmat('ceramic'))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        cyl(name + ' | rich dark soil', (x, y, z + .705 * scale), .465 * scale, .025 * scale, getmat('darkwood'))
        torus(name + ' | raised rim', (x, y, z + .765 * scale), .523 * scale, .028 * scale, getmat('ceramic'))
        torus(name + ' | turned foot', (x, y, z + .035 * scale), .382 * scale, .022 * scale, getmat('ceramic'))
        return z + .72 * scale

    def potted_plant(name, x, y, scale, height):
        z = pot(name, x, y, 0.06, scale)
        all_leaves = []
        for stem in range(7):
            angle = stem * 2 * pi / 7 + rng.uniform(-.25, .25)
            reach = rng.uniform(.30, .70) * scale
            ht = height * rng.uniform(.64, 1.04)
            pts = []
            for j in range(9):
                t = j / 8
                pts.append((x + math.cos(angle) * reach * t ** 1.3,
                            y + math.sin(angle) * reach * t ** 1.3,
                            z + ht * t - .12 * scale * t * t))
            curve(name + ' | woody stem', pts, .011 * scale, getmat('darkwood'))
            for j in range(2, 9):
                px, py, pz = pts[j]
                leaf_angle = angle + (pi * .49 if j % 2 else -pi * .49) + rng.uniform(-.4, .4)
                ll = rng.uniform(.24, .47) * scale
                tip = (px + math.cos(leaf_angle) * ll, py + math.sin(leaf_angle) * ll, pz + rng.uniform(.00, .21) * scale)
                all_leaves.append(((px, py, pz), tip, ll * rng.uniform(.23, .34), rng.uniform(-.65, .65)))
        foliage(name, all_leaves)

    for args in (('Left arena fern', -6.70, .9, 1.04, 1.85),
                 ('Right arena ivy', 6.82, 1.8, 1.0, 1.7),
                 ('Back left potted shrub', -7.54, 6.7, 1.12, 2.10),
                 ('Back right potted shrub', 8.20, 6.6, .90, 1.65),
                 ('Back bench green accent', -2.08, 7.02, .66, 1.40)):
        potted_plant(*args)

    def climbing_ivy(name, x, y, topz, length, direction):
        all_leaves = []
        for k in range(5):
            pts = []
            for j in range(18):
                t = j / 17
                pts.append((x + direction * (.18 * k + .42 * math.sin(t * 4.0 + k * .74)),
                            y - .10 * math.sin(t * 7 + k), topz - length * t * (1 - k * .07)))
            curve(name + ' | trailing vine', pts, .011 + .003 * (k == 0), getmat('darkwood'))
            for j in range(1, 18):
                px, py, pz = pts[j]
                s = -1 if j % 2 else 1
                ll = rng.uniform(.20, .34)
                tip = (px + s * ll * .82, py - rng.uniform(.04, .23), pz - ll * rng.uniform(.12, .55))
                all_leaves.append(((px, py, pz), tip, ll * .34, rng.uniform(-.4, .5)))
        foliage(name, all_leaves)

    climbing_ivy('Left wall climbing ivy', -8.61, 7.55, 9.30, 4.2, 1)
    climbing_ivy('Right wall climbing ivy', 8.52, 7.60, 9.46, 4.6, -1)
    climbing_ivy('Window right trailing creeper', 5.96, 7.57, 9.72, 2.7, 1)

    return {'banner_count': 6, 'blueprint_board': 'HYDRAULIC PUPPET / FIG. 04',
            'potted_plants': 5, 'hanging_ivy_clusters': 3,
            'notes': 'All cloth folds, leaves, veins and blueprint linework are editable geometry.'}
