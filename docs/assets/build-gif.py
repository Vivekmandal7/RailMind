# Build demo.gif from captured frames — run after capture-demo.js
from PIL import Image
import json
import os
import re

OUT = os.path.dirname(os.path.abspath(__file__))
all_frames = json.load(open(os.path.join(OUT, "_frames.json")))
# Hero GIF = satellite + 3D follow motion only (exclude demo-mode tail frames)
frames = [f for f in all_frames if re.search(r"_frame_\d{2}\.png$", f)]
images = [Image.open(f).convert("RGB") for f in frames]
# Resize for README — 960px keeps quality while staying under GitHub-friendly size
w = 960
resized = []
for im in images:
    ratio = w / im.width
    resized.append(im.resize((w, int(im.height * ratio)), Image.Resampling.LANCZOS))
palette = [im.convert("P", palette=Image.ADAPTIVE, colors=256) for im in resized]
# Shorter duration per frame so train motion reads clearly in the GIF
palette[0].save(
    os.path.join(OUT, "demo.gif"),
    save_all=True,
    append_images=palette[1:],
    duration=700,
    loop=0,
    optimize=True,
)
print("Wrote demo.gif from", len(frames), "frames")
