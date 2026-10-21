"""Generate deterministic, seamless 512px wear textures without touching models.

Run with the bundled Python (requires NumPy and Pillow). Base color PNGs use
sRGB encoding; ORM and tangent normals contain linear data. ORM = R ambient
occlusion, G roughness, B metallic. Normals use glTF/OpenGL +Y convention.
These maps describe local surface variation, never baked lighting or shadows.
"""
from hashlib import sha256
import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/assets/characters/v3/textures'
SIZE = 512
SEED = 431907
RNG = np.random.default_rng(SEED)
Y, X = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
U, V = X / SIZE, Y / SIZE
TAU = 2 * np.pi


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def wrapped(value):
    return (value + .5) % 1 - .5


def noise(blur_pixels):
    """Gaussian-filtered periodic noise, normalized to unit standard deviation."""
    source = RNG.normal(size=(SIZE, SIZE))
    frequencies = np.fft.fftfreq(SIZE)
    fx, fy = np.meshgrid(frequencies, frequencies)
    filt = np.exp(-.5 * (TAU * blur_pixels) ** 2 * (fx * fx + fy * fy))
    result = np.fft.ifft2(np.fft.fft2(source) * filt).real
    return (result - result.mean()) / result.std()


def directional_rows():
    source = RNG.normal(size=SIZE)
    filt = np.exp(-.5 * (TAU * .48 * np.fft.fftfreq(SIZE)) ** 2)
    rows = np.fft.ifft(np.fft.fft(source) * filt).real
    rows = (rows - rows.mean()) / rows.std()
    return np.broadcast_to(rows[:, None], (SIZE, SIZE))


def segments(count, length_range, width_range, angle_range):
    """Sparse, softly terminated marks; wrapped coordinates avoid tile borders."""
    result = np.zeros((SIZE, SIZE))
    for _ in range(count):
        cx, cy = RNG.random(2)
        length = RNG.uniform(*length_range)
        width = RNG.uniform(*width_range)
        angle = RNG.uniform(*angle_range)
        dx, dy = wrapped(U - cx), wrapped(V - cy)
        along = dx * np.cos(angle) + dy * np.sin(angle)
        across = -dx * np.sin(angle) + dy * np.cos(angle)
        cap = 1 - smoothstep(length * .39, length * .5, np.abs(along))
        mark = np.exp(-.5 * (across / width) ** 2) * cap
        result = np.maximum(result, mark)
    return result


def cells(count):
    """Fine irregular hide pebbles from a periodic jittered nearest-cell field."""
    offsets = RNG.uniform(.10, .90, size=(count, count, 2))
    gx, gy = np.floor(U * count).astype(int), np.floor(V * count).astype(int)
    lx, ly = U * count - gx, V * count - gy
    nearest = np.full((SIZE, SIZE), 10.0)
    for row in [-1, 0, 1]:
        for column in [-1, 0, 1]:
            seeds = offsets[(gy + row) % count, (gx + column) % count]
            distance = (column + seeds[..., 0] - lx) ** 2 + (row + seeds[..., 1] - ly) ** 2
            nearest = np.minimum(nearest, distance)
    return np.sqrt(nearest)


def srgb_from_linear(value):
    value = np.clip(value, 0, 1)
    return np.where(value <= .0031308, 12.92 * value,
                    1.055 * np.power(value, 1 / 2.4) - .055)


def tangent_normals(height, strength):
    """Periodic central differences; PNG rows run down while UV +V runs up."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .5 * strength
    row_dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * .5 * strength
    normal = np.stack((-dx, row_dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    assert np.max(np.abs(np.linalg.norm(normal, axis=-1) - 1)) < 1e-12
    return normal * .5 + .5


def orm(ao, roughness, metallic):
    return np.stack((ao, roughness, np.broadcast_to(metallic, ao.shape)), axis=-1)


def statistics(data):
    return {'min': [float(v) for v in data.min(axis=(0, 1))],
            'mean': [float(v) for v in data.mean(axis=(0, 1))],
            'max': [float(v) for v in data.max(axis=(0, 1))]}


def save_png(name, data, role):
    assert data.shape == (SIZE, SIZE, 3)
    assert np.isfinite(data).all() and data.min() >= 0 and data.max() <= 1
    pixels = np.round(data * 255).astype(np.uint8)
    path = OUT / name
    Image.fromarray(pixels).save(path, format='PNG', optimize=True)
    with Image.open(path) as check:
        assert check.size == (SIZE, SIZE) and check.mode == 'RGB'
        assert np.array_equal(np.asarray(check), pixels)
    decoded = pixels.astype(np.float64) / 255
    entry = {'file': name, 'role': role, 'size': [SIZE, SIZE], 'mode': 'RGB8',
             'encoding': 'sRGB' if role == 'basecolor' else 'linear data',
             'bytes': path.stat().st_size, 'sha256': sha256(path.read_bytes()).hexdigest(),
             'encoded_0_to_1': statistics(decoded)}
    if role == 'orm':
        assert decoded[..., 0].min() >= .88
        entry['channels'] = ['ambient occlusion', 'roughness', 'metallic']
    if role == 'normal':
        vectors = decoded * 2 - 1
        lengths = np.linalg.norm(vectors, axis=-1)
        assert np.max(np.abs(lengths - 1)) < .006
        entry['convention'] = 'glTF tangent-space OpenGL +Y; normalized before RGB8 quantization'
        entry['decoded_unit_length'] = {'min': float(lengths.min()), 'mean': float(lengths.mean()),
                                        'max': float(lengths.max())}
        tilt = np.degrees(np.arctan2(np.linalg.norm(vectors[..., :2], axis=-1), vectors[..., 2]))
        entry['tilt_degrees_p99'] = float(np.quantile(tilt, .99))
    return entry


OUT.mkdir(parents=True, exist_ok=True)
manifest = {'generator': 'scripts/create-character-wear-v3.py', 'seed': SEED, 'resolution': SIZE,
            'materials_renamed': False, 'geometry_modified': False,
            'technique': 'Periodic procedural PBR data; no generated imagery, letters, baked lights or global shadows.',
            'usage': {'basecolor': 'sRGB texture. Values encode complete color; use a neutral factor when replacing an existing flat color.',
                      'orm': 'Linear non-color. R AO, G roughness, B metallic; glTF can share the image for occlusion and metallicRoughness.',
                      'normal': 'Linear non-color, glTF/OpenGL +Y tangent normals; normalTexture.scale=1.',
                      'uv': 'Repeat wrapping. Marks are local material wear; there is no geometry-aware curvature/AO bake.'},
            'files': []}

# SATIN BRASS: horizontal lathe/tool passes, scattered hairline scratches and
# sparse contact patina. Base color has no painted reflection or lighting AO.
rows = directional_rows()
fine = noise(.48)
slow = noise(13)
machining = .68 * rows + .32 * np.sin(TAU * (V * 187 + .008 * np.sin(U * TAU * 3)))
scratches = segments(29, (.045, .24), (.00065, .0012), (-.07, .07))
cross_marks = segments(9, (.018, .075), (.0008, .0014), (-1.1, 1.1))
contact = segments(10, (.026, .10), (.0018, .0037), (-.12, .12))
patina_field = noise(4.0) + .22 * noise(.85)
patina_threshold = np.quantile(patina_field, .984)
patina = np.clip((patina_field - patina_threshold) / .82, 0, 1)
patina = np.maximum(patina, .28 * contact * smoothstep(.1, 1.5, slow))
warm = np.array([.46, .245, .070])
metal_color = warm[None, None, :] * (1 + .008 * machining[..., None] + .005 * slow[..., None])
metal_color += contact[..., None] * np.array([.017, .011, .004])
metal_color = metal_color * (1 - patina[..., None]) + np.array([.13, .125, .052]) * patina[..., None]
brass_roughness = np.clip(.355 + .024 * machining + .007 * fine + .075 * contact
                         + .045 * cross_marks + .145 * patina, .27, .55)
brass_metallic = .965 - .48 * patina
brass_ao = np.clip(.991 - .024 * scratches - .015 * cross_marks - .030 * patina, .93, 1)
brass_height = .027 * machining + .008 * fine - .071 * scratches - .043 * cross_marks - .025 * patina
manifest['files'].append(save_png('brass-basecolor.png', srgb_from_linear(metal_color), 'basecolor'))
manifest['files'].append(save_png('brass-orm.png', orm(brass_ao, brass_roughness, brass_metallic), 'orm'))
manifest['files'].append(save_png('brass-normal.png', tangent_normals(brass_height, .95), 'normal'))
manifest['brass'] = {'linear_base_color': warm.tolist(), 'machining_direction': 'horizontal U / circumferential tool passes',
                     'patina_coverage_above_0_15': float((patina > .15).mean()),
                     'metallic_coverage_below_0_90': float((brass_metallic < .90).mean()),
                     'roughness_range_unquantized': [float(brass_roughness.min()), float(brass_roughness.max())],
                     'normal_strength_used_in_generator': .95}
assert brass_roughness.min() >= .27 and brass_roughness.max() <= .55
assert brass_metallic.min() >= .30 and brass_metallic.max() <= 1
assert (brass_metallic < .90).mean() < .035, 'Patina would cover too much brass.'

# BROWN LEATHER: tiny irregular pebbles, a discreet sewn seam, smooth contact
# wear and mild dust. Stitch capsules are geometric marks, never faux text.
distance = cells(81)
pebbles = 1 - smoothstep(.14, .61, distance)
leather_fine = noise(.48)
hide_variation = noise(9)
wear = smoothstep(.6, 1.9, noise(19)) * .50
seam_distance = np.abs(wrapped(U - .117))
seam = np.exp(-.5 * (seam_distance / .0016) ** 2)
stitch_row = wrapped(V * 32 + .13)
stitches = np.exp(-.5 * (stitch_row / .072) ** 2) * np.exp(-.5 * (seam_distance / .0050) ** 6)
hide = np.array([.105, .036, .016])[None, None, :] * (1 + .045 * hide_variation[..., None]
                                                                     + .030 * (pebbles[..., None] - .5))
hide += wear[..., None] * np.array([.022, .013, .006])
hide = hide * (1 - .075 * seam[..., None])
hide = hide * (1 - .42 * stitches[..., None]) + np.array([.157, .066, .025]) * (.42 * stitches[..., None])
leather_roughness = np.clip(.565 + .060 * (1 - pebbles) + .017 * hide_variation
                           - .075 * wear + .022 * seam, .46, .73)
leather_ao = np.clip(.989 - .031 * (1 - pebbles) - .020 * seam, .93, 1)
leather_height = .071 * pebbles + .005 * leather_fine - .035 * seam + .073 * stitches
manifest['files'].append(save_png('leather-basecolor.png', srgb_from_linear(hide), 'basecolor'))
manifest['files'].append(save_png('leather-orm.png', orm(leather_ao, leather_roughness, 0), 'orm'))
manifest['files'].append(save_png('leather-normal.png', tangent_normals(leather_height, 1.10), 'normal'))
manifest['leather'] = {'linear_base_color': [.105, .036, .016], 'grain_cells_per_tile': 81,
                       'stitch_count_per_seam': 32, 'wear_style': 'Mild lighter contact areas, no exposed-white damage.',
                       'roughness_range_unquantized': [float(leather_roughness.min()), float(leather_roughness.max())]}

# CLOTH: fine orthogonal interlacing with rough dusty fibers. No color map is
# supplied, so the fighter/boss cloth palette remains the existing material's.
warp = np.sin(TAU * U * 128)
weft = np.sin(TAU * V * 128)
over_under = np.cos(TAU * U * 64) * np.cos(TAU * V * 64)
cloth_fine = noise(.48)
dust = smoothstep(.20, 1.7, noise(12))
cloth_height = .025 * (warp + weft) + .012 * over_under + .003 * cloth_fine
cloth_roughness = np.clip(.857 + .024 * warp + .024 * weft + .042 * dust + .006 * cloth_fine,
                          np.ceil(.78 * 255) / 255, np.floor(.96 * 255) / 255)
cloth_ao = np.clip(.987 - .020 * (1 - warp) * (1 - weft) / 4 - .005 * dust, .95, 1)
manifest['files'].append(save_png('cloth-normal.png', tangent_normals(cloth_height, .82), 'normal'))
manifest['files'].append(save_png('cloth-orm.png', orm(cloth_ao, cloth_roughness, 0), 'orm'))
manifest['cloth'] = {'basecolor': 'Not generated; preserve the existing material color.',
                     'weave_threads_per_tile': [128, 128], 'dust_is_roughness_only': True,
                     'roughness_range_unquantized': [float(cloth_roughness.min()), float(cloth_roughness.max())]}
assert cloth_roughness.min() >= .78 and cloth_roughness.max() <= .96

assert len(manifest['files']) == 8
stats_file = OUT / 'wear-map-stats.json'
stats_file.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('WD_V3_WEAR_MAPS', json.dumps({'ok': True, 'seed': SEED, 'size': SIZE,
                                    'png_files': len(manifest['files']),
                                    'total_png_bytes': sum(f['bytes'] for f in manifest['files']),
                                    'patina_coverage': manifest['brass']['patina_coverage_above_0_15'],
                                    'stats': str(stats_file)}), flush=True)
