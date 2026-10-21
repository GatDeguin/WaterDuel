"""Restrained, bakeable wear for the runtime-v2 workshop material copies.

Import with runpy.run_path(...)["apply_workshop_wear"](materials, objects).
The caller owns baking, export and save operations. This module never opens,
saves or renders a file. Only WD_SOURCE_ material copies are changed.

Coordinates remain Blender Z-up while baking. wd_object is each original
piece's local coordinate, wd_generated its original 0..1 bounding box. The
global position offsets broad dirt noise so repeated pieces do not share the
same stains. Existing grain, color, roughness and normal links are retained.
"""

import json


REVISION = "workshop-wear-v2.2"


class _Graph:
    """Small node builder; all scalar masks are explicitly clamped to 0..1."""

    def __init__(self, material):
        self.nodes = material.node_tree.nodes
        self.links = material.node_tree.links
        self.frame = self.nodes.new("NodeFrame")
        self.frame.label = "V2 | restrained contact wear; original PBR retained"
        self.frame.name = "WD_WEAR_V2"

    def node(self, kind, label):
        node = self.nodes.new(kind)
        node.parent = self.frame
        node.label = label
        return node

    def connect(self, value, socket):
        if hasattr(value, "node"):
            self.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, operation, a, b=0.0):
        node = self.node("ShaderNodeMath", operation)
        node.operation = operation
        self.connect(a, node.inputs[0])
        self.connect(b, node.inputs[1])
        return node.outputs[0]

    def remap(self, value, low, high, out_low=0.0, out_high=1.0):
        node = self.node("ShaderNodeMapRange", "Localized smooth mask")
        node.interpolation_type = "SMOOTHSTEP"
        node.clamp = True
        self.connect(value, node.inputs["Value"])
        for name, val in (("From Min", low), ("From Max", high),
                          ("To Min", out_low), ("To Max", out_high)):
            node.inputs[name].default_value = val
        return node.outputs["Result"]

    def attribute(self, name):
        node = self.node("ShaderNodeAttribute", name)
        node.attribute_name = name
        return node.outputs["Vector"]

    def scale_vector(self, vector, scale):
        node = self.node("ShaderNodeVectorMath", "Physical scratch direction")
        node.operation = "MULTIPLY"
        self.connect(vector, node.inputs[0])
        node.inputs[1].default_value = scale
        return node.outputs[0]

    def noise(self, vector, scale, detail=2.0):
        node = self.node("ShaderNodeTexNoise", "Non-periodic material wear")
        node.noise_dimensions = "3D"
        self.connect(vector, node.inputs["Vector"])
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = 0.68
        return node.outputs["Fac"]

    def source(self, socket, color=False):
        if socket.is_linked:
            return socket.links[0].from_socket
        node = self.node("ShaderNodeRGB" if color else "ShaderNodeValue",
                         "Preserved original constant")
        node.outputs[0].default_value = tuple(socket.default_value) if color else float(socket.default_value)
        return node.outputs[0]

    def tint(self, color, mask, strength, multiplier):
        node = self.node("ShaderNodeMixRGB", "Palette-preserving wear multiplier")
        node.blend_type = "MULTIPLY"
        self.connect(self.math("MULTIPLY", mask, strength), node.inputs[0])
        self.connect(color, node.inputs[1])
        node.inputs[2].default_value = (*multiplier, 1.0)
        return node.outputs[0]

    def bump(self, principled, height, distance, strength):
        node = self.node("ShaderNodeBump", "Submillimetre wear over original normal")
        node.inputs["Distance"].default_value = distance
        node.inputs["Strength"].default_value = strength
        self.connect(height, node.inputs["Height"])
        original = principled.inputs["Normal"]
        if original.is_linked:
            self.links.new(original.links[0].from_socket, node.inputs["Normal"])
        self.links.new(node.outputs["Normal"], original)


def _profile(key):
    if key.startswith(("oak", "walnut", "stage")):
        return "wood"
    if key.startswith(("brass", "blackened-iron", "copper", "steel")):
        return "metal"
    if key.startswith("leather"):
        return "leather"
    if key.startswith(("forest-green", "canvas", "paper")):
        return "cloth-paper"
    if key.startswith("wall"):
        return "limewash"
    return None


def apply_workshop_wear(materials, objects):
    """Add material-specific wear to evaluated copies and return a JSON-safe report.

    materials: {safe_source_key: WD_SOURCE_ material copy}.
    objects: {safe_source_key: evaluated joined mesh}; its original procedural
    attributes must survive decimation. A single material may also shade the
    separately exported fan rotor; the same attribute contract applies there.

    The returned changed[*].channels tells the caller which maps need baking.
    Existing cached v1 normal maps must be invalidated for changed Normal maps.
    Alpha, transmission, emission, metallic and all mesh data are untouched.
    """
    report = {"revision": REVISION, "coordinateFrame": "Blender Z-up; scaled geometry",
              "changed": {}, "skipped": {}, "geometryChanged": False,
              "requiresBakeRevision": REVISION,
              "notes": ["Contact masks use face direction and original piece bounds; short-range AO only modulates deposited dirt reflectance.",
                        "No scene lighting, fog, static water or dust particles are baked.",
                        "Fine wear is designed as submillimetre normal detail, not geometric cracking."]}
    for key, material in sorted(materials.items()):
        kind = _profile(key.lower())
        if not kind:
            report["skipped"][key] = "Protected material / no wear profile"
            continue
        if not material.name.startswith("WD_SOURCE_"):
            raise ValueError("Wear may only modify WD_SOURCE_ material copies: " + material.name)
        previous = material.get("workshop_wear_v2_report")
        if previous:
            prior = json.loads(previous)
            if prior["revision"] != REVISION:
                raise ValueError("Load a fresh evaluated checkpoint before changing wear revision")
            report["changed"][key] = prior
            continue
        obj = objects.get(key)
        if obj is None or obj.type != "MESH":
            raise ValueError("Missing evaluated mesh for wear material: " + key)
        for attribute in ("wd_generated", "wd_object"):
            if obj.data.attributes.get(attribute) is None:
                raise ValueError("Missing original piece coordinates: " + key + " / " + attribute)
        principled = next((node for node in material.node_tree.nodes
                           if node.type == "BSDF_PRINCIPLED"), None)
        if principled is None:
            report["skipped"][key] = "No Principled surface; preserve source"
            continue
        before = len(material.node_tree.nodes)
        g = _Graph(material)
        base = g.source(principled.inputs["Base Color"], color=True)
        rough = g.source(principled.inputs["Roughness"])
        local = g.attribute("wd_object")
        generated = g.attribute("wd_generated")
        geom = g.node("ShaderNodeNewGeometry", "Actual world surface / unique spatial offset")
        xyz = g.node("ShaderNodeSeparateXYZ", "Original piece bounds")
        g.connect(generated, xyz.inputs[0])
        normals = g.node("ShaderNodeSeparateXYZ", "Blender world-up surface direction")
        g.connect(geom.outputs["Normal"], normals.inputs[0])
        up = g.remap(normals.outputs["Z"], 0.38, 0.95)
        local_top = g.remap(xyz.outputs["Z"], 0.72, 0.98)
        top = g.math("MULTIPLY", up, local_top)
        # Requiring two near-boundary axes selects edges, not entire box faces.
        near = []
        for axis in ("X", "Y", "Z"):
            v = xyz.outputs[axis]
            distance = g.math("MINIMUM", v, g.math("SUBTRACT", 1.0, v))
            near.append(g.remap(distance, 0.008, 0.11, 1.0, 0.0))
        edge = g.math("MAXIMUM", g.math("MULTIPLY", near[0], near[1]),
                      g.math("MAXIMUM", g.math("MULTIPLY", near[0], near[2]),
                             g.math("MULTIPLY", near[1], near[2])))
        contact = g.math("MAXIMUM", g.math("MULTIPLY", top, 0.8),
                         g.math("MULTIPLY", edge, 0.42))
        vector = g.node("ShaderNodeVectorMath", "Vary deposits across original pieces")
        vector.operation = "ADD"
        g.connect(local, vector.inputs[0])
        g.connect(g.scale_vector(geom.outputs["Position"], (0.173, 0.217, 0.193)), vector.inputs[1])
        broad = g.noise(vector.outputs[0], 3.7, 3.0)
        sparse = g.remap(broad, 0.58, 0.76)
        deposit = g.math("MULTIPLY", sparse, contact)
        breakup = g.remap(g.noise(vector.outputs[0], 12.3), 0.36, 0.65)
        params = {"profile": kind, "revision": REVISION,
                  "channels": ["Base Color", "Roughness"],
                  "mask": "primary sparse contact mask; cavity deposition listed separately",
                  "broadNoiseScale": 3.7, "broadThreshold": [0.58, 0.76]}

        if kind in {"wood", "metal", "leather"}:
            scale = (1.7, 96.0, 23.0) if kind == "wood" else (7.0, 118.0, 29.0)
            if kind == "wood" and "grain-y" in key:
                scale = (96.0, 1.7, 23.0)
            elif kind == "wood" and "grain-z" in key:
                scale = (96.0, 23.0, 1.7)
            fine = g.noise(g.scale_vector(local, scale), 1.0)
            scratches = g.math("MULTIPLY", g.remap(fine, 0.64, 0.75), breakup)
            scratches = g.math("MULTIPLY", scratches, contact)
            if kind == "wood":
                # Oil darkens contact patches; scratches expose a little pale grain.
                color = g.tint(base, deposit, 0.22, (0.43, 0.36, 0.27))
                color = g.tint(color, scratches, 0.13, (1.49, 1.34, 1.18))
                rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", deposit, 0.065))
                rough = g.math("ADD", rough, g.math("MULTIPLY", scratches, 0.11))
                distance, strength = 0.00032, 0.14
                params.update({"oilColorMixMax": 0.22, "scratchColorMixMax": 0.13,
                               "roughnessDelta": [-0.065, 0.11]})
            elif kind == "metal":
                patina = (0.48, 0.51, 0.34)
                if key.startswith("copper"):
                    patina = (0.32, 0.56, 0.43)
                elif key.startswith(("steel", "blackened-iron")):
                    patina = (0.57, 0.43, 0.33)
                color = g.tint(base, deposit, 0.18, patina)
                color = g.tint(color, scratches, 0.12, (1.40, 1.32, 1.18))
                rough = g.math("ADD", rough, g.math("MULTIPLY", deposit, 0.13))
                rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", scratches, 0.075))
                distance, strength = 0.00016, 0.10
                params.update({"patinaColorMixMax": 0.18, "scratchColorMixMax": 0.12,
                               "roughnessDelta": [-0.075, 0.13]})
            else:
                color = g.tint(base, deposit, 0.16, (0.48, 0.39, 0.31))
                color = g.tint(color, scratches, 0.08, (1.32, 1.23, 1.15))
                rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", deposit, 0.10))
                distance, strength = 0.00012, 0.09
                params.update({"oilColorMixMax": 0.16, "scratchColorMixMax": 0.08,
                               "roughnessDelta": [-0.10, 0.0]})
            g.bump(principled, scratches, distance, strength)
            params.update({"channels": ["Base Color", "Roughness", "Normal"],
                           "scratchVectorScale": list(scale),
                           "scratchThreshold": [0.64, 0.75],
                           "bumpDistanceWorldM": distance, "bumpStrength": strength})
        elif kind == "cloth-paper":
            # Sparse fading and dust only; leave heraldry/ink and fabric weave intact.
            dust = g.math("MULTIPLY", sparse,
                          g.math("MAXIMUM", g.math("MULTIPLY", edge, 0.5), 0.22))
            color = g.tint(base, dust, 0.10, (1.18, 1.12, 0.98))
            rough = g.math("ADD", rough, g.math("MULTIPLY", dust, 0.05))
            params.update({"dustColorMixMax": 0.10, "roughnessDelta": [0.0, 0.05]})
        else:
            # Fragmented hairline plaster checking; no large or structural fractures.
            color = g.tint(base, sparse, 0.10, (0.64, 0.61, 0.53))
            rough = g.math("ADD", rough, g.math("MULTIPLY", sparse, 0.04))
            vor = g.node("ShaderNodeTexVoronoi", "Sparse limewash hairline checking")
            vor.voronoi_dimensions = "3D"
            vor.feature = "DISTANCE_TO_EDGE"
            g.connect(vector.outputs[0], vor.inputs["Vector"])
            vor.inputs["Scale"].default_value = 22.0
            hairline = g.remap(vor.outputs["Distance"], 0.002, 0.014, 1.0, 0.0)
            hairline = g.math("MULTIPLY", hairline, g.remap(broad, 0.67, 0.79))
            g.bump(principled, hairline, 0.00022, 0.08)
            params.update({"channels": ["Base Color", "Roughness", "Normal"],
                           "sootColorMixMax": 0.10, "roughnessDelta": [0.0, 0.04],
                           "bumpDistanceWorldM": 0.00022, "bumpStrength": 0.08,
                           "hairlineChecking": "fragmented material film, not structural cracks"})

        if kind in {"wood", "metal", "limewash"}:
            # Short, material-scale crevices retain dust. AO is solely a dirt
            # deposition mask: it never multiplies the full color by visibility.
            ao = g.node("ShaderNodeAmbientOcclusion", "4 cm crevice dirt deposition only")
            ao.samples = 8
            ao.only_local = False
            ao.inputs["Distance"].default_value = 0.04
            g.connect(geom.outputs["Normal"], ao.inputs["Normal"])
            cavity = g.math("SUBTRACT", 1.0, ao.outputs["AO"])
            cavity = g.math("MULTIPLY", cavity,
                            g.remap(broad, 0.28, 0.66, 0.35, 1.0))
            cavity_strength = 0.11 if kind == "metal" else 0.09
            color = g.tint(color, cavity, cavity_strength, (0.46, 0.42, 0.34))
            rough = g.math("ADD", rough, g.math("MULTIPLY", cavity, 0.055))
            params.update({"cavityMask": "short-range AO for physical dust reflectance only",
                           "cavityDistanceWorldM": 0.04, "cavitySamples": 8,
                           "cavityColorMixMax": cavity_strength,
                           "cavityRoughnessAddMax": 0.055})

        g.links.new(color, principled.inputs["Base Color"])
        # Clamp only at physical extremes, preserving the authored gloss range.
        rough = g.math("MINIMUM", g.math("MAXIMUM", rough, 0.10), 0.96)
        g.links.new(rough, principled.inputs["Roughness"])
        params["roughnessClamp"] = [0.10, 0.96]
        params["nodesAdded"] = len(material.node_tree.nodes) - before
        params["material"] = material.name
        material["workshop_wear_v2_report"] = json.dumps(params, sort_keys=True)
        report["changed"][key] = params
    return report
