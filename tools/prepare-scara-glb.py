import bpy
import math
import os
import sys

source = sys.argv[sys.argv.index("--") + 1]
target = sys.argv[sys.argv.index("--") + 2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

for obj in list(bpy.context.scene.objects):
    if obj.type in {"CAMERA", "LIGHT"} or obj.name == "Cube":
        bpy.data.objects.remove(obj, do_unlink=True)

body = bpy.data.materials.new("SCARA Body")
body.diffuse_color = (0.045, 0.12, 0.14, 1)
body.metallic = 0.18
body.roughness = 0.54

accent = bpy.data.materials.new("SCARA Accent")
accent.diffuse_color = (0.08, 0.72, 0.78, 1)
accent.metallic = 0.16
accent.roughness = 0.42

servo = bpy.data.materials.new("Servo")
servo.diffuse_color = (0.055, 0.065, 0.075, 1)
servo.metallic = 0.08
servo.roughness = 0.68

for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    obj.data.materials.clear()
    parent_name = obj.parent.name.lower() if obj.parent else ""
    if "rcxaz" in parent_name:
        obj.data.materials.append(servo)
    elif "pignone" in parent_name or "cremagliera" in parent_name:
        obj.data.materials.append(accent)
    else:
        obj.data.materials.append(body)

os.makedirs(os.path.dirname(target), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=target,
    export_format="GLB",
    export_apply=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
