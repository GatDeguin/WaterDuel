"""Render one reproducible CPU preview of the finalized editable v2 workshop.

blender -b output/blender/WaterDuel_Atelier_v2.blend --python scripts/preview-workshop-editable-v2.py
Only the PNG preview and its JSON receipt are written; the .blend is never saved.
"""
import bpy
import hashlib
import json
import os
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND = os.path.join(ROOT, "output", "blender", "WaterDuel_Atelier_v2.blend")
PREVIEW = os.path.join(ROOT, "output", "blender", "WaterDuel_Atelier_v2_duelo.png")
RECEIPT = os.path.join(ROOT, "output", "blender", "preview-editable-v2.json")


def sha256(path):
    with open(path, "rb") as source:
        return hashlib.sha256(source.read()).hexdigest()


def render_enabled(obj):
    return not obj.hide_render and any(not collection.hide_render for collection in obj.users_collection)


started = time.perf_counter()
source_sha = sha256(BLEND)
assert os.path.normcase(os.path.abspath(bpy.data.filepath)) == os.path.normcase(BLEND), "Open the finalized v2 editable copy"
scene = bpy.context.scene
assert scene.camera and scene.camera.name.startswith("01"), "Expected the current 01 duel camera"
receipt = {
    "status": "started",
    "timestampUTC": datetime.now(timezone.utc).isoformat(),
    "source": "output/blender/WaterDuel_Atelier_v2.blend",
    "sourceSha256": source_sha,
    "blenderVersion": bpy.app.version_string,
    "preview": "output/blender/WaterDuel_Atelier_v2_duelo.png",
    "engine": "CYCLES",
    "device": "CPU",
    "resolution": [960, 540],
    "samples": 24,
    "denoising": True,
    "camera": scene.camera.name,
    "frame": scene.frame_current,
    "renderEnabledLights": sum(obj.type == "LIGHT" and render_enabled(obj) for obj in scene.objects),
    "renderEnabledMeshes": sum(obj.type == "MESH" and render_enabled(obj) for obj in scene.objects),
    "cameraCount": sum(obj.type == "CAMERA" for obj in scene.objects),
    "lightingChanged": False,
    "materialsChanged": False,
    "blendSaved": False,
}
try:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = PREVIEW
    render_started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    receipt["renderSeconds"] = time.perf_counter() - render_started
    receipt["sourceSha256After"] = sha256(BLEND)
    receipt["sourcePreserved"] = receipt["sourceSha256After"] == source_sha
    assert receipt["sourcePreserved"], "The editable input changed during preview"
    receipt["previewBytes"] = os.path.getsize(PREVIEW)
    receipt["previewSha256"] = sha256(PREVIEW)
    receipt["status"] = "passed"
except Exception as error:
    receipt["status"] = "failed"
    receipt["error"] = repr(error)
    raise
finally:
    receipt["warmTotalSeconds"] = time.perf_counter() - started
    with open(RECEIPT, "w", encoding="utf-8") as target:
        json.dump(receipt, target, ensure_ascii=False, indent=2)
    print("WORKSHOP_EDITABLE_V2_PREVIEW", json.dumps(receipt), flush=True)
