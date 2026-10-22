"""Prepare edited real-recording variants; no synthesis, resampling or downloads.

Requires Python 3.11/3.12 and NumPy (aifc reads the original AIFF files).
Place the source WAV files and the two unchanged ZIP archives in --sources-root.
The default is the private, ignored research folder; originals are never written.
Run again with the same original bytes to reproduce the manifest and every WAV.
The CC0 balloon FLAC is decoded separately by the documented Web Audio recipe
in its manifest source record; its exact PCM16 intermediate SHA is pinned here.
"""
import argparse
import aifc
import hashlib
import io
import json
import math
from pathlib import Path
import wave
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 44100
CUES = ["wood", "joint", "metal", "ring", "whoosh", "slosh", "tension",
        "puncture", "tear", "jet", "drip", "splash", "blade-beat", "blade-slide",
        "shield-metal", "shield-wood", "wood-contact", "latex-rub", "footstep-dry",
        "footstep-wet", "water-burst", "blade-swish"]
LICENSES = {"CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
            "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/"}
PACKS = {
    "vehicle": {"file": "vehicle-tinysized.zip", "member": "sfx-cc0/",
                "sha": "7f00e2b1dae15e68db0e1d6096767f03755e9e7c247128afc3e935e63774d7db",
                "sourceURL": "https://opengameart.org/content/fantasy-sound-effects-tinysized-sfx",
                "downloadURL": "https://opengameart.org/sites/default/files/tinysized.zip", "author": "Vehicle", "license": "CC0-1.0"},
    "ogrebane": {"file": "ogrebane-wood-metal-2.zip", "member": "wood_and_metal_vol.2/",
                 "sha": "91fd8fdac3d4f900223b96595e48610a6f3934c05cfa2bf5a4c9030f43a6f985",
                 "sourceURL": "https://opengameart.org/content/wood-and-metal-sound-effects-volume-2",
                 "downloadURL": "https://opengameart.org/sites/default/files/wood_and_metal_vol.2_0.zip", "author": "Ogrebane", "license": "CC0-1.0"},
    "latex": {"file": "mike-koenig-balloon-squeaky.wav", "sha": "571a01cd3188655b773eeb59fbafb519f7d7f441147640c262e4c4aee82d2c10",
              "sourceURL": "https://soundbible.com/1111-Balloon-Squeaky.html", "downloadURL": "https://soundbible.com/wav/Balloon%20Squeaky-SoundBible.com-2026883687.wav", "author": "Mike Koenig", "license": "CC-BY-3.0"},
    "water": {"file": "vinrax-water.wav", "sha": "5d1c09cb1bdd3acd15947026eb92311108ae9705f5e2699b37dc3416002fe93a",
              "sourceURL": "https://opengameart.org/content/water-sounds", "downloadURL": "https://opengameart.org/sites/default/files/water_sounds.wav", "author": "Vinrax", "license": "CC-BY-3.0"},
    "pop": {"file": "soundbible-balloon-popping-1522.wav", "sha": "89e827ed5a424e8bcd5c818c08cc3c0fd034fffef125f2ff0913655cbd188784",
            "sourceURL": "https://soundbible.com/1522-Balloon-Popping.html", "downloadURL": "https://soundbible.com/grab.php?id=1522&type=wav", "author": "Mike Koenig", "license": "CC-BY-3.0"},
    "pop-cc0": {"file": "antumdeluge-balloon-pop-decoded.wav", "sha": "4c3ecda913fd492d107a48277ef29add949c9faf818c8458f2c7c76c18010bd4",
                "originalFile": "antumdeluge-balloon-pop.flac", "originalSHA256": "4f15708bd01e1e20a92055381c1fc66d179f222d90f6963aee016ae1062f7f29",
                "sourceURL": "https://opengameart.org/content/balloon-sounds", "downloadURL": "https://opengameart.org/sites/default/files/balloon_pop.flac", "author": "Gniffelbaf / AntumDeluge", "license": "CC0-1.0"},
    "splash": {"file": "soundbible-water-splash-1460.wav", "sha": "0be6f25abdb4e1a3ed2947afed940597037856ef99ef111483b2c6f829892eb2",
               "sourceURL": "https://soundbible.com/1460-Water-Splash.html", "downloadURL": "https://soundbible.com/grab.php?id=1460&type=wav", "author": "Mike Koenig", "license": "CC-BY-3.0"},
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Sources:
    def __init__(self, root):
        self.root, self.cache, self.archives, self.records = root, {}, {}, {}

    def get(self, pack_name, member=None):
        key = pack_name + ("/" + member if member else "")
        if key in self.cache:
            return self.cache[key]
        pack = PACKS[pack_name]
        if pack_name not in self.archives:
            original = (self.root / pack["file"]).read_bytes()
            if sha(original) != pack["sha"]:
                raise ValueError("Original source hash changed: " + pack["file"])
            self.archives[pack_name] = original
        original = self.archives[pack_name]
        archive_member = pack.get("member", "") + member if member else None
        raw = zipfile.ZipFile(io.BytesIO(original)).read(archive_member) if member else original
        source_original = raw
        if pack.get("originalFile"):
            source_original = (self.root / pack["originalFile"]).read_bytes()
            if sha(source_original) != pack["originalSHA256"]:
                raise ValueError("FLAC original hash changed")
            stream = int.from_bytes(source_original[18:26], "big")
            if source_original[:4] != b"fLaC" or stream >> 44 != RATE or ((stream >> 41) & 7) != 0 or ((stream >> 36) & 31) != 15:
                raise ValueError("Converted FLAC must be natively mono PCM16 at 44.1 kHz")
        filename = member or pack["file"]
        opener = aifc.open if filename.endswith((".aif", ".aiff")) else wave.open
        with opener(io.BytesIO(raw), "rb") as sound:
            channels, bits, rate, frames = sound.getnchannels(), sound.getsampwidth() * 8, sound.getframerate(), sound.getnframes()
            pcm = sound.readframes(frames)
        if rate != RATE or bits != 16 or channels not in (1, 2):
            raise ValueError("Only native 44.1 kHz PCM16 sources are accepted: " + filename)
        dtype = ">i2" if opener is aifc.open else "<i2"
        matrix = np.frombuffer(pcm, dtype=dtype).astype(np.float64).reshape(-1, channels) / 32768
        mono = np.mean(matrix, axis=1)
        channel_energy = float(np.sqrt(np.mean(matrix * matrix)))
        mono_energy = float(np.sqrt(np.mean(mono * mono)))
        if mono_energy < channel_energy * .45:
            raise ValueError("Stereo downmix cancels material energy: " + filename)
        self.records[key] = {"title": pack.get("originalFile", filename), "originalFile": pack.get("originalFile", filename), "originalSHA256": sha(source_original), "originalBytes": len(source_original),
                             "sourceURL": pack["sourceURL"], "downloadURL": pack["downloadURL"], "author": pack["author"],
                             "license": pack["license"], "licenseURL": LICENSES[pack["license"]], "sampleRate": rate, "channels": channels,
                             "bits": bits, "frames": frames, "duration": frames / rate,
                             "sourceFullScaleSamples": int(np.count_nonzero(np.abs(matrix) >= 32767 / 32768)),
                             "archiveFile": pack["file"] if member else None, "archiveMember": archive_member,
                             "archiveSHA256": pack["sha"] if member else None,
                             "decodedIntermediate": {"file": filename, "sha256": sha(raw), "bytes": len(raw),
                                                     "process": "Browser Web Audio decodeAudioData in a 44100 Hz OfflineAudioContext; source STREAMINFO confirms native 44100 Hz mono PCM16. Exported to PCM16 without resampling or gain before this script.",
                                                     "reproduction": "Download the identified original FLAC. In a browser, decode its ArrayBuffer using new OfflineAudioContext(1, 24126, 44100).decodeAudioData(bytes). Write a standard 44-byte mono PCM16 WAV header and for each sample write Math.round(Math.max(-1,Math.min(1,sample))*32767) as signed little-endian int16. The resulting file must match this intermediate SHA-256 before running this script; do not substitute an arbitrary decoder output silently."} if pack.get("originalFile") else None,
                             "downmix": "Arithmetic mean of original channels; no resampling or source reconstruction."}
        self.cache[key] = (key, mono)
        return self.cache[key]


def layer(pack, member=None, start=0, end=None, gain=0, delay=0):
    return {"pack": pack, "member": member, "start": start, "end": end, "gain": gain, "delay": delay}


def wood(number, **options):
    return layer("ogrebane", "wood%d.aif" % number, **options)


def vehicle(name, **options):
    return layer("vehicle", name + ".wav", **options)


def plans():
    result = {name: [] for name in CUES}
    latex_cuts = [(.17, .46), (.46, .89), (1.00, 1.22)]
    water_cuts = [(.17, .70), (1.40, 1.95), (3.25, 4.10)]
    for v in range(3):
        latex_start, latex_end = latex_cuts[v]
        wet_start, wet_end = water_cuts[v]
        clash = "sword-clash-%02d" % (v + 1)
        swish = ["tube-plastic-whoosh-01", "tube-plastic-whoosh-02", "tin-whistle-whoosh-01"][v]
        latex = lambda **kw: layer("latex", start=latex_start, end=latex_end, **kw)
        result["wood"].append((-8, [wood(v + 1)]))
        result["wood-contact"].append((-9, [wood([6, 7, 14][v])]))
        result["shield-wood"].append((-7, [wood([4, 8, 9][v]), wood([10, 11, 12][v], gain=-15, delay=.008)]))
        creak_ranges = [(0, .25), (.39, .58), (.04, .22)]
        start, end = creak_ranges[v]
        mechanism = ["keyhole-lockbox-turn-01", "keyhole-lockbox-insert-01", "keyhole-lockbox-remove-01"][v]
        result["joint"].append((-11, [vehicle("floor-creak-01", start=start, end=end), vehicle(mechanism, start=.03, end=.32, gain=-12, delay=.012)]))
        result["metal"].append((-8, [vehicle(clash, end=.68 + .08 * v)]))
        result["blade-beat"].append((-7, [vehicle(clash, end=.48 + .06 * v)]))
        result["ring"].append((-22, [vehicle(clash, start=.085 + .015 * v, end=.75 + .08 * v)]))
        result["shield-metal"].append((-6, [layer("ogrebane", "metal%d.aif" % [1, 3, 4][v])]))
        result["blade-slide"].append((-10, [vehicle("metal-knife-scrape-%02d" % (v + 1), start=[.03, .10, .02][v], end=[1.08, 1.25, 1.12][v])]))
        result["whoosh"].append((-12, [vehicle(swish)]))
        result["blade-swish"].append((-11, [vehicle(swish, end=[.30, .36, .43][v])]))
        result["latex-rub"].append((-12, [latex()]))
        result["tension"].append((-15, [latex(gain=0), vehicle("quiver-leather-squeeze-%02d" % (1 if v == 0 else 2), start=.02 + .10 * v, end=.25 + .10 * v, gain=-20, delay=.014)]))
        result["slosh"].append((-12, [layer("water", start=wet_start, end=wet_end)]))
        result["drip"].append((-12, [vehicle("water-drop-%02d" % (v + 1))]))
        pour = [("water-pour-01", .02, 1.00), ("water-vial-fill-01", .15, 1.20), ("water-pour-01", .62, 1.53)][v]
        result["jet"].append((-11, [vehicle(pour[0], start=pour[1], end=pour[2])]))
        result["footstep-dry"].append((-10, [wood([10, 11, 12][v], end=.40)]))
        result["footstep-wet"].append((-10, [wood([13, 14, 16][v], end=.39), vehicle("water-drop-%02d" % (v + 1), gain=-11, delay=.007)]))
        # Two real pop originals plus identified rubber edits and a composite
        # third variant; these are never described as three independent takes.
        pops = [[layer("pop", end=.27), latex(gain=-17, delay=.007)],
                [layer("pop-cc0"), latex(gain=-21, delay=.007)],
                [layer("pop", end=.29), layer("pop-cc0", start=.025, end=.34, gain=-12, delay=.005), latex(gain=-20, delay=.012)]]
        result["puncture"].append((-8, pops[v]))
        result["tear"].append((-10, [latex(), layer("pop-cc0" if v == 1 else "pop", start=.025 + .01 * v, end=.20 + .025 * v, gain=-19, delay=.012)]))
        splashes = [[layer("splash")], [layer("water", start=.71, end=1.09), layer("splash", start=.14, end=.64, gain=-16, delay=.014)], [layer("water", start=2.09, end=2.56), vehicle("water-pour-01", start=.65, end=1.08, gain=-18, delay=.012)]]
        result["splash"].append((-8, splashes[v]))
        bursts = [[layer("splash"), vehicle("water-pour-01", start=.20, end=1.00, gain=-10, delay=.055)],
                  [layer("water", start=.71, end=1.15), layer("splash", start=.10, end=.60, gain=-12, delay=.04)],
                  [layer("water", start=2.09, end=2.72), layer("splash", start=.25, end=1.04, gain=-14, delay=.02)]]
        result["water-burst"].append((-9, bursts[v]))
    return result


def envelope(length, fade_in=.00075, fade_out=.012):
    result = np.ones(length, dtype=np.float64)
    head, tail = min(round(fade_in * RATE), length // 3), min(round(fade_out * RATE), length // 3)
    if head > 1:
        result[:head] = np.sin(np.linspace(0, math.pi / 2, head)) ** 2
    if tail > 1:
        result[-tail:] = np.sin(np.linspace(math.pi / 2, 0, tail)) ** 2
    result[0] = result[-1] = 0
    return result


def edit_layer(sources, spec):
    key, original = sources.get(spec["pack"], spec["member"])
    start = round(spec["start"] * RATE)
    end = min(len(original), round(spec["end"] * RATE)) if spec["end"] is not None else len(original)
    if not 0 <= start < end <= len(original):
        raise ValueError("Invalid source cut: " + key)
    signal = original[start:end].copy()
    dc_removed = float(np.mean(signal))
    signal -= dc_removed
    active = np.flatnonzero(np.abs(signal) > max(2 / 32768, float(np.max(np.abs(signal))) * .005))
    if len(active) == 0:
        raise ValueError("Silent source cut: " + key)
    lo, hi = max(0, int(active[0]) - round(.003 * RATE)), min(len(signal), int(active[-1]) + round(.020 * RATE) + 1)
    signal = signal[lo:hi] * envelope(hi - lo)
    start, end = start + lo, start + hi
    signal *= 10 ** (spec["gain"] / 20)
    record = sources.records[key]
    return signal, {"sourceId": key, "originalSHA256": record["originalSHA256"],
                    "cut": {"startFrame": start, "endFrame": end, "sampleRate": RATE, "startSeconds": start / RATE, "endSeconds": end / RATE},
                    "gainDb": spec["gain"], "delaySeconds": spec["delay"], "dcRemoved": dc_removed}


def encode(signal):
    if not np.isfinite(signal).all() or np.max(np.abs(signal)) >= 1:
        raise ValueError("Invalid or clipping edited recording")
    pcm = np.rint(signal * 32767).astype("<i2")
    memory = io.BytesIO()
    with wave.open(memory, "wb") as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(RATE)
        sound.writeframes(pcm.tobytes())
    quantized = pcm.astype(np.float64) / 32768
    return memory.getvalue(), quantized


def build_variant(sources, specs, target_db):
    layers = [edit_layer(sources, spec) for spec in specs]
    frames = max(len(signal) + round(record["delaySeconds"] * RATE) for signal, record in layers)
    signal = np.zeros(frames, dtype=np.float64)
    for layer_signal, record in layers:
        offset = round(record["delaySeconds"] * RATE)
        signal[offset:offset + len(layer_signal)] += layer_signal
    signal *= envelope(frames, .0005, .008)
    window = envelope(frames, .001, .010)
    signal -= window * np.sum(signal) / np.sum(window)
    gain = 10 ** (target_db / 20) / float(np.max(np.abs(signal)))
    signal *= gain
    if not .02 <= len(signal) / RATE <= 3:
        raise ValueError("Edited variant outside loader duration bounds")
    return signal, [record for _, record in layers], 20 * math.log10(gain)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources-root", type=Path, default=ROOT / ".runtime/audio-recorded-1.9.0/sources")
    parser.add_argument("--output", type=Path, default=ROOT / "public/assets/audio/recorded-foley-v1")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sources, rendered, entries = Sources(args.sources_root.resolve()), {}, {}
    for name, variants in plans().items():
        entries[name] = []
        for variant, (target_db, specs) in enumerate(variants):
            signal, layers, mix_gain = build_variant(sources, specs, target_db)
            raw, pcm = encode(signal)
            filename = "%s-%d.wav" % (name, variant)
            (output / filename).write_bytes(raw)
            rendered[(name, variant)] = pcm
            entries[name].append({"file": filename, "sha256": sha(raw), "sampleRate": RATE, "channels": 1, "bits": 16,
                                  "frames": len(pcm), "duration": len(pcm) / RATE, "bytes": len(raw), "layers": layers,
                                  "peakTargetDbfs": target_db, "mixGainDb": mix_gain,
                                  "processing": ["Read native 44.1 kHz recorded PCM; any prior FLAC decode is identified in source metadata. No resampling.",
                                                 "Arithmetic mean downmix with cancellation check; remove each cut's DC.",
                                                 "Trim below -46 dB relative to cut peak, preserving 3 ms pre-roll and 20 ms tail.",
                                                 "Apply sub-millisecond attack and 12 ms release edits; mix only identified real layers.",
                                                 "Remove residual mix DC with zero-ended window; set documented peak headroom.",
                                                 "Round once to mono PCM16 WAV; no limiting, synthesis, pitch shift or reconstruction."],
                                  "metrics": {"peak": float(np.max(np.abs(pcm))), "rms": float(np.sqrt(np.mean(pcm * pcm))), "dc": float(np.mean(pcm))}})
    # Sequential audition: each edited variant, then the three burst combinations
    # at the inherited cue gains/delays for a relative-speed=2 physical burst.
    chunks, chapters, cursor = [np.zeros(round(.20 * RATE))], [], .20
    for name in CUES:
        for variant in range(3):
            pcm = rendered[(name, variant)]
            chapters.append({"kind": "variant", "cue": name, "variant": variant, "start": cursor, "duration": len(pcm) / RATE})
            chunks.extend([pcm, np.zeros(round(.22 * RATE))])
            cursor += (len(pcm) + round(.22 * RATE)) / RATE
    for variant in range(3):
        layers = [("puncture", 0, .30), ("tear", .018, .255), ("water-burst", .04, .375)]
        length = max(len(rendered[(name, variant)]) + round(delay * RATE) for name, delay, _ in layers)
        pcm = np.zeros(length)
        for name, delay, gain in layers:
            offset = round(delay * RATE)
            piece = rendered[(name, variant)]
            pcm[offset:offset + len(piece)] += piece * gain
        chapters.append({"kind": "burst-layer-mix", "variant": variant, "start": cursor, "duration": length / RATE,
                         "note": "Existing pre-master cue gains and delays for relativeSpeed=2; playback-rate variation omitted for dry asset audition. No new invented impact."})
        chunks.extend([pcm, np.zeros(round(.40 * RATE))])
        cursor += (length + round(.40 * RATE)) / RATE
    preview, preview_pcm = encode(np.concatenate(chunks))
    preview_file = "listening-montage.wav"
    (output / preview_file).write_bytes(preview)
    manifest = {"schemaVersion": 1, "title": "WaterDuel — Recorded workshop contact variants", "format": {"container": "WAV", "encoding": "PCM signed 16-bit little-endian", "sampleRate": RATE, "channels": 1, "bits": 16},
                "provenance": {"externalRecordings": True, "syntheticLayers": False, "generator": "scripts/prepare-recorded-foley.py",
                               "variationDescription": "Edited variants from identified source recordings; some share originals and use different cuts or mixes, not 66 independent natural takes.",
                               "qualityScope": "Technical PCM checks only; perceptual listening and speaker/headphone approval remain pending."},
                "sources": sources.records, "cues": entries,
                "totalBytes": sum(entry["bytes"] for variants in entries.values() for entry in variants),
                "decodedFloat32Bytes": sum(entry["frames"] * 4 for variants in entries.values() for entry in variants),
                "preview": {"file": preview_file, "sha256": sha(preview), "bytes": len(preview), "duration": len(preview_pcm) / RATE, "chapters": chapters}}
    if manifest["totalBytes"] > 24_000_000 or manifest["decodedFloat32Bytes"] > 64_000_000:
        raise ValueError("Bank exceeds loader budgets")
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"variants": 66, "sourceRecordings": len(sources.records), "bytes": manifest["totalBytes"], "decodedFloat32Bytes": manifest["decodedFloat32Bytes"], "previewSeconds": manifest["preview"]["duration"], "manifestSHA256": sha((output / "manifest.json").read_bytes()), "listeningApproved": False}))


if __name__ == "__main__":
    main()
