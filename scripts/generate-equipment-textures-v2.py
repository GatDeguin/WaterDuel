"""Generate the v2 material sources without opening or saving any v1 scene."""
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from equipment_v2_textures import generate_textures

destination=ROOT/'docs/assets/equipment/v2'
destination.mkdir(parents=True,exist_ok=True)
manifest=generate_textures(destination/'textures',ROOT/'docs/assets/equipment/textures')
(destination/'texture-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
print('EQUIPMENT_TEXTURES_V2_OK '+json.dumps(manifest['metadata']),flush=True)
