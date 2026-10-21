"""Material-only workshop wear maps; no mesh, UV, scene or source-file changes.

Call generate_textures(output_dir, source_dir) from Blender's Python. All PNGs
are deterministic 512-square RGB8, with identical opposite rows/columns.
Base colors are sRGB; normal and ORM are linear data. ORM is R=1 (no baked
shadow), G=family roughness, B=1 for metals/enamel and 0 for wood/leather.
Each material supplies the original metallic factor and a roughness ratio,
preserving its baseline while sharing texture memory with related materials.
Normal scales stay .35-.45; no displacement or silhouettes are involved.
"""
from pathlib import Path
import hashlib
import struct
import zlib

import bpy
import numpy as np


SIZE = 512
MATERIALS = {
    'WD_wood': ('wood', .39, 0),
    'WD_wood_dark': ('wood', .43, 0),
    'WD_wood_light': ('wood', .38, 0),
    'WD_leather': ('leather', .52, 0),
    'WD_leather_edge': ('leather_edge', .51, 0),
    'WD_brass': ('brass', .27, .86),
    'WD_brass_dark': ('brass', .40, .78),
    'WD_steel': ('steel', .23, .94),
    'WD_steel_dark': ('steel', .36, .85),
    'WD_enamel_black': ('enamel', .30, .22),
}
FAMILY_ROUGHNESS = {'wood': .43, 'leather': .52, 'leather_edge': .52,
                    'brass': .40, 'steel': .36, 'enamel': .30}


def _srgb_to_linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def _linear_to_srgb(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)


def _periodic(a):
    """Include a duplicate seam sample, exactly equal even after PNG encoding."""
    a = np.array(a, dtype=np.float32, copy=True)
    a[-1] = a[0]
    a[:, -1] = a[:, 0]
    return a


def _smooth(a, passes=1):
    core = np.array(a[:-1, :-1], dtype=np.float32, copy=True)
    for _ in range(passes):
        core = (core * 4 + np.roll(core, 1, 0) + np.roll(core, -1, 0)
                + np.roll(core, 1, 1) + np.roll(core, -1, 1)) / 8
    return _periodic(np.pad(core, ((0, 1), (0, 1)) + ((0, 0),) * (core.ndim - 2), mode='wrap'))


def _seam_source(a, band=36):
    """Blend only source boundary bands; retain the existing central grain."""
    a = np.array(a, dtype=np.float32, copy=True)
    for axis in (0, 1):
        source = a.copy()
        for i in range(band):
            weight = .5 * (1 + np.cos(np.pi * i / (band - 1)))
            left, right = [slice(None)] * a.ndim, [slice(None)] * a.ndim
            left[axis], right[axis] = i, -1 - i
            left, right = tuple(left), tuple(right)
            midpoint = (source[left] + source[right]) * .5
            a[left] = source[left] * (1 - weight) + midpoint * weight
            a[right] = source[right] * (1 - weight) + midpoint * weight
    return _periodic(a)


def _source_rgb(source_dir, filename):
    path = Path(source_dir) / filename
    if not path.is_file():
        path = Path(source_dir) / 'textures' / filename
    if not path.is_file():
        raise FileNotFoundError(str(path))
    image = bpy.data.images.load(str(path.resolve()), check_existing=False)
    try:
        if tuple(image.size) != (SIZE, SIZE):
            raise ValueError('%s must be 512x512' % path)
        pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        # bpy exposes the source PNG's encoded samples. Work in linear light,
        # then encode once for the new PNG. The source image stays untouched.
        rgb = _srgb_to_linear(pixels.reshape(SIZE, SIZE, 4)[:, :, :3])
    finally:
        bpy.data.images.remove(image)
    return _smooth(_seam_source(rgb), 2), hashlib.sha256(path.read_bytes()).hexdigest()


def _field(u, v, seed, frequency=12, modes=22, directional=False):
    rng = np.random.default_rng(seed)
    result = np.zeros_like(u)
    for _ in range(modes):
        kx = int(rng.integers(1, frequency + 1))
        ky = int(rng.integers(1, 4 if directional else frequency + 1))
        phase = rng.uniform(0, np.pi * 2)
        result += np.cos(np.pi * 2 * (kx * u + ky * v) + phase) / np.sqrt(kx + ky)
    result -= np.mean(result)
    result /= max(float(np.std(result)) * 2.8, 1e-6)
    return _periodic(np.clip(result, -1, 1))


def _normal(height, strength=3):
    core = height[:-1, :-1]
    dx = (np.roll(core, -1, 1) - np.roll(core, 1, 1)) * .5
    dy = (np.roll(core, -1, 0) - np.roll(core, 1, 0)) * .5
    vectors = np.stack((-dx * strength, -dy * strength, np.ones_like(core)), axis=-1)
    vectors /= np.linalg.norm(vectors, axis=-1, keepdims=True)
    encoded = vectors * .5 + .5
    return _periodic(np.pad(encoded, ((0, 1), (0, 1), (0, 0)), mode='wrap'))


def _png_bytes(pixels):
    """Small standard-library PNG writer: explicit RGB8, adaptive row filters."""
    data = np.rint(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
    if data.shape != (SIZE, SIZE, 3):
        raise ValueError('Expected 512x512 RGB pixels')
    if not np.array_equal(data[0], data[-1]) or not np.array_equal(data[:, 0], data[:, -1]):
        raise ValueError('Texture edges are not exactly periodic')
    # Blender pixel arrays start at bottom-left; PNG stores the top row first.
    data = np.flipud(data).reshape(SIZE, SIZE * 3)
    rows, previous = [], np.zeros(SIZE * 3, dtype=np.uint8)
    for row in data:
        left = np.zeros_like(row); left[3:] = row[:-3]
        candidates = (row, (row.astype(np.int16) - left).astype(np.uint8),
                      (row.astype(np.int16) - previous).astype(np.uint8))
        scores = [np.abs(candidate.astype(np.int8).astype(np.int16)).sum() for candidate in candidates]
        index = int(np.argmin(scores))
        rows.append(bytes([index]) + candidates[index].tobytes())
        previous = row
    def chunk(kind, payload):
        return (struct.pack('>I', len(payload)) + kind + payload
                + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff))
    header = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


def generate_textures(output_dir, source_dir):
    """Return {families, materials, metadata}; materials is the patch contract.

    All material roughness/metal baselines survive independently through the
    returned roughnessFactor and metallicFactor. Preserve the original
    baseColorFactor for untextured metal, enamel and leather_edge.
    """
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    axis = np.linspace(0, 1, SIZE, dtype=np.float32)
    u, v = np.meshgrid(axis, axis)
    wood, wood_hash = _source_rgb(source_dir, 'Workshop_Beech_BaseColor.png')
    leather, leather_hash = _source_rgb(source_dir, 'Workshop_Leather_BaseColor.png')
    broad = _field(u, v, 180624, frequency=6)
    fine = _field(u, v, 180625, frequency=48, modes=28)
    rub = _periodic((.5 - .5 * np.cos(v * np.pi * 2)) ** 2 * (.72 + .28 * broad))
    contact = _periodic(np.clip((_field(u, v, 180626, frequency=9) + .10) * 1.3, 0, 1))

    # No generic dark UV borders: existing island boundaries are not reliable
    # physical edges. The wear remains restrained and continuously periodic.
    wood_luma = wood @ np.array([.2126, .7152, .0722], dtype=np.float32)
    grain = (wood_luma - float(np.mean(wood_luma))) / max(float(np.std(wood_luma)), .001)
    wood_color = wood * (1 + .032 * broad[:, :, None] - .026 * contact[:, :, None])
    wood_color += rub[:, :, None] * np.array([.0020, .0013, .0006], dtype=np.float32)
    wood_height = _periodic(np.clip(grain, -2.5, 2.5) * .032 + fine * .014)

    leather_pore = (leather @ np.array([.2126, .7152, .0722], dtype=np.float32))
    leather_pore = (leather_pore - _smooth(leather_pore, 8)) / max(float(np.std(leather_pore)), .001)
    leather_color = leather * (1 + .045 * broad[:, :, None] - .025 * contact[:, :, None])
    leather_color += rub[:, :, None] * np.array([.0018, .0007, .00025], dtype=np.float32)
    crease = np.sin(2 * np.pi * (11 * v + .28 * np.sin(2 * np.pi * u))) ** 18
    leather_height = _periodic(leather_pore * .025 + fine * .019 - crease * .012)
    leather_delta = _periodic(.033 * broad + .024 * contact - .045 * rub)

    brush = _periodic(np.sin(2 * np.pi * (107 * v + .22 * np.sin(2 * np.pi * u))))
    hairline = _periodic(np.maximum(0, np.cos(2 * np.pi * (37 * v + .16 * np.sin(2 * np.pi * u)))) ** 28)
    steel_patina = _periodic(np.clip(broad * 1.15 + .2, 0, .75))
    steel_color = np.ones((SIZE, SIZE, 3), dtype=np.float32)
    steel_color *= (1 - .055 * steel_patina[:, :, None] - .012 * hairline[:, :, None])
    steel_color *= np.array([.985, .991, 1.0], dtype=np.float32)
    steel_height = _periodic(.009 * brush - .006 * hairline + .010 * fine)

    brass_patina = _periodic(np.clip(_field(u, v, 180627, frequency=7) * 1.2 + .16, 0, .75))
    brass_color = np.ones((SIZE, SIZE, 3), dtype=np.float32)
    brass_color -= brass_patina[:, :, None] * np.array([.045, .070, .095], dtype=np.float32)
    brass_color -= hairline[:, :, None] * .008

    enamel_color = np.repeat((.982 + .009 * broad - .010 * contact)[:, :, None], 3, axis=2)
    edge_color = np.repeat((.978 + .014 * broad - .018 * contact)[:, :, None], 3, axis=2)
    family_data = {
        'wood': (wood_color, wood_height, .030 * broad + .035 * contact - .015 * rub, .45),
        'leather': (leather_color, leather_height, leather_delta, .42),
        'leather_edge': (edge_color, leather_height, leather_delta, .42),
        'steel': (steel_color, steel_height, .035 * broad + .052 * steel_patina - .012 * rub, .38),
        'brass': (brass_color, steel_height, .035 * broad + .085 * brass_patina - .016 * rub, .40),
        'enamel': (enamel_color, .008 * fine, .010 * broad + .018 * contact, .35),
    }
    written, by_hash, families, material_maps, deltas = {}, {}, {}, {}, {}

    def write(name, pixels, srgb=False):
        pixels = _periodic(_linear_to_srgb(pixels) if srgb else pixels)
        payload = _png_bytes(pixels)
        digest = hashlib.sha256(payload).hexdigest()
        if digest in by_hash:
            return by_hash[digest]
        path = output / (name + '.png')
        path.write_bytes(payload)
        written[str(path)] = {'bytes': len(payload), 'sha256': digest}
        by_hash[digest] = str(path)
        return str(path)

    for family, (color, height, delta, scale) in family_data.items():
        delta = _periodic(delta - float(np.mean(delta)))
        deltas[family] = np.clip(delta, -.06, .08)
        families[family] = {
            'baseColor': write('WorkshopV2_' + family + '_BaseColor', color, True),
            'normal': write('WorkshopV2_' + family + '_Normal', _normal(height)),
            'normalScale': scale,
        }
        values = np.clip(FAMILY_ROUGHNESS[family] + deltas[family], .04, .96)
        metallic = 0 if family in ('wood', 'leather', 'leather_edge') else 1
        orm = np.stack((np.ones_like(values), values, np.full_like(values, metallic)), axis=-1)
        families[family]['orm'] = write('WorkshopV2_' + family + '_ORM', orm)
        families[family]['baselineRoughness'] = FAMILY_ROUGHNESS[family]
    for name, (family, roughness, metallic) in MATERIALS.items():
        entry = dict(families[family])
        entry['roughnessFactor'] = roughness / FAMILY_ROUGHNESS[family]
        entry['metallicFactor'] = metallic
        entry['baselineRoughness'] = roughness
        entry['baselineMetallic'] = metallic
        values = np.clip(FAMILY_ROUGHNESS[family] + deltas[family], .04, .96) * entry['roughnessFactor']
        entry['roughnessRange'] = [float(np.min(values)), float(np.max(values))]
        entry['family'] = family
        material_maps[name] = entry
    total_bytes = sum(item['bytes'] for item in written.values())
    if total_bytes > 3 * 1024 * 1024:
        raise ValueError('Texture set exceeds 3 MiB budget: %d bytes' % total_bytes)
    return {
        'families': families,
        'materials': material_maps,
        'metadata': {
            'size': SIZE, 'format': 'PNG RGB8', 'periodicEdges': True,
            'orm': 'R=1; G=family roughness times material ratio; B=1 metal/enamel or0 dielectric, times original metallicFactor',
            'baseColorSpace': 'sRGB', 'normalAndORMSpace': 'linear',
            'sourceSha256': {'Workshop_Beech_BaseColor.png': wood_hash,
                             'Workshop_Leather_BaseColor.png': leather_hash},
            'bytes': total_bytes, 'budgetBytes': 3 * 1024 * 1024,
            'uniqueImages': len(written),
            'rgba8BaseBytes': len(written) * SIZE * SIZE * 4,
            'rgba8FullMipBytesApprox': int(len(written) * SIZE * SIZE * 4 * 4 / 3),
            'textures': written,
        },
    }
