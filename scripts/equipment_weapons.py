"""Standalone WaterDuel workshop weapons, authored in metres around the main grip.

Source: X is cross-width, -Y is the presentation front, +Z is weapon forward.
glTF export maps Blender +Z to glTF +Y. No runtime files or external assets.
The shared equipment_common context owns scene setup, materials and export.
"""
import json
from math import cos, sin, pi


def _lathe(b, name, section, mat, segments=40):
    """Revolve a closed radius/Z section, including the inside of hollow fittings."""
    verts = [(r * cos(i * 2 * pi / segments), r * sin(i * 2 * pi / segments), z)
             for r, z in section for i in range(segments)]
    faces = []
    for j in range(len(section)):
        nxt = (j + 1) % len(section)
        for i in range(segments):
            ni = (i + 1) % segments
            faces.append((j * segments + i, j * segments + ni,
                          nxt * segments + ni, nxt * segments + i))
    return b.mesh(name, verts, faces, mat)


def _flat(obj):
    for face in getattr(getattr(obj, 'data', None), 'polygons', []):
        face.use_smooth = False
    return obj


def _blade(b, name, outline, depth, mat='steel'):
    """Diamond facets converge onto a real zero-thickness point on the axis."""
    count = len(outline)
    cx = sum(p[0] for p in outline) / count
    cz = sum(p[1] for p in outline) / count
    # Both sides share the apex vertex, avoiding coincident unwelded tip seams.
    verts = [(outline[0][0], 0, outline[0][1])]
    front, back = [0], [0]
    for x, z in outline[1:]:
        front.append(len(verts)); verts.append((x, -.0007, z))
    for x, z in outline[1:]:
        back.append(len(verts)); verts.append((x, .0007, z))
    fc = len(verts); verts.append((cx, -depth / 2, cz))
    bc = len(verts); verts.append((cx, depth / 2, cz))
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((fc, front[i], front[j]))
        faces.append((bc, back[j], back[i]))
        if i == 0:
            faces.append((front[i], back[j], front[j]))
        elif j == 0:
            faces.append((front[i], back[i], front[j]))
        else:
            faces.append((front[i], back[i], back[j], front[j]))
    return _flat(b.mesh(name, verts, faces, mat))


def _grip(b, prefix, center, radius, length, turns=7):
    """A leather sleeve, continuous spiral binding, stitched seam and brass ends."""
    b.cylinder(prefix + '_Leather_Sleeve', (0, 0, center), radius, length,
               'leather', vertices=32, radius2=radius * .965)
    z0 = center - length * .46
    z1 = center + length * .46
    points = []
    for i in range(turns * 18 + 1):
        u = i / (turns * 18)
        angle = u * turns * 2 * pi
        points.append(((radius + .0009) * cos(angle),
                       (radius + .0009) * sin(angle), z0 + (z1 - z0) * u))
    b.curve(prefix + '_Spiral_Leather_Binding', points, .0015, 'leather_edge')
    for side in (-1, 1):
        z = center + side * length * .5
        b.cylinder(prefix + ('_Heel_Collar' if side < 0 else '_Forward_Collar'),
                   (0, 0, z), radius + .003, .014, 'brass', vertices=32)
        b.torus(prefix + ('_Heel_Bead' if side < 0 else '_Forward_Bead'),
                (0, 0, z), radius + .0034, .0018, 'brass_dark',
                segments=32, minor_segments=6)
    # Brass-tinted stitches run along the visible longitudinal seam.
    for i in range(8):
        z = center - length * .37 + i * length * .105
        b.beam(prefix + '_Seam_Stitch_%02d' % i,
               (-.004, -radius - .001, z - .0014),
               (.004, -radius - .001, z + .0014), .0008, 'brass_dark', vertices=6)


def _radial_fasteners(b, prefix, radius, z, count=8, size=.004):
    for i in range(count):
        a = i * 2 * pi / count
        b.rivet(prefix + '_%02d' % i, (radius * cos(a), radius * sin(a), z),
                r=size, mat='brass', axis=(cos(a), sin(a), 0))


def _contract(b, equipment_id, reach, grip_radius, secondary=None, strike_points=None):
    b.socket('Socket_Grip_Main', (0, 0, 0))
    b.socket('Socket_Strike', (0, 0, reach))
    b.socket('Socket_Trail_Base', (0, 0, .17))
    b.socket('Socket_Trail_Tip', (0, 0, reach))
    if secondary is not None:
        b.socket('Socket_Grip_Secondary', (0, 0, secondary))
    b.root['equipment_id'] = equipment_id
    b.root['rest_reach_m'] = reach
    b.root['main_grip_radius_m'] = grip_radius
    b.root['source_forward_axis'] = '+Z'
    b.root['gltf_forward_axis'] = '+Y'
    b.root['source_front_axis'] = '-Y'
    b.root['triangle_budget'] = 25000
    b.root['two_handed'] = secondary is not None
    if strike_points:
        b.root['strike_profile_along_across_m'] = json.dumps(strike_points)


def _sword(ctx):
    b = ctx.new_asset('sword', 'Estoque del taller', role='primary')
    reach = 1.02
    _contract(b, 'sword', reach, .027)
    b.cylinder('Sword_Tang_Core', (0, 0, -.01), .016, .35, 'steel_dark', vertices=20)
    _grip(b, 'Sword_Grip', -.005, .027, .225)
    _lathe(b, 'Sword_Fluted_Pommel', [(.009, -.208), (.025, -.201), (.036, -.184),
            (.035, -.162), (.023, -.147), (.009, -.145)], 'brass', segments=12)
    b.torus('Sword_Pommel_Inlay', (0, 0, -.177), .035, .0018, 'brass_dark', segments=24, minor_segments=6)
    b.rivet('Sword_Pommel_Slotted_Pin', (0, -.036, -.178), r=.009, mat='steel_dark')
    # The cazoleta is an actual hollow spun bowl rather than a solid decorative disk.
    _lathe(b, 'Sword_Hollow_Spun_Brass_Cup', [(.024, .112), (.048, .104),
            (.084, .120), (.105, .142), (.114, .160), (.114, .169),
            (.108, .174), (.103, .157), (.080, .136), (.047, .121),
            (.024, .128)], 'brass', segments=48)
    b.torus('Sword_Rolled_Cup_Lip', (0, 0, .168), .111, .0042, 'brass', segments=48, minor_segments=8)
    b.torus('Sword_Cup_Inner_Chase', (0, 0, .135), .079, .0018, 'brass_dark', segments=40, minor_segments=6)
    b.cylinder('Sword_Cup_Dark_Central_Bushing', (0, 0, .143), .024, .046, 'steel_dark', vertices=32)
    b.cylinder('Sword_Blade_Brass_Ferrule', (0, 0, .178), .018, .039, 'brass', vertices=24)
    _radial_fasteners(b, 'Sword_Cup_Lip_Pin', .112, .158, 12, .0025)
    for side in (-1, 1):
        b.curve('Sword_Curved_Quillon_' + str(side),
                [(side * .023, 0, .115), (side * .065, 0, .118),
                 (side * .112, -.002, .125), (side * .136, -.004, .142)], .0055, 'brass')
        b.sphere('Sword_Quillon_Terminal_' + str(side), (side * .136, -.004, .142),
                 (.009, .009, .009), 'brass', segments=12, rings=6)
    b.curve('Sword_Swept_Knuckle_Bow', [(-.078, 0, .133), (-.125, 0, .088),
            (-.145, -.004, .015), (-.137, -.006, -.070),
            (-.097, -.004, -.132), (-.027, 0, -.157)], .005, 'brass')
    _blade(b, 'Sword_Diamond_Section_Rapier_Blade',
           [(0, reach), (-.009, .252), (-.006, .185), (.006, .185), (.009, .252)], .012)
    b.curve('Sword_Fine_Temper_Line', [(0, -.0059, .205), (0, -.0059, .365),
            (0, -.0042, .515)], .00065, 'steel_dark')
    return b


def _spear(ctx):
    b = ctx.new_asset('spear', 'Aguja de presión', role='primary')
    reach = 1.35
    _contract(b, 'spear', reach, .028)
    b.cylinder('Spear_Tapered_Oiled_Timber_Shaft', (0, 0, .393), .0265, 1.285,
               'wood', vertices=32, radius2=.021)
    _grip(b, 'Spear_Grip', -.012, .029, .28, turns=8)
    b.cylinder('Spear_Butt_Steel_Ferrule', (0, 0, -.239), .029, .060, 'steel_dark', vertices=24)
    b.torus('Spear_Butt_Brass_Rolled_Rim', (0, 0, -.267), .0285, .003, 'brass', segments=28, minor_segments=6)
    b.sphere('Spear_Rounded_Butt', (0, 0, -.271), (.024, .024, .013), 'brass', segments=16, rings=8)
    b.cylinder('Spear_Head_Forged_Socket', (0, 0, 1.010), .031, .145,
               'steel_dark', vertices=28, radius2=.021)
    for z, radius in [(.949, .033), (1.065, .025)]:
        b.cylinder('Spear_Brass_Ferrule_%.3f' % z, (0, 0, z), radius, .032, 'brass', vertices=32)
        b.torus('Spear_Ferrule_Bead_%.3f' % z, (0, 0, z - .010), radius + .0006,
                .0022, 'brass_dark', segments=28, minor_segments=6)
    _radial_fasteners(b, 'Spear_Socket_Rivet', .031, 1.003, 4, .004)
    _blade(b, 'Spear_Faceted_Leaf_Steel_Head', [(0, reach), (-.071, reach - .128),
            (-.046, reach - .268), (0, reach - .340),
            (.046, reach - .268), (.071, reach - .128)], .038)
    b.beam('Spear_Central_Ridge_Temper_Inlay', (0, -.0188, 1.099),
           (0, -.0188, 1.175), .0008, 'steel_dark', vertices=6)
    # An inset maker's band with mechanical pins breaks the long wooden silhouette.
    b.cylinder('Spear_Maker_Band', (0, 0, .397), .0261, .031, 'brass_dark', vertices=28)
    b.torus('Spear_Maker_Band_Upper_Bead', (0, 0, .410), .0261, .0017, 'brass', segments=24, minor_segments=6)
    b.rivet('Spear_Maker_Band_Screw', (0, -.027, .397), r=.005, mat='brass')
    return b


def _axe_edge(b, outer, inner):
    """Separate polished bevel ribbon follows the gameplay cutting outline."""
    verts, stations = [], []
    for i, ((ox, oz), (ix, iz)) in enumerate(zip(outer, inner)):
        edge = 0 if i == 0 else .0007
        of = len(verts); verts.append((ox, -edge, oz))
        inf = len(verts); verts.append((ix, -.030, iz))
        if i == 0:
            ob = of
        else:
            ob = len(verts); verts.append((ox, edge, oz))
        inb = len(verts); verts.append((ix, .030, iz))
        stations.append((of, inf, ob, inb))
    faces = []
    for i in range(len(outer) - 1):
        a, c = stations[i], stations[i + 1]
        faces += [(a[0], a[1], c[1], c[0]), (a[2], c[2], c[3], a[3]),
                  (a[1], a[3], c[3], c[1])]
        faces.append((a[0], c[0], c[2]) if i == 0 else (a[0], c[0], c[2], a[2]))
    a, c = stations[0], stations[-1]
    faces += [(a[0], a[3], a[1]), (c[0], c[1], c[3], c[2])]
    return _flat(b.mesh('Axe_Polished_Continuous_Cutting_Bevel', verts, faces, 'steel'))


def _axe(ctx):
    b = ctx.new_asset('axe', 'Hacha del carpintero', role='primary')
    reach = .92
    strike = [(0, 0), (-.0072, .1512), (-.0792, .3024), (-.2124, .2862), (-.3456, .27)]
    _contract(b, 'axe', reach, .031, strike_points=strike)
    b.cylinder('Axe_Hickory_Through_Handle', (0, 0, .225), .036, 1.030,
               'wood', vertices=28, radius2=.030)
    _grip(b, 'Axe_Grip', -.020, .038, .275, turns=8)
    b.cylinder('Axe_Butt_Brass_Shoe', (0, 0, -.276), .039, .041, 'brass', vertices=24)
    b.torus('Axe_Butt_Dark_Bead', (0, 0, -.291), .038, .002, 'brass_dark', segments=28, minor_segments=6)
    outline = [(0, reach), (-.1404, reach - .072), (-.1512, reach - .288),
               (.0108, reach - .360), (.2700, reach - .3456),
               (.3024, reach - .0792), (.1512, reach - .0072)]
    b.profile('Axe_Forged_Head_Web', outline, -.025, .025, 'steel_dark', bevel=.0015)
    _axe_edge(b, [(0, reach), (.1512, reach - .0072), (.3024, reach - .0792), (.2700, reach - .3456)],
              [(0, reach - .033), (.130, reach - .042), (.263, reach - .101), (.234, reach - .332)])
    b.cylinder('Axe_Through_Eye_Bolster', (-.026, 0, reach - .205), .059, .205,
               'steel_dark', vertices=16)
    for z in [reach - .294, reach - .119]:
        b.cylinder('Axe_Eye_Brass_Retainer_%.3f' % z, (-.026, 0, z), .063, .025, 'brass', vertices=24)
        b.torus('Axe_Eye_Retainer_Bead_%.3f' % z, (-.026, 0, z), .063, .0019, 'brass_dark', segments=28, minor_segments=6)
    b.box('Axe_Visible_Timber_Eye_Wedge', (-.026, 0, reach - .090), (.042, .045, .026), 'wood_light', bevel=.002)
    # Recess both lock faces 1.5 mm into the forged web; the original front
    # face was exactly coplanar with the head at Y=-.025 and produced a speck.
    b.box('Axe_Steel_Wedge_Lock', (-.026, 0, reach - .077), (.007, .047, .006), 'steel', bevel=.0006)
    for i, z in enumerate([reach - .255, reach - .164]):
        b.rivet('Axe_Front_Eye_Through_Bolt_%d' % i, (-.026, -.060, z), r=.010, mat='brass')
        b.rivet('Axe_Back_Eye_Through_Bolt_%d' % i, (-.026, .060, z), r=.010, mat='steel', axis=(0, 1, 0))
    b.box('Axe_Maker_Inlay_Plaque', (-.100, -.027, reach - .177), (.028, .004, .047), 'brass_dark', bevel=.002)
    b.rivet('Axe_Maker_Plaque_Pin', (-.100, -.030, reach - .177), r=.005, mat='brass')
    return b


def _maul(ctx):
    b = ctx.new_asset('maul', 'Mazo de bancada', role='primary')
    reach = 1.08
    strike = [(0, -.2625), (0, -.13125), (0, 0), (0, .13125), (0, .2625)]
    _contract(b, 'maul', reach, .043, secondary=-.22, strike_points=strike)
    b.cylinder('Maul_Through_Ash_Shaft', (0, 0, .250), .040, 1.300,
               'wood', vertices=32, radius2=.045)
    _grip(b, 'Maul_Main_Grip', 0, .044, .190, turns=6)
    _grip(b, 'Maul_Secondary_Grip', -.22, .044, .190, turns=6)
    b.cylinder('Maul_Heel_Brass_Ferrule', (0, 0, -.384), .047, .037, 'brass', vertices=28)
    b.sphere('Maul_Rounded_Pommel', (0, 0, -.407), (.046, .046, .022), 'wood_dark', segments=20, rings=10)
    # Three visibly joined timbers form a plausible laminated workshop block.
    for i, x in enumerate([-.46 / 3, 0, .46 / 3]):
        b.box('Maul_Laminated_Head_Timber_%d' % i, (x, 0, reach - .205),
              (.46 / 3 - .0015, .300, .300), 'wood_light' if i == 1 else 'wood', bevel=.004)
    for side in (-1, 1):
        b.box('Maul_Endgrain_Cheek_' + str(side), (side * .2305, 0, reach - .205),
              (.007, .289, .278), 'wood_dark', bevel=.0015)
        b.box('Maul_Lateral_Steel_Striking_Shoe_' + str(side), (side * .250, 0, reach - .205),
              (.065, .350, .300), 'steel', bevel=.0025)
    for i, z in enumerate([reach - .320, reach - .085]):
        b.box('Maul_Heavy_Brass_Clamp_Band_%d' % i, (0, 0, z), (.490, .326, .048), 'brass', bevel=.003)
        for side in (-1, 1):
            b.rivet('Maul_Clamp_Front_Screw_%d_%d' % (i, side),
                    (side * .152, -.167, z), r=.010, mat='steel')
            b.rivet('Maul_Clamp_Rear_Screw_%d_%d' % (i, side),
                    (side * .152, .167, z), r=.010, mat='steel', axis=(0, 1, 0))
    # Zero bevel on the forward plate preserves every exact gameplay contact point.
    b.box('Maul_Exact_Forward_Steel_Striking_Plate', (0, 0, reach - .0325),
          (.525, .350, .065), 'steel', bevel=0)
    for x in [-.207, .207]:
        for y in [-.145, .145]:
            b.box('Maul_Corner_Brace_%+.3f_%+.3f' % (x, y), (x, y, reach - .205),
                  (.024, .024, .224), 'brass_dark', bevel=.002)
    b.cylinder('Maul_Neck_Brass_Socket', (0, 0, reach - .382), .057, .070, 'brass', vertices=32)
    b.torus('Maul_Neck_Rolled_Socket_Lip', (0, 0, reach - .416), .056, .0035, 'brass_dark', segments=32, minor_segments=8)
    _radial_fasteners(b, 'Maul_Neck_Through_Pin', .057, reach - .379, 4, .007)
    b.cylinder('Maul_Front_Enamel_Maker_Medallion', (0, -.155, reach - .205), .041, .008,
               'enamel_black', vertices=32, axis=(0, -1, 0))
    b.torus('Maul_Medallion_Brass_Rim', (0, -.161, reach - .205), .041, .003,
            'brass', axis=(0, -1, 0), segments=32, minor_segments=6)
    for x in [-.013, .013]:
        b.beam('Maul_Maker_Mark_Upright_%+.3f' % x,
               (x, -.1645, reach - .224), (x, -.1645, reach - .184), .0022, 'brass', vertices=8)
    b.beam('Maul_Maker_Mark_Crossbar', (-.020, -.1645, reach - .207),
           (.020, -.1645, reach - .207), .0022, 'brass', vertices=8)
    return b


def build_weapons(ctx):
    """Build the four catalogue primaries; scene ownership remains with ctx."""
    return [_sword(ctx), _spear(ctx), _axe(ctx), _maul(ctx)]
