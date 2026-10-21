"""Detailed workshop defenses; authored Z-up, shield front -Y, grip at origin.

Only asset geometry is authored here.  The shared export driver owns scene setup,
materials, validation and GLB/blend delivery.  No game runtime code is imported.
"""
import math


TAU = math.tau


def _revolve_y(b, name, profile, mat, segments=64):
    """Closed surface of revolution from (radius, y), without degenerate poles."""
    vertices, rings, faces = [], [], []
    for radius, depth in profile:
        if abs(radius) < 1e-9:
            rings.append([len(vertices)])
            vertices.append((0, depth, 0))
        else:
            ring = []
            for i in range(segments):
                angle = TAU * i / segments
                ring.append(len(vertices))
                vertices.append((radius * math.cos(angle), depth,
                                 radius * math.sin(angle)))
            rings.append(ring)
    for first, second in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(first) == 1:
                faces.append((first[0], second[i], second[j]))
            elif len(second) == 1:
                faces.append((first[i], second[0], first[j]))
            else:
                faces.append((first[i], second[i], second[j], first[j]))
    return b.mesh(name, vertices, faces, mat)


def _clip_x(outline, bound, keep_greater):
    result = []
    for a, c in zip(outline, outline[1:] + outline[:1]):
        a_inside = a[0] >= bound if keep_greater else a[0] <= bound
        c_inside = c[0] >= bound if keep_greater else c[0] <= bound
        if a_inside:
            result.append(a)
        if a_inside != c_inside:
            amount = (bound - a[0]) / (c[0] - a[0])
            result.append((bound, a[1] + (c[1] - a[1]) * amount))
    return result


def _cambered_solid(b, name, outline, front, thickness, mat, bevel=0):
    vertices = [(x, front(x, z), z) for x, z in outline]
    vertices += [(x, front(x, z) + thickness, z) for x, z in outline]
    count = len(outline)
    faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
    faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count)
                 for i in range(count))
    return b.mesh(name, vertices, faces, mat, bevel=bevel)


def _outline_band(b, name, outline, scale, front, thickness, mat):
    inner = [(x * scale[0], z * scale[1]) for x, z in outline]
    loops = [outline, inner, outline, inner]
    vertices = []
    for loop_index, loop in enumerate(loops):
        vertices.extend((x, front(x, z) + (thickness if loop_index > 1 else 0), z)
                        for x, z in loop)
    count, faces = len(outline), []
    for i in range(count):
        j = (i + 1) % count
        faces.extend(((i, count + i, count + j, j),
                      (2 * count + i, 2 * count + j, 3 * count + j, 3 * count + i),
                      (i, j, 2 * count + j, 2 * count + i),
                      (count + i, 3 * count + i, 3 * count + j, count + j)))
    return b.mesh(name, vertices, faces, mat, bevel=.0008)


def _wrap(b, name, start, end, radius, turns=9, axis='z'):
    points = []
    for i in range(turns * 16 + 1):
        t = i / (turns * 16)
        angle = t * TAU * turns
        along = start + (end - start) * t
        if axis == 'x':
            points.append((along, radius * math.cos(angle), radius * math.sin(angle)))
        else:
            points.append((radius * math.cos(angle), radius * math.sin(angle), along))
    b.curve(name, points, .0011, 'leather_edge')


def _handgrip(b, name, span=.15, mount_y=-.035):
    for side in (-1, 1):
        x = side * span / 2
        b.box(name + '_Mount_' + str(side), (x, mount_y, 0), (.025, .022, .055),
              'brass_dark', bevel=.003)
        b.beam(name + '_Standoff_' + str(side), (x, mount_y + .001, 0), (x, 0, 0),
               .010, 'brass', vertices=16)
        for z in (-.017, .017):
            b.rivet(name + '_MountScrew_' + str(side) + '_' + str(z),
                    (x, mount_y + .014, z), r=.0045, axis=(0, 1, 0))
    b.cylinder(name + '_BeechCore', (0, 0, 0), .016, span, 'wood_dark',
               vertices=24, axis=(1, 0, 0))
    b.cylinder(name + '_LeatherSleeve', (0, 0, 0), .018, span * .84, 'leather',
               vertices=24, axis=(1, 0, 0))
    for side in (-1, 1):
        b.cylinder(name + '_Ferrule_' + str(side), (side * span * .45, 0, 0),
                   .020, .010, 'brass', vertices=24, axis=(1, 0, 0))
    _wrap(b, name + '_SpiralBinding', -span * .40, span * .40, .0183, axis='x')


def _buckler(ctx):
    b = ctx.new_asset('short', 'Broquel de latón', role='secondary')
    b.root['equipment_kind'] = 'shield'
    b.root['equipment_id'] = 'short'
    b.root['triangle_budget'] = 25000
    b.root['source_front_axis'] = '-Y'
    b.root['gltf_front_axis'] = '+Z'
    b.root['nominal_radius'] = .23
    b.root['reference_style'] = 'W1–W4: beech, turned brass, steel, wrapped leather'
    front = lambda radius: -.058 - .067 * (1 - (radius / .216) ** 2)
    outline = [(.212 * math.cos(TAU * i / 64), .212 * math.sin(TAU * i / 64))
               for i in range(64)]
    for i in range(7):
        left, right = -.212 + i * .424 / 7 + .0008, -.212 + (i + 1) * .424 / 7 - .0008
        plank = _clip_x(_clip_x(outline, left, True), right, False)
        if len(plank) >= 3:
            b.profile('Buckler_BeechBacking_%02d' % i, plank, -.060, -.035,
                      'wood' if i % 2 else 'wood_light', bevel=.0018)
    _revolve_y(b, 'Buckler_SteelRaisedBowl',
               [(0, -.125), (.035, -.124), (.075, -.117), (.12, -.103),
                (.165, -.086), (.197, -.069), (.216, -.058),
                (.216, -.050), (.197, -.061), (.165, -.078),
                (.12, -.095), (.075, -.109), (.035, -.116), (0, -.117)], 'steel')
    b.torus('Buckler_RolledBrassRim', (0, -.055, 0), .222, .008, 'brass',
            axis=(0, 1, 0), segments=64, minor_segments=8)
    b.torus('Buckler_DarkRimRebate', (0, -.060, 0), .209, .0025, 'brass_dark',
            axis=(0, 1, 0), segments=64, minor_segments=6)
    for radius, tube in ((.176, .0025), (.081, .0022), (.069, .0035)):
        b.torus('Buckler_TurnedRing_' + str(radius), (0, front(radius) - .004, 0),
                radius, tube, 'brass', axis=(0, 1, 0), segments=64, minor_segments=6)
    b.sphere('Buckler_CentralSteelUmbo', (0, -.122, 0), (.060, .026, .060),
             'steel_dark', segments=32, rings=12)
    b.torus('Buckler_UmboBrassCollar', (0, -.137, 0), .052, .003,
            'brass', axis=(0, 1, 0), segments=48, minor_segments=6)
    b.rivet('Buckler_UmboSlottedCap', (0, -.150, 0), r=.011, mat='brass')
    for i in range(16):
        angle = TAU * i / 16
        radius = .198
        b.rivet('Buckler_PerimeterFastener_%02d' % i,
                (radius * math.cos(angle), front(radius) - .003,
                 radius * math.sin(angle)), r=.005)
        # Fine paired chisel marks follow the curvature of the spun steel bowl.
        if i % 2 == 0:
            for offset in (-.021, .021):
                points = []
                for radius in (.092, .111, .137, .158):
                    a = angle + offset + .09 * (radius - .09)
                    points.append((radius * math.cos(a), front(radius) - .0017,
                                   radius * math.sin(a)))
                b.curve('Buckler_RadialInlay_%02d_%+.3f' % (i, offset),
                        points, .0009, 'brass_dark')
    for x in (-.125, .125):
        b.box('Buckler_BackReinforcement_' + str(x), (x, -.029, 0),
              (.025, .010, .270), 'brass_dark', bevel=.002)
        for z in (-.115, .115):
            b.rivet('Buckler_BackStud_' + str(x) + '_' + str(z),
                    (x, -.022, z), r=.0045, axis=(0, 1, 0))
    _handgrip(b, 'Buckler_Grip')
    b.socket('Socket_Grip_Secondary', (0, 0, 0))
    b.socket('Socket_DefenseCenter', (0, -.060, 0))
    return b


def _long_shield(ctx):
    b = ctx.new_asset('long', 'Escudo de duelas', role='secondary')
    b.root['equipment_kind'] = 'shield'
    b.root['equipment_id'] = 'long'
    b.root['triangle_budget'] = 25000
    b.root['source_front_axis'] = '-Y'
    b.root['gltf_front_axis'] = '+Z'
    b.root['nominal_width'] = .44
    b.root['nominal_height'] = .72
    outline = [(-.145, .36), (.145, .36), (.196, .326), (.220, .245),
               (.220, -.125), (.185, -.245), (.112, -.320), (0, -.36),
               (-.112, -.320), (-.185, -.245), (-.220, -.125),
               (-.220, .245), (-.196, .326)]
    front = lambda x, z: -.057 - .034 * (1 - (x / .22) ** 2)
    inner = [(x * .94, z * .955) for x, z in outline]
    for i in range(7):
        left, right = -.22 + i * .44 / 7 + .0010, -.22 + (i + 1) * .44 / 7 - .0010
        plank = _clip_x(_clip_x(inner, left, True), right, False)
        if len(plank) >= 3:
            _cambered_solid(b, 'LongShield_Duela_%02d' % i, plank, front, .026,
                            ['wood_light', 'wood', 'wood'][i % 3], bevel=.002)
    _outline_band(b, 'LongShield_RolledBrassBorder', outline, (.935, .958),
                  lambda x, z: front(x, z) - .005, .014, 'brass')
    for factor, offset, material in ((1, -.006, 'brass_dark'), (.925, -.007, 'brass')):
        line = [(x * factor, front(x * factor, z * factor) + offset, z * factor)
                for x, z in outline]
        b.curve('LongShield_EdgeBead_' + str(factor), line + line[:1], .0018, material)
    for i in range(len(outline)):
        a, c = outline[i], outline[(i + 1) % len(outline)]
        for j, t in enumerate((.15, .65)):
            x, z = (a[0] + (c[0] - a[0]) * t) * .967, (a[1] + (c[1] - a[1]) * t) * .978
            b.rivet('LongShield_BorderStud_%02d_%d' % (i, j),
                    (x, front(x, z) - .010, z), r=.0042)
    # Small local mounting plates expose the handmade plank construction.
    for z in (-.205, .210):
        for x in (-.126, 0, .126):
            b.box('LongShield_FaceCleat_' + str(x) + '_' + str(z),
                  (x, front(x, z) - .004, z), (.032, .009, .054), 'brass_dark', bevel=.002)
            for dz in (-.017, .017):
                b.rivet('LongShield_CleatScrew_' + str(x) + '_' + str(z + dz),
                        (x, front(x, z) - .011, z + dz), r=.0038)
    plaque = [(-.064, .090), (.064, .090), (.064, -.032), (.039, -.079),
              (0, -.105), (-.039, -.079), (-.064, -.032)]
    b.profile('LongShield_HydraulicEscutcheon', plaque, -.104, -.094,
              'brass', bevel=.002)
    inset = [(x * .87, z * .87) for x, z in plaque]
    b.profile('LongShield_EnamelInset', inset, -.107, -.103, 'enamel_black', bevel=.001)
    for x in (-.027, 0, .027):
        b.beam('LongShield_HydraulicUpright_' + str(x), (x, -.111, -.032),
               (x, -.111, .047 if x else .064), .003, 'brass', vertices=8)
    for z in (-.025, .013):
        b.beam('LongShield_HydraulicCrossbar_' + str(z), (-.035, -.111, z),
               (.035, -.111, z), .003, 'brass', vertices=8)
    drop = [(0, -.057), (.011, -.072), (.009, -.083), (0, -.089),
            (-.009, -.083), (-.011, -.072)]
    b.profile('LongShield_WaterDropSeal', drop, -.113, -.108, 'brass', bevel=.001)
    for z in (-.19, .19):
        brace = [(-.180, z + .018), (.180, z + .018),
                 (.180, z - .018), (-.180, z - .018)]
        _cambered_solid(b, 'LongShield_BackCrossBrace_' + str(z), brace,
                        lambda x, zz: front(x, zz) + .026, .014, 'brass_dark', bevel=.002)
        for x in (-.155, -.065, .065, .155):
            b.rivet('LongShield_BackBraceScrew_' + str(x) + '_' + str(z),
                    (x, front(x, z) + .044, z), r=.0048, axis=(0, 1, 0))
    _handgrip(b, 'LongShield_Handgrip', span=.15, mount_y=-.050)
    # The second leather loop is a visibly separate forearm retention strap.
    for x in (-.083, .083):
        b.box('LongShield_StrapAnchor_' + str(x), (x, -.040, -.185),
              (.030, .012, .050), 'brass', bevel=.002)
        b.rivet('LongShield_StrapAnchorStud_' + str(x), (x, -.031, -.185),
                r=.0055, axis=(0, 1, 0))
    for z in (-.200, -.171):
        points = [(.083 * math.cos(math.pi * i / 20),
                   -.027 + .068 * math.sin(math.pi * i / 20), z) for i in range(21)]
        b.curve('LongShield_LeatherStrapEdge_' + str(z), points, .003, 'leather_edge')
    strap_vertices = []
    for i in range(21):
        angle = math.pi * i / 20
        x, y = .083 * math.cos(angle), -.027 + .068 * math.sin(angle)
        strap_vertices.extend(((x, y, -.200), (x, y, -.171)))
    strap_faces = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2) for i in range(20)]
    # Two surfaces retain thickness even when viewed from behind the mannequin.
    second = [(x, y + .004, z) for x, y, z in strap_vertices]
    count = len(strap_vertices)
    strap_faces += [tuple(count + k for k in reversed(face)) for face in strap_faces[:]]
    for i in range(20):
        for edge in (0, 1):
            a, c = i * 2 + edge, (i + 1) * 2 + edge
            strap_faces.append((a, c, c + count, a + count))
    strap_faces.extend(((0, count, count + 1, 1),
                        (count - 2, count - 1, 2 * count - 1, 2 * count - 2)))
    b.mesh('LongShield_LeatherForearmStrap', strap_vertices + second, strap_faces, 'leather')
    b.socket('Socket_Grip_Secondary', (0, 0, 0))
    b.socket('Socket_DefenseCenter', (0, -.075, 0))
    return b


def _dagger(ctx):
    b = ctx.new_asset('knife', 'Daga de parada', role='secondary')
    b.root['equipment_kind'] = 'parrying_dagger'
    b.root['equipment_id'] = 'knife'
    b.root['triangle_budget'] = 25000
    b.root['source_forward_axis'] = '+Z'
    b.root['gltf_forward_axis'] = '+Y'
    b.root['nominal_reach'] = .42
    b.root['secondary_only'] = True
    # Four diamond-section faces keep the central steel ridge legible in glancing light.
    stations = [(.110, .025, .0055), (.155, .027, .0055),
                (.290, .017, .0045), (.386, .006, .0025)]
    vertices, faces = [], []
    for z, width, depth in stations:
        vertices.extend(((-width, 0, z), (0, -depth, z),
                         (width, 0, z), (0, depth, z)))
    vertices.append((0, 0, .42))
    faces.append((3, 2, 1, 0))
    for i in range(len(stations) - 1):
        for j in range(4):
            faces.append((i * 4 + j, i * 4 + (j + 1) % 4,
                          (i + 1) * 4 + (j + 1) % 4, (i + 1) * 4 + j))
    for j in range(4):
        faces.append((12 + j, 12 + (j + 1) % 4, 16))
    b.mesh('Dagger_DiamondGroundSteelBlade', vertices, faces, 'steel')
    b.box('Dagger_BrassBladeCollar', (0, 0, .100), (.061, .025, .020), 'brass', bevel=.003)
    for side in (-1, 1):
        quillon = [(side * x, -.002, z + .09) for x, z in ((.020, -.002), (.046, -.003),
                   (.068, .002), (.080, .013), (.083, .025))]
        b.curve('Dagger_CurvedQuillon_' + str(side), quillon, .006, 'brass')
        b.sphere('Dagger_QuillonFinial_' + str(side), (side * .083, -.002, .115),
                 (.008, .008, .009), 'brass', segments=16, rings=8)
    ring = [(.057 * math.cos(TAU * i / 48), -.021,
             .061 + .045 * math.sin(TAU * i / 48)) for i in range(49)]
    b.curve('Dagger_RapierStyleFingerRing', ring, .0045, 'brass')
    b.cylinder('Dagger_BeechHandleCore', (0, 0, 0), .016, .148,
               'wood_dark', vertices=24)
    b.cylinder('Dagger_LeatherHandleSleeve', (0, 0, 0), .018, .128,
               'leather', vertices=24)
    _wrap(b, 'Dagger_DiagonalLeatherBinding', -.062, .062, .0183, turns=9)
    for z in (-.077, .077):
        b.cylinder('Dagger_TurnedFerrule_' + str(z), (0, 0, z), .021, .012,
                   'brass', vertices=32)
        b.torus('Dagger_FerruleGroove_' + str(z), (0, 0, z), .021, .0013,
                'brass_dark', segments=32, minor_segments=6)
    b.cylinder('Dagger_PommelNeck', (0, 0, -.095), .014, .024,
               'brass_dark', vertices=24)
    b.sphere('Dagger_Pommel', (0, 0, -.127), (.022, .020, .022),
             'brass', segments=24, rings=12)
    b.cylinder('Dagger_PommelEndCap', (0, 0, -.147), .013, .004,
               'brass_dark', vertices=24)
    b.rivet('Dagger_VisiblePeenedTang', (0, 0, -.1472), r=.006,
            axis=(0, 0, -1), mat='steel_dark')
    # The etched line stops before the point and lies on the blade's front ridge.
    b.curve('Dagger_FrontRidgeInlay', [(0, -.0058, .132), (0, -.0058, .170),
            (0, -.0048, .275), (0, -.0031, .355)], .00065, 'brass_dark')
    for z in (.132, .145):
        b.rivet('Dagger_CollarPin_' + str(z), (0, -.0060, z), r=.002,
                mat='brass', slot=False)
    b.socket('Socket_Grip_Secondary', (0, 0, 0))
    b.socket('Socket_Strike', (0, 0, .42))
    b.socket('Socket_BladeGuard', (0, 0, .100))
    return b


def build_defenses(ctx):
    """Register three standalone assets; ``none`` intentionally has no mesh."""
    return [_buckler(ctx), _long_shield(ctx), _dagger(ctx)]
