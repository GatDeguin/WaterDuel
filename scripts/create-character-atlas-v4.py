"""Deterministic UV1 construction atlas, authored as material data, without lighting.

Rectangles include four pixels of edge dilation. Pixel coordinates start at the
upper left; positive texture V points upward. The same triplet is reused by all
three character variants; cloth receives its variant tint in the glTF material.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
KINDS = {'wood', 'endgrain', 'brass', 'leather', 'cloth', 'steel'}
MAPS = ('basecolor', 'normal', 'orm')
PADDING = 4


def validate_layout(layout):
    if layout.get('schema') != 4 or layout.get('size') != 1024:
        raise ValueError('Atlas requires schema 4 and size 1024')
    if layout.get('padding', PADDING) != PADDING:
        raise ValueError('Atlas UV1 contract requires 4px padding inside every rect')
    used = np.zeros((1024, 1024), dtype=bool)
    ids = set()
    regions = layout.get('regions', [])
    if not regions:
        raise ValueError('Atlas requires visible regions')
    for r in regions:
        if not isinstance(r.get('id'), str) or not r['id'] or r['id'] in ids:
            raise ValueError('Each region requires a unique nonempty id')
        ids.add(r['id'])
        if r.get('kind') not in KINDS or not r.get('material'):
            raise ValueError(f'Unsupported material region: {r["id"]}')
        rect = r.get('rect', [])
        if len(rect) != 4 or any(type(n) is not int for n in rect):
            raise ValueError('Rect requires integer x, y, width, height')
        x, y, w, h = rect
        if min(x, y) < 0 or min(w, h) <= PADDING * 2 + 1 or x+w > 1024 or y+h > 1024:
            raise ValueError(f'Rect outside atlas or lacks interior: {r["id"]}')
        if used[y:y+h, x:x+w].any():
            raise ValueError(f'Rect overlaps another region: {r["id"]}')
        if r.get('grainAxis', 'v') not in ('u', 'v') and not (r['kind'] == 'endgrain' and r.get('grainAxis') == 'radial'):
            raise ValueError('grainAxis must be u/v, or radial for endgrain')
        used[y:y+h, x:x+w] = True
    return regions


def region_rng(region):
    # No process-randomized hash(), no global RNG, no dependence on layout order.
    key = json.dumps([region['id'], region.get('seed', 0)], separators=(',', ':'))
    return np.random.default_rng(int.from_bytes(hashlib.sha256(key.encode()).digest()[:16], 'little'))


def noise(rng, w, h, cells):
    values = rng.uniform(-1, 1, (max(2, cells), max(2, cells))).astype(np.float32)
    return np.array(Image.fromarray(values).resize((w, h), Image.Resampling.BICUBIC))


def to_byte(value):
    if not np.isfinite(value).all():
        raise ValueError('Nonfinite material data')
    return np.round(np.clip(value, 0, 1) * 255).astype(np.uint8)


def height_to_normal(height):
    dy, dx = np.gradient(height)
    # PNG y is inverted with respect to glTF UV +V. This is OpenGL +Y, not DirectX.
    normal = np.stack([-np.clip(dx, -.55, .55), np.clip(dy, -.55, .55), np.ones_like(dx)], axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    return to_byte(normal * .5 + .5)


def region_material(region):
    _, _, tw, th = region['rect']
    w, h = tw - PADDING * 2, th - PADDING * 2
    rng = region_rng(region)
    u, v = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    cross, along = (u, v) if region.get('grainAxis', 'v') == 'v' else (v, u)
    broad = noise(rng, w, h, 5)
    fine = noise(rng, w, h, 24)
    micro = rng.uniform(-1, 1, (h, w))
    edge = np.minimum.reduce([u, v, 1-u, 1-v])
    rim = np.exp(-edge * 60)
    end = np.exp(-np.minimum(along, 1-along) * 28)
    function = region.get('function', 'body')
    # Functional masks model physical abrasion/residue, never a light direction.
    if function in ('housing', 'recess'):
        contact = .8 * end * (.8 + .2 * fine)
        protected = np.exp(-((edge - .055) / .018) ** 2)
    elif function == 'sole':
        contact = np.clip(.5 + .5 * broad, 0, 1) * (.65 + .35 * rim)
        protected = np.zeros_like(u)
    elif function == 'contact':
        # Axle/pin bearing journals polish where they rotate inside the bushing;
        # residue remains at the captive end shoulders, rather than on the journal.
        contact = np.clip(.78*np.exp(-((along-.5)/.32)**4) + .30*rim, 0, 1)
        protected = end*.45
    else:
        contact = np.clip(rim * (.65 + .35 * fine) + .25 * end, 0, 1)
        protected = np.exp(-((edge - .065) / .022) ** 2) * .35
    contact = np.clip(contact, 0, 1)
    protected = np.clip(protected, 0, 1)
    kind = region['kind']
    crack = np.zeros_like(u)
    stitch = np.zeros_like(u)
    patina = np.zeros_like(u)
    metallic = np.zeros_like(u)
    ao = np.ones_like(u)

    if kind in ('wood', 'endgrain'):
        phase = rng.uniform(0, 2*np.pi)
        if kind == 'wood':
            warped = cross + .016*np.sin(along * 8 + phase) + .012*broad
            across_pixels = w if region.get('grainAxis', 'v') == 'v' else h
            grain_frequency = min(rng.uniform(14, 23), across_pixels/5)
            grain = np.sin(warped * grain_frequency * 2*np.pi + phase)
            pores = np.clip((grain - .70) / .30, 0, 1) ** 2
            # Superficial checks follow fibers and terminate near joint housings.
            for _ in range(3):
                center = rng.uniform(.12, .88) + .007*np.sin(along*12+phase)
                line = np.exp(-((cross-center)/max(.003, .65/w))**2)
                start = rng.choice([0.0, 1.0])
                length = rng.uniform(.10, .32)
                crack = np.maximum(crack, line * np.exp(-((along-start)/length)**4))
            if function not in ('housing', 'recess'):
                crack *= .48
        else:
            radius = np.sqrt(((u-.5)*1.07)**2 + ((v-.5)*.96)**2)
            angle = np.arctan2(v-.5, u-.5)
            ring_frequency = min(rng.uniform(20, 32), min(w, h)/3.5)
            grain = np.sin((radius + .012*broad) * ring_frequency*2*np.pi + phase)
            pores = np.clip((grain-.6)/.4, 0, 1)**2
            # Endgrain checks are radial, aligned with the direction of wood fibers.
            ray = np.arctan2(np.sin(angle-phase), np.cos(angle-phase))
            crack = np.exp(-(ray/.016)**2) * np.clip((radius-.2)*3, 0, 1) * .65
        base = np.array([.400, .240, .115]) * rng.uniform(.97, 1.03)
        variation = .055*grain + .045*broad + .018*fine - .055*crack + .035*contact
        color = base[None, None, :] * (1+variation[:, :, None])
        height = .16*grain - .13*pores - .19*crack + .035*micro
        rough = .60 + .045*broad + .035*pores - .16*contact + .06*crack
        ao = 1 - .11*crack - .018*pores
    elif kind in ('brass', 'steel'):
        cx, cy = u-.5, v-.5
        radius = np.sqrt(cx*cx + cy*cy)
        angle = np.arctan2(cy, cx)
        circular_frequency = min(rng.uniform(28, 44), min(w, h)/3.8)
        radial_frequency = min(rng.integers(45, 82), max(6, min(w, h)//2))
        circular = np.sin(radius * circular_frequency*2*np.pi + broad*.6)
        # Fade radial cuts near the center where angular texel density collapses.
        radial = np.sin(angle*radial_frequency + radius*9) * np.clip(radius*4-.3, 0, 1)
        machining = .035*circular + .013*radial
        # Patina is chemically altered metal in protected seats, not painted shade.
        patina = np.clip(protected*(.7+.3*broad) + .09*np.maximum(broad-.35, 0), 0, 1)
        polish = np.clip(contact + .35*np.exp(-((radius-.41)/.035)**2), 0, 1)
        base = np.array([.67, .46, .19]) if kind == 'brass' else np.array([.47, .50, .54])
        oxidation = np.array([.32, .38, .21]) if kind == 'brass' else np.array([.34, .35, .35])
        color = base[None, None, :]*(1-patina[:, :, None]*.30) + oxidation[None, None, :]*patina[:, :, None]*.30
        color *= (1+.018*fine[:, :, None])
        height = machining + .015*micro + .035*patina
        rough = .39 + .12*patina + .022*fine - .22*polish + .018*circular
        metallic = 1 - .08*patina
        ao = 1 - .07*protected
    elif kind == 'leather':
        # The two edge seams are actual small height relief; no dark fake slots.
        seam = np.exp(-((cross-.075)/.010)**2) + np.exp(-((cross-.925)/.010)**2)
        holes = np.clip(np.cos(along*2*np.pi*max(7, round(h/9))), 0, 1)**5
        stitch = np.clip(seam*holes, 0, 1)
        crease = np.exp(-((cross-(.5+.018*broad))/.04)**2) * end
        color = np.array([.205, .108, .052])[None, None, :] * (1 + .075*broad[:, :, None] + .025*fine[:, :, None])
        color += stitch[:, :, None]*np.array([.12, .105, .075])
        height = .045*fine + .025*micro + .14*stitch - .09*crease
        rough = .66 + .04*fine - .19*contact - .04*stitch + .08*crease
        ao = 1 - .10*seam*(1-holes) - .08*crease
    else:
        # Neutral yarn albedo preserves Mint/Burgundy glTF baseColorFactor tint.
        warp = np.sin(u*max(6, w/3)*2*np.pi)
        weft = np.sin(v*max(6, h/3)*2*np.pi)
        weave = warp*weft
        gray = .73 + .018*broad + .016*weave + .007*fine
        color = np.repeat(gray[:, :, None], 3, axis=2)
        height = .07*weave + .022*micro
        rough = .83 + .035*weave - .06*contact
        ao = 1 - .025*np.maximum(-weave, 0)
    maps = {'basecolor': to_byte(color), 'normal': height_to_normal(height),
            'orm': to_byte(np.stack([ao, rough, metallic], axis=2))}
    masks = {'functional_wear': contact, 'fiber_checks': crack, 'protected_residue': patina,
             'leather_stitches': stitch}
    return maps, masks


def build_atlas(layout):
    regions = validate_layout(layout)
    size = layout['size']
    maps = {'basecolor': np.full((size, size, 3), 128, dtype=np.uint8),
            'normal': np.tile(np.array([128, 128, 255], dtype=np.uint8), (size, size, 1)),
            'orm': np.tile(np.array([255, 180, 0], dtype=np.uint8), (size, size, 1))}
    for region in regions:
        local, _ = region_material(region)
        x, y, w, h = region['rect']
        for name in MAPS:
            maps[name][y:y+h, x:x+w] = np.pad(local[name], ((PADDING, PADDING), (PADDING, PADDING), (0, 0)), mode='edge')
    return maps


def digest(data):
    return hashlib.sha256(data).hexdigest()


def previews_for(maps, layout, output):
    sheet = Image.new('RGB', (1536, 544), '#20242c')
    draw = ImageDraw.Draw(sheet)
    for i, name in enumerate(MAPS):
        image = Image.fromarray(maps[name]).resize((512, 512), Image.Resampling.NEAREST)
        sheet.paste(image, (i*512, 32))
        draw.text((i*512+10, 10), f'{name} / '+('sRGB' if name == 'basecolor' else 'linear data'), fill='white')
    sheet.save(output / 'atlas-map-preview.png')
    # One region per material, with real unlit texels enlarged for channel review.
    selected = [next((r for r in layout['regions'] if r['kind'] == kind), None) for kind in sorted(KINDS)]
    selected = [r for r in selected if r]
    detail = Image.new('RGB', (len(selected)*192, 3*192+48), '#20242c')
    draw = ImageDraw.Draw(detail)
    for col, region in enumerate(selected):
        x, y, w, h = region['rect']
        draw.text((col*192+6, 5), region['kind'], fill='white')
        for row, name in enumerate(MAPS):
            sample = Image.fromarray(maps[name][y+4:y+h-4, x+4:x+w-4]).resize((192, 192), Image.Resampling.NEAREST)
            detail.paste(sample, (col*192, 48+row*192))
    detail.save(output / 'atlas-material-detail.png')


def generate(layout, output, previews=True):
    maps = build_atlas(layout)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    memory = sum(max(1, 1024 >> level)**2*4 for level in range(11))*3
    stats = {'schema': 4, 'size': 1024, 'padding_px': PADDING,
             'rect_convention': 'upper-left; rect includes 4px dilation; UV1 uses interior',
             'authoring': 'unlit intrinsic albedo; roughness wear; geometric microrelief; no baked lights/reflections',
             'memory': {'rgb8_level0_bytes': 1024*1024*3*3, 'rgba8_mip_bytes': memory,
                        'rgba8_mip_mib': memory / 1048576, 'budget_mib': 16,
                        'shared_variant_count': 3, 'unique_triplets': 1},
             'maps': {}, 'regions': []}
    for name in MAPS:
        path = output / f'body-{name}.png'
        Image.fromarray(maps[name]).save(path, optimize=False)
        stats['maps'][name] = {'file': path.name, 'mode': 'RGB', 'bit_depth': 8,
                               'color_space': 'sRGB' if name == 'basecolor' else 'linear',
                               'sha256': digest(path.read_bytes()), 'file_bytes': path.stat().st_size}
    stats['maps']['normal']['convention'] = 'OpenGL +Y'
    stats['maps']['orm']['channels'] = ['AO', 'roughness', 'metallic']
    for region in sorted(layout['regions'], key=lambda r: r['id']):
        local, masks = region_material(region)
        decoded = local['normal'].astype(float)/127.5-1
        record = {key: region[key] for key in ('id', 'material', 'kind', 'rect', 'seed') if key in region}
        record.update({'grainAxis': region.get('grainAxis', 'v'), 'function': region.get('function', 'body'),
                       'basecolor_sha256': digest(local['basecolor'].tobytes()),
                       'basecolor_mean_srgb': (local['basecolor'].mean(axis=(0, 1))/255).round(6).tolist(),
                       'orm_mean': (local['orm'].mean(axis=(0, 1))/255).round(6).tolist(),
                       'roughness_min_max': [float(local['orm'][:, :, 1].min()/255), float(local['orm'][:, :, 1].max()/255)],
                       'normal_max_unit_error': float(np.abs(np.linalg.norm(decoded, axis=2)-1).max()),
                       'normal_min_z': float(decoded[:, :, 2].min()),
                       'mask_coverage_gt_0_1': {key: float(np.mean(value > .1)) for key, value in masks.items()}})
        stats['regions'].append(record)
    interiors = sum((r['rect'][2]-8)*(r['rect'][3]-8) for r in layout['regions'])
    tiles = sum(r['rect'][2]*r['rect'][3] for r in layout['regions'])
    stats['coverage'] = {'region_count': len(layout['regions']), 'tile_pixels': tiles,
                         'interior_pixels': interiors, 'dilated_pixels': tiles-interiors,
                         'interior_fraction': interiors/(1024*1024)}
    stats['layout_sha256'] = digest(json.dumps(layout, sort_keys=True, separators=(',', ':')).encode())
    (output / 'atlas-stats.json').write_text(json.dumps(stats, indent=2)+'\n', encoding='utf-8')
    if previews:
        previews_for(maps, layout, output)
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout', type=Path, default=ROOT/'docs/assets/characters/v4/atlas-layout.json')
    parser.add_argument('--output', type=Path, default=ROOT/'docs/assets/characters/v4/textures')
    parser.add_argument('--no-previews', action='store_true')
    args = parser.parse_args()
    stats = generate(json.loads(args.layout.read_text(encoding='utf-8-sig')), args.output, not args.no_previews)
    print(json.dumps({'regions': stats['coverage']['region_count'], 'maps': {n: s['sha256'] for n, s in stats['maps'].items()},
                      'rgba8_mip_mib': stats['memory']['rgba8_mip_mib']}, indent=2))


if __name__ == '__main__':
    main()
