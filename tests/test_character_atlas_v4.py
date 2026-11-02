"""Focused CPU checks for the v4 character atlas; no Blender/GPU/runtime needed."""
import copy
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/create-character-atlas-v4.py'


def fixture():
    kinds = ['wood', 'wood', 'endgrain', 'brass', 'leather', 'cloth', 'steel', 'brass']
    return {'schema': 4, 'size': 1024, 'padding': 4, 'regions': [
        {'id': f'{kind}-{i}', 'material': kind, 'kind': kind,
         'rect': [(i % 4) * 128, (i // 4) * 128, 128, 128],
         'seed': 100 + i, 'grainAxis': 'v',
         'function': 'housing' if i == 0 else ('sole' if i == 1 else 'body')}
        for i, kind in enumerate(kinds)]}


class CharacterAtlasV4(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCRIPT.exists(), 'v4 atlas generator must exist'
        spec = importlib.util.spec_from_file_location('character_atlas_v4', SCRIPT)
        cls.atlas = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.atlas)

    def test_outputs_real_rgb8_pngs_and_explicit_channel_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            stats = self.atlas.generate(fixture(), Path(folder), previews=False)
            images = {}
            for name in ['basecolor', 'normal', 'orm']:
                with Image.open(Path(folder) / f'body-{name}.png') as image:
                    self.assertEqual(image.mode, 'RGB')
                    images[name] = np.array(image)
            for name, pixels in images.items():
                self.assertEqual(pixels.shape, (1024, 1024, 3), name)
                self.assertEqual(pixels.dtype, np.uint8)
            normals = images['normal'].astype(float) / 127.5 - 1
            self.assertLess(np.abs(np.linalg.norm(normals, axis=2) - 1).max(), .012)
            self.assertGreater(normals[:, :, 2].min(), .5)
            for r in fixture()['regions']:
                x, y, w, h = r['rect']
                bc = images['basecolor'][y+4:y+h-4, x+4:x+w-4]
                orm = images['orm'][y+4:y+h-4, x+4:x+w-4]
                if r['kind'] in ['brass', 'steel']:
                    self.assertGreater(orm[:, :, 2].mean(), 235)
                    self.assertGreater(np.ptp(orm[:, :, 1]), 35)
                else:
                    self.assertEqual(orm[:, :, 2].max(), 0)
                self.assertGreater(orm[:, :, 0].mean(), 225)
                if r['kind'] == 'cloth':
                    self.assertTrue(np.array_equal(bc[:, :, 0], bc[:, :, 1]))
                    self.assertTrue(np.array_equal(bc[:, :, 1], bc[:, :, 2]))
                if r['kind'] == 'wood':
                    mean = bc.mean(axis=(0, 1)) / 255
                    self.assertTrue(.32 < mean[0] < .48, mean)
                    self.assertTrue(.18 < mean[1] < .31, mean)
                    self.assertTrue(.07 < mean[2] < .17, mean)
            self.assertEqual(stats['memory']['rgba8_mip_bytes'], 16777212)
            self.assertEqual(stats['memory']['shared_variant_count'], 3)
            self.assertEqual(stats['maps']['normal']['color_space'], 'linear')
            self.assertEqual(stats['maps']['normal']['convention'], 'OpenGL +Y')
            self.assertEqual(stats['maps']['orm']['channels'], ['AO', 'roughness', 'metallic'])
            self.assertEqual(len({r['basecolor_sha256'] for r in stats['regions']}), 8)
            self.assertTrue((Path(folder) / 'atlas-stats.json').exists())

    def test_region_order_and_random_seed_do_not_contaminate_other_tiles(self):
        layout = fixture()
        a = self.atlas.build_atlas(layout)
        layout['regions'].reverse()
        b = self.atlas.build_atlas(layout)
        for name in a:
            self.assertTrue(np.array_equal(a[name], b[name]), name)
        layout['regions'][-1]['seed'] += 1
        c = self.atlas.build_atlas(layout)
        for name in a:
            self.assertFalse(np.array_equal(a[name][:128, :128], c[name][:128, :128]), name)
            self.assertTrue(np.array_equal(a[name][128:], c[name][128:]), name)
            self.assertTrue(np.array_equal(a[name][:128, 128:], c[name][:128, 128:]), name)

    def test_png_bytes_and_receipt_are_reproducible_across_layout_order(self):
        layout = fixture()
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            self.atlas.generate(layout, Path(one), previews=False)
            layout['regions'].reverse()
            self.atlas.generate(layout, Path(two), previews=False)
            for name in ['body-basecolor.png', 'body-normal.png', 'body-orm.png']:
                self.assertEqual((Path(one)/name).read_bytes(), (Path(two)/name).read_bytes())
            stats_one = json.loads((Path(one)/'atlas-stats.json').read_text())
            stats_two = json.loads((Path(two)/'atlas-stats.json').read_text())
            # Layout hash records input ordering; all generated material bytes stay identical.
            self.assertEqual(stats_one['maps'], stats_two['maps'])
            self.assertEqual(stats_one['regions'], stats_two['regions'])

    def test_dilation_copies_only_own_nearest_interior(self):
        a = self.atlas.build_atlas(fixture())
        for pixels in a.values():
            for r in fixture()['regions']:
                x, y, w, h = r['rect']
                tile = pixels[y:y+h, x:x+w]
                for margin in range(4):
                    self.assertTrue(np.array_equal(tile[margin, 4:-4], tile[4, 4:-4]))
                    self.assertTrue(np.array_equal(tile[-1-margin, 4:-4], tile[-5, 4:-4]))
                    self.assertTrue(np.array_equal(tile[4:-4, margin], tile[4:-4, 4]))
                    self.assertTrue(np.array_equal(tile[4:-4, -1-margin], tile[4:-4, -5]))

    def test_normal_green_points_along_positive_uv_y(self):
        # PNG y increases downward: a downward height slope points the +Y normal upward.
        height = np.broadcast_to(np.arange(12, dtype=float)[:, None], (12, 12)) * .1
        normal = self.atlas.height_to_normal(height)
        self.assertTrue(np.all(normal[:, :, 1] > 127))
        self.assertTrue(np.all(np.abs(normal[:, :, 0].astype(int) - 128) <= 1))
        self.assertTrue(np.all(self.atlas.height_to_normal(height.T)[:, :, 0] < 128))

    def test_bearing_contact_polishes_shaft_more_than_generic_body(self):
        region = fixture()['regions'][3]
        body, _ = self.atlas.region_material(region)
        region['function'] = 'contact'
        bearing, _ = self.atlas.region_material(region)
        self.assertLess(bearing['orm'][:, :, 1].mean(), body['orm'][:, :, 1].mean()-10)

    def test_endgrain_accepts_radial_axis_from_geometry_layout(self):
        layout = fixture()
        layout['regions'][2]['grainAxis'] = 'radial'
        maps = self.atlas.build_atlas(layout)
        self.assertGreater(np.ptp(maps['normal'][4:124, 260:380, 0]), 0)

    def test_rejects_overlap_duplicate_id_bad_region_and_dimensions(self):
        cases = []
        for mutate in [lambda l: l['regions'][1].update(rect=[0, 0, 128, 128]),
                       lambda l: l['regions'][1].update(id=l['regions'][0]['id']),
                       lambda l: l['regions'][0].update(rect=[-1, 0, 128, 128]),
                       lambda l: l['regions'][0].update(rect=[0, 0, 8, 8]),
                       lambda l: l['regions'][0].update(kind='plastic'),
                       lambda l: l.update(size=512)]:
            layout = copy.deepcopy(fixture())
            mutate(layout)
            cases.append(layout)
        for layout in cases:
            with self.assertRaises(ValueError):
                self.atlas.build_atlas(layout)

    def test_delivered_pngs_match_current_layout_and_recomputed_pixels(self):
        folder = ROOT/'docs/assets/characters/v4/textures'
        layout = json.loads((folder.parent/'atlas-layout.json').read_text(encoding='utf-8-sig'))
        stats = json.loads((folder/'atlas-stats.json').read_text())
        current_hash = hashlib.sha256(json.dumps(layout, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(stats['layout_sha256'], current_hash)
        self.assertEqual(stats['coverage']['region_count'], len(layout['regions']))
        self.assertEqual(len({r['basecolor_sha256'] for r in stats['regions']}), len(layout['regions']))
        expected = self.atlas.build_atlas(layout)
        for name, pixels in expected.items():
            path = folder/f'body-{name}.png'
            self.assertEqual(stats['maps'][name]['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            with Image.open(path) as image:
                self.assertEqual(image.mode, 'RGB')
                self.assertTrue(np.array_equal(pixels, np.array(image)))


if __name__ == '__main__':
    unittest.main()
