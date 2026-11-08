"""Headless smoke test: python test_engine.py <photo> [out_dir]"""
import sys
import time

from PIL import Image

from engine import Session

args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0]
out = args[1] if len(args) > 1 else "."
backend = "replicate" if "--replicate" in sys.argv else "local"
t = time.time()
s = Session(Image.open(src), backend=backend)
s.compute_depth(); print("depth", round(time.time() - t, 1)); t = time.time()
s.auto_mask(); print("auto mask", round(time.time() - t, 1)); t = time.time()
s.sam_click(s.W * 0.75, s.H * 0.7, add=True); print("sam click", round(time.time() - t, 1)); t = time.time()
Image.fromarray(s.mask_view()).save(f"{out}/t_mask_after_click.png")
s.undo()
p = dict(mode="Depth-based", strength=8, auto_focus=True, focus=0.75, near=0.3, bokeh="Lens (disc)",
         matting=True, decontam=True, shrink=2, soft=1, wrap=0.3, wrap_width=6,
         fg_levels=(0, 255, 1.1, 1.0), bg_levels=(0, 255, 1.0, 0.85))
Image.fromarray(s.render(p)).save(f"{out}/t_preview.jpg"); print("preview first", round(time.time() - t, 1)); t = time.time()
p["strength"] = 14
Image.fromarray(s.render(p)).save(f"{out}/t_preview2.jpg"); print("preview slider", round(time.time() - t, 1)); t = time.time()
Image.fromarray(s.render(p, full=True)).save(f"{out}/t_full.jpg"); print("full export", round(time.time() - t, 1))
