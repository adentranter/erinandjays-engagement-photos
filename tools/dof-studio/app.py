# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "gradio>=5,<6",
#   "numpy",
#   "scipy",
#   "pillow",
#   "pymatting",
#   "rembg[cpu]",
#   "transformers",
#   "torch",
#   "replicate>=1.0",
# ]
# ///
"""DOF Studio: split subject/background with AI help, fake a lens blur, grade each layer.

Run:  uv run -p 3.12 tools/dof-studio/app.py   then open http://localhost:7860

Cloud mode: put REPLICATE_API_TOKEN=... in tools/dof-studio/.env (git-ignored).
"""
import os
import time

import gradio as gr
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env(path):
    """Minimal .env reader so the Replicate token never has to be typed anywhere."""
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env(os.path.join(HERE, ".env"))

from engine import MAX_STRENGTH, Session, replicate_available  # noqa: E402

OUT_DIR = os.path.join(HERE, "output")
BACKENDS = ["Replicate (cloud)", "Local (this Mac)"]


def _backend(label):
    return "replicate" if label.startswith("Replicate") else "local"
STATE: dict = {"s": None, "name": "photo"}


def _params(mode, strength, auto_focus, focus, near, bokeh,
            matting, decontam, shrink, soft, wrap, wrap_width,
            fb, fw, fg, fs, bb, bw, bg, bs):
    return dict(
        mode=mode, strength=strength, auto_focus=auto_focus, focus=focus, near=near, bokeh=bokeh,
        matting=matting, decontam=decontam, shrink=shrink, soft=soft, wrap=wrap, wrap_width=wrap_width,
        fg_levels=(fb, fw, fg, fs), bg_levels=(bb, bw, bg, bs),
    )


def load(img, backend_label, progress=gr.Progress()):
    if img is None:
        return None, "Upload a photo to start."
    backend = _backend(backend_label)
    if backend == "replicate" and not replicate_available():
        return None, "⚠️ No REPLICATE_API_TOKEN found in tools/dof-studio/.env — switch to Local or add it and restart."
    t = time.time()
    try:
        progress(0.05, desc="Estimating depth…")
        s = Session(img, backend=backend)
        s.compute_depth()
        progress(0.6, desc="Finding people…")
        s.auto_mask()
    except Exception as e:  # network / API errors shouldn't kill the UI
        return None, f"⚠️ {type(e).__name__}: {e}"
    STATE["s"] = s
    return s.mask_view(), f"Loaded {s.W}×{s.H} via {backend} in {time.time() - t:.0f}s. Click the left image to add/remove areas."


def set_backend(backend_label):
    s = STATE["s"]
    if s is not None:
        s.backend = _backend(backend_label)
    return f"Backend: {backend_label} (used for Auto people and clicks)."


def preview(*controls):
    s = STATE["s"]
    if s is None:
        return None
    return s.render(_params(*controls))


def click(mode, evt: gr.SelectData):
    s = STATE["s"]
    if s is None:
        return None, "Upload a photo first."
    x, y = evt.index
    sc = s.preview_scale
    try:
        s.sam_click(x / sc, y / sc, add=(mode == "Add area"))
    except Exception as e:
        return s.mask_view(), f"⚠️ {e}"
    return s.mask_view(), f"{'Added' if mode == 'Add area' else 'Removed'} area at ({int(x / sc)}, {int(y / sc)})."


def auto():
    s = STATE["s"]
    if s is None:
        return None
    try:
        s.auto_mask()
    except Exception as e:
        gr.Warning(f"Auto people failed: {e}")
    return s.mask_view()


def undo():
    s = STATE["s"]
    if s is None:
        return None
    s.undo()
    return s.mask_view()


def clear():
    s = STATE["s"]
    if s is None:
        return None
    s.clear_mask()
    return s.mask_view()


def export(*controls):
    s = STATE["s"]
    if s is None:
        return None, "Nothing to export."
    os.makedirs(OUT_DIR, exist_ok=True)
    out = s.render(_params(*controls), full=True)
    path = os.path.join(OUT_DIR, f"dof_{time.strftime('%Y%m%d_%H%M%S')}.jpg")
    Image.fromarray(out).save(path, quality=95)
    return path, f"Saved full resolution to {path}"


# ---------------------------------------------------------------- presets
PRESET_DIR = os.path.join(HERE, "presets")
CONTROL_NAMES = ["mode", "strength", "auto_focus", "focus", "near", "bokeh",
                 "matting", "decontam", "shrink", "soft", "wrap", "wrap_width",
                 "fg_black", "fg_white", "fg_gamma", "fg_sat",
                 "bg_black", "bg_white", "bg_gamma", "bg_sat"]


def preset_names():
    if not os.path.isdir(PRESET_DIR):
        return []
    return sorted(f[:-5] for f in os.listdir(PRESET_DIR) if f.endswith(".json"))


def _safe(name):
    return "".join(c for c in name.strip() if c.isalnum() or c in " -_").strip()


def save_preset(name, *controls):
    import json

    name = _safe(name or "")
    if not name:
        return gr.update(), "⚠️ Type a preset name first."
    os.makedirs(PRESET_DIR, exist_ok=True)
    with open(os.path.join(PRESET_DIR, name + ".json"), "w") as f:
        json.dump(dict(zip(CONTROL_NAMES, controls)), f, indent=2)
    return gr.update(choices=preset_names(), value=name), f"Saved preset “{name}”."


def load_preset(name, *current):
    import json

    path = os.path.join(PRESET_DIR, _safe(name or "") + ".json")
    if not name or not os.path.exists(path):
        return (*current, "⚠️ Pick a preset to load.")
    data = json.load(open(path))
    values = [data.get(k, v) for k, v in zip(CONTROL_NAMES, current)]  # missing keys keep current
    return (*values, f"Loaded preset “{name}”.")


def delete_preset(name):
    path = os.path.join(PRESET_DIR, _safe(name or "") + ".json")
    if name and os.path.exists(path):
        os.remove(path)
        return gr.update(choices=preset_names(), value=None), f"Deleted preset “{name}”."
    return gr.update(), "⚠️ Pick a preset to delete."


# ---------------------------------------------------------------- layout
CSS = """
.gradio-container { max-width: 100% !important; }
/* settings column: fixed width, sticks to the viewport, scrolls on its own */
#controls {
  position: sticky; top: 8px; align-self: flex-start;
  max-height: calc(100vh - 16px); overflow-y: auto; overflow-x: hidden;
  /* block, not flex: a height-capped flex column wraps overflow into a hidden 2nd column */
  display: block !important; flex-wrap: nowrap !important; height: auto !important;
}
#controls > * { margin-bottom: 10px; }
/* let slider tracks shrink to the column width instead of overflowing sideways */
#controls input[type=range] { flex: 1 1 0 !important; min-width: 0 !important; width: auto !important; }
#viewer img { object-fit: contain; }
footer { display: none !important; }
"""

with gr.Blocks(title="DOF Studio", css=CSS) as demo:
    with gr.Row():
        # ---- photos (left, takes all spare width)
        with gr.Column(scale=1, elem_id="viewer"):
            with gr.Row(equal_height=True):
                mask_img = gr.Image(label="Subject mask (red = background) — click to add/remove",
                                    interactive=False, height="90vh", visible=False)
                result = gr.Image(label="Result — click to add/remove areas", interactive=False,
                                  height="90vh")

        # ---- settings (right, fixed width)
        with gr.Column(scale=0, min_width=380, elem_id="controls"):
            src = gr.Image(label="Photo", type="pil", sources=["upload"], height=120)
            with gr.Row():
                backend = gr.Dropdown(BACKENDS, value=BACKENDS[0] if replicate_available() else BACKENDS[1],
                                      label="AI models run on", scale=2)
                show_mask = gr.Checkbox(value=False, label="Show mask view", scale=1)
            status = gr.Markdown("Upload a photo to start.")

            with gr.Tabs():
                with gr.Tab("Subject"):
                    click_mode = gr.Radio(["Add area", "Remove area"], value="Add area", label="Clicking does")
                    with gr.Row():
                        b_auto = gr.Button("Auto people", size="sm")
                        b_undo = gr.Button("Undo", size="sm")
                        b_clear = gr.Button("Clear", size="sm")
                    gr.Markdown("Tip: start with **Auto people**, then click to add/remove pieces.")
                with gr.Tab("Blur"):
                    strength = gr.Slider(0, MAX_STRENGTH, value=8, step=0.5, label="Blur strength (max radius px)")
                    mode = gr.Radio(["Depth-based", "Flat"], value="Depth-based", label="Blur mode")
                    bokeh = gr.Radio(["Lens (disc)", "Gaussian"], value="Lens (disc)", label="Blur shape")
                    near = gr.Slider(0, 1, value=0.3, step=0.05, label="Blur things nearer than focus")
                    auto_focus = gr.Checkbox(value=True, label="Focus on subject automatically")
                    focus = gr.Slider(0, 1, value=0.75, step=0.01, label="Manual focus depth (0 far … 1 near)")
                with gr.Tab("Edge"):
                    shrink = gr.Slider(0, 6, value=2, step=1, label="Shrink edge (px)")
                    soft = gr.Slider(0, 4, value=1, step=0.25, label="Edge softness (px)")
                    wrap = gr.Slider(0, 1, value=0.3, step=0.05, label="Light wrap (background glow onto edge)")
                    wrap_width = gr.Slider(1, 20, value=6, step=1, label="Light wrap width (px)")
                    matting = gr.Checkbox(value=True, label="Refine edge with alpha matting")
                    decontam = gr.Checkbox(value=True, label="Remove old background colour from edge")
                with gr.Tab("Levels"):
                    which = gr.Radio(["Foreground (people)", "Background"], value="Foreground (people)",
                                     show_label=False)
                    with gr.Group(visible=True) as fg_group:
                        fb = gr.Slider(0, 254, value=0, step=1, label="Black point")
                        fw = gr.Slider(1, 255, value=255, step=1, label="White point")
                        fg = gr.Slider(0.3, 3, value=1.0, step=0.05, label="Gamma (midtones)")
                        fs = gr.Slider(0, 2, value=1.0, step=0.05, label="Saturation")
                    with gr.Group(visible=False) as bg_group:
                        bb = gr.Slider(0, 254, value=0, step=1, label="Black point")
                        bw = gr.Slider(1, 255, value=255, step=1, label="White point")
                        bg = gr.Slider(0.3, 3, value=1.0, step=0.05, label="Gamma (midtones)")
                        bs = gr.Slider(0, 2, value=1.0, step=0.05, label="Saturation")
                with gr.Tab("Presets"):
                    preset_pick = gr.Dropdown(preset_names(), label="Saved presets", value=None)
                    with gr.Row():
                        b_load = gr.Button("Load", size="sm", variant="primary")
                        b_delete = gr.Button("Delete", size="sm")
                    preset_name = gr.Textbox(label="Save current settings as", placeholder="e.g. Sunny arch shots")
                    b_save = gr.Button("Save preset", size="sm")
                    gr.Markdown("Presets store blur, edge and levels settings (not the mask).")

            b_export = gr.Button("Export full resolution", variant="primary")
            out_file = gr.File(label="Download", height=60)

    controls = [mode, strength, auto_focus, focus, near, bokeh,
                matting, decontam, shrink, soft, wrap, wrap_width,
                fb, fw, fg, fs, bb, bw, bg, bs]
    views = [mask_img, result]

    src.upload(load, [src, backend], [mask_img, status]).then(preview, controls, result)
    for view in views:
        view.select(click, click_mode, [mask_img, status]).then(preview, controls, result)
    b_auto.click(auto, None, mask_img).then(preview, controls, result)
    b_undo.click(undo, None, mask_img).then(preview, controls, result)
    b_clear.click(clear, None, mask_img).then(preview, controls, result)
    for c in controls:
        (c.release if isinstance(c, gr.Slider) else c.change)(preview, controls, result)
    show_mask.change(lambda v: gr.update(visible=v), show_mask, mask_img)
    which.change(lambda w: (gr.update(visible=w.startswith("Fore")), gr.update(visible=w == "Background")),
                 which, [fg_group, bg_group])
    backend.change(set_backend, backend, status)
    b_save.click(save_preset, [preset_name, *controls], [preset_pick, status])
    b_load.click(load_preset, [preset_pick, *controls], [*controls, status]).then(preview, controls, result)
    b_delete.click(delete_preset, preset_pick, [preset_pick, status])
    b_export.click(export, controls, [out_file, status])

if __name__ == "__main__":
    demo.launch(server_port=int(os.environ.get("PORT", 7860)))
