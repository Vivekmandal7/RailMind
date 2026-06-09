# Build demo.gif from captured frames — run after capture-demo.js
from PIL import Image
import json
import os

OUT = os.path.dirname(os.path.abspath(__file__))
frames = json.load(open(os.path.join(OUT, "_frames.json")))
images = [Image.open(f).convert("RGB") for f in frames]
# Resize for README (keep aspect, max width 1280)
w = 1280
resized = []
for im in images:
    ratio = w / im.width
    resized.append(im.resize((w, int(im.height * ratio)), Image.Resampling.LANCZOS))
palette = [im.convert("P", palette=Image.ADAPTIVE, colors=256) for im in resized]
palette[0].save(
    os.path.join(OUT, "demo.gif"),
    save_all=True,
    append_images=palette[1:],
    duration=900,
    loop=0,
    optimize=True,
)
print("Wrote demo.gif")
