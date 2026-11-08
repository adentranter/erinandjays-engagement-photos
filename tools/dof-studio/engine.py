"""DOF Studio engine: subject masks, depth, edge matting, lens blur, per-layer levels.

All heavy models load lazily on first use and are cached for the session.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageOps
from scipy.ndimage import (
    binary_dilation,
    binary_erosion,
    gaussian_filter,
    grey_erosion,
    maximum_filter,
)
from scipy.signal import fftconvolve

PREVIEW_LONG_SIDE = 1200
# Alpha matting builds a huge sparse system; cap its resolution and upsample the
# edge for full-res export (matting at 2000px+ can eat 10GB+ of RAM).
MATTE_LONG_SIDE = 1400
# Blur radii (full-resolution pixels) pre-rendered once; sliders interpolate between them.
LEVELS = [0, 1.5, 3, 5, 7.5, 10, 13, 16, 20, 25, 30]
MAX_STRENGTH = LEVELS[-1]

_models: dict = {}


# ---------------------------------------------------------------- models
def _rembg():
    if "rembg" not in _models:
        from rembg import new_session

        _models["rembg"] = new_session("birefnet-portrait")
    return _models["rembg"]


def _depth():
    if "depth" not in _models:
        from transformers import pipeline

        _models["depth"] = pipeline(
            "depth-estimation", model="depth-anything/Depth-Anything-V2-Base-hf"
        )
    return _models["depth"]


def _sam():
    if "sam" not in _models:
        from transformers import SamModel, SamProcessor

        name = "facebook/sam-vit-base"
        _models["sam"] = (SamModel.from_pretrained(name).eval(), SamProcessor.from_pretrained(name))
    return _models["sam"]


# ---------------------------------------------------------------- replicate (cloud) backend
# Community models need a pinned version. Schemas checked Nov 2026.
REPLICATE_MODELS = {
    # input: image, resolution?  -> output: uri (cutout PNG)
    "mask": "men1scus/birefnet:f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7",
    # input: image, model_size (Small/Base/Large) -> output: {grey_depth, color_depth}
    "depth": "chenxwh/depth-anything-v2:b239ea33cff32bb7abb5db39ffe9a09c14cbc2894331d1ef66fe096eed88ebd4",
    # automatic only: input image -> {combined_mask, individual_masks[]}
    "sam": "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
}
UPLOAD_LONG_SIDE = 2048


def replicate_available() -> bool:
    import os

    return bool(os.environ.get("REPLICATE_API_TOKEN"))


def _upload_bytes(pil: Image.Image):
    import io

    im = pil.copy()
    im.thumbnail((UPLOAD_LONG_SIDE, UPLOAD_LONG_SIDE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    buf.seek(0)
    buf.name = "photo.jpg"
    return buf


def _fetch_image(out) -> Image.Image:
    """Replicate outputs are FileOutput objects (client >=1.0) or plain URLs."""
    import io
    import urllib.request

    if hasattr(out, "read"):
        data = out.read()
    else:
        with urllib.request.urlopen(str(out)) as r:
            data = r.read()
    return Image.open(io.BytesIO(data))


def _replicate_run(which: str, pil: Image.Image, **extra):
    """Run a model, waiting out rate limits (accounts under $5 credit get 1 burst / 6 per min)."""
    import re
    import time

    import replicate
    from replicate.exceptions import ReplicateError

    for attempt in range(8):
        try:
            return replicate.run(REPLICATE_MODELS[which], input={"image": _upload_bytes(pil), **extra})
        except ReplicateError as e:
            if getattr(e, "status", None) != 429 and "throttled" not in str(e):
                raise
            m = re.search(r"resets in ~(\d+)s", str(e))
            time.sleep((int(m.group(1)) if m else 10) + 1)
    raise RuntimeError("Replicate kept rate-limiting; try again in a minute.")


def _as_mask(im: Image.Image, size: tuple[int, int]) -> np.ndarray:
    im = im.getchannel("A") if im.mode in ("RGBA", "LA") else im.convert("L")
    return np.asarray(im.resize(size, Image.BILINEAR), np.float32) / 255


# ---------------------------------------------------------------- helpers
def srgb_to_lin(x):
    return np.clip(x, 0, 1) ** 2.2


def lin_to_srgb(x):
    return np.clip(x, 0, 1) ** (1 / 2.2)


def resize_f(arr: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Antialiased resize of a float array to (w, h)."""
    if arr.ndim == 2:
        return np.asarray(Image.fromarray(arr.astype(np.float32)).resize(size, Image.BILINEAR))
    return np.stack([resize_f(arr[..., c], size) for c in range(arr.shape[2])], -1)


def levels(x, black=0, white=255, gamma=1.0, saturation=1.0):
    """Classic levels (0-255 inputs) plus saturation, on an sRGB float image."""
    b, w = black / 255, max(white, black + 1) / 255
    y = np.clip((x - b) / (w - b), 0, 1) ** (1 / gamma)
    if saturation != 1:
        lum = (y @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        y = np.clip(lum + (y - lum) * saturation, 0, 1)
    return y.astype(np.float32)


def _kernel(r: float, kind: str) -> np.ndarray:
    if kind == "Lens (disc)":
        n = int(np.ceil(r))
        y, x = np.mgrid[-n : n + 1, -n : n + 1]
        k = np.clip(r + 0.5 - np.hypot(x, y), 0, 1)
    else:  # Gaussian
        s = max(r / 2, 0.5)
        n = int(np.ceil(3 * s))
        y, x = np.mgrid[-n : n + 1, -n : n + 1]
        k = np.exp(-(x * x + y * y) / (2 * s * s))
    return (k / k.sum()).astype(np.float32)


def _convolve(img: np.ndarray, k: np.ndarray) -> np.ndarray:
    n = k.shape[0] // 2
    out = []
    for c in range(img.shape[2]):
        p = np.pad(img[..., c], n, mode="reflect")
        out.append(fftconvolve(p, k, mode="valid"))
    return np.stack(out, -1).astype(np.float32)


def _fill_behind_subject(lin: np.ndarray, w: np.ndarray, scale: float) -> np.ndarray:
    """Replace subject pixels with smeared surrounding background, so the blur
    never picks up the subject's own colours (that is what causes halos)."""
    acc = None
    for s in (128, 64, 32, 16, 8, 4, 2):  # coarse -> fine
        sig = max(1.0, s * scale)
        den = gaussian_filter(w, sig)
        num = gaussian_filter(lin * w[..., None], (sig, sig, 0))
        est = num / np.maximum(den, 1e-8)[..., None]
        conf = np.clip(den * 4, 0, 1)[..., None]
        acc = est if acc is None else est * conf + acc * (1 - conf)
    return (lin * w[..., None] + acc * (1 - w[..., None])).astype(np.float32)


# ---------------------------------------------------------------- session
class Session:
    def __init__(self, pil: Image.Image, backend: str = "local"):
        self.backend = backend  # "local" or "replicate"
        self._sam_masks: list[np.ndarray] | None = None  # replicate SAM-2 masks (preview res)
        self.pil = ImageOps.exif_transpose(pil).convert("RGB")
        self.img = np.asarray(self.pil, dtype=np.float32) / 255
        self.H, self.W = self.img.shape[:2]
        self.preview_scale = min(1.0, PREVIEW_LONG_SIDE / max(self.W, self.H))
        self.mask = np.zeros((self.H, self.W), np.float32)
        self.depth = np.zeros((self.H, self.W), np.float32)
        self.history: list[np.ndarray] = []
        self._sam_emb = None
        self._cache: dict = {}

    # ---- analysis
    def compute_depth(self):
        if self.backend == "replicate":
            out = _replicate_run("depth", self.pil, model_size="Large")
            d = np.asarray(_fetch_image(out["grey_depth"]).convert("L"), np.float32)
            d = resize_f(d, (self.W, self.H))  # bright = near, same as local
            self.depth = ((d - d.min()) / (d.max() - d.min() + 1e-6)).astype(np.float32)
            self._cache.clear()
            return
        pred = _depth()(self.pil)["predicted_depth"]
        d = pred.squeeze().detach().float().cpu().numpy()
        d = resize_f(d, (self.W, self.H))
        self.depth = ((d - d.min()) / (d.max() - d.min() + 1e-6)).astype(np.float32)  # 1 = near
        self._cache.clear()
        # depth only runs once per photo: free the model (~1-2GB) rather than keep it resident
        _models.pop("depth", None)
        import gc

        gc.collect()

    # ---- mask editing
    def set_mask(self, m: np.ndarray):
        self.history = (self.history + [self.mask])[-20:]
        self.mask = np.clip(m, 0, 1).astype(np.float32)
        self._cache.clear()

    def undo(self):
        if self.history:
            self.mask = self.history.pop()
            self._cache.clear()

    def clear_mask(self):
        self.set_mask(np.zeros_like(self.mask))

    def auto_mask(self):
        if self.backend == "replicate":
            self.set_mask(_as_mask(_fetch_image(_replicate_run("mask", self.pil)), (self.W, self.H)))
            return
        from rembg import remove

        m = remove(self.pil, session=_rembg(), only_mask=True)
        self.set_mask(np.asarray(m, np.float32) / 255)

    def _replicate_sam_masks(self) -> list[np.ndarray]:
        """Run SAM-2 automatic segmentation once; clicks then pick from these locally."""
        if self._sam_masks is None:
            from concurrent.futures import ThreadPoolExecutor

            # defaults (0.88 / 0.95) drop most objects; looser thresholds cover the whole photo
            out = _replicate_run("sam", self.pil, points_per_side=32,
                                 pred_iou_thresh=0.7, stability_score_thresh=0.8)
            urls = out["individual_masks"]
            pw, ph = round(self.W * self.preview_scale), round(self.H * self.preview_scale)
            with ThreadPoolExecutor(8) as ex:
                ims = list(ex.map(_fetch_image, urls))
            self._sam_masks = [_as_mask(im, (pw, ph)) > 0.5 for im in ims]
        return self._sam_masks

    def sam_click(self, x: float, y: float, add: bool = True):
        """Click a point (full-res coords); SAM picks the object there."""
        if self.backend == "replicate":
            masks = self._replicate_sam_masks()
            px = min(int(x * self.preview_scale), masks[0].shape[1] - 1) if masks else 0
            py = min(int(y * self.preview_scale), masks[0].shape[0] - 1) if masks else 0
            hits = [mk for mk in masks if mk[py, px] and mk.mean() < 0.5]
            if not hits:
                raise ValueError("No object found at that spot — try clicking nearer its middle.")
            pick = max(hits, key=lambda mk: mk.sum())  # largest object under the click
            m = resize_f(pick.astype(np.float32), (self.W, self.H))
            self.set_mask(np.maximum(self.mask, m) if add else self.mask * (1 - m))
            return
        import torch

        model, proc = _sam()
        if self._sam_emb is None:
            px = proc(self.pil, return_tensors="pt")["pixel_values"]
            with torch.no_grad():
                self._sam_emb = model.get_image_embeddings(px)
        inp = proc(self.pil, input_points=[[[float(x), float(y)]]], return_tensors="pt")
        with torch.no_grad():
            out = model(
                image_embeddings=self._sam_emb,
                input_points=inp["input_points"],
                multimask_output=True,
            )
        masks = proc.image_processor.post_process_masks(
            out.pred_masks.cpu(), inp["original_sizes"].cpu(), inp["reshaped_input_sizes"].cpu()
        )[0]
        best = int(out.iou_scores[0, 0].argmax())
        m = masks[0, best].numpy().astype(np.float32)
        self.set_mask(np.maximum(self.mask, m) if add else self.mask * (1 - m))

    # ---- cached layers at a given scale
    def layers(self, scale: float) -> dict:
        key = ("layers", scale)
        if key not in self._cache:
            if scale == 1:
                img, mask, depth = self.img, self.mask, self.depth
            else:
                size = (max(1, round(self.W * scale)), max(1, round(self.H * scale)))
                img, mask, depth = (resize_f(a, size) for a in (self.img, self.mask, self.depth))
            grow = max(2, int(round(7 * scale)))
            bgw = 1 - maximum_filter(mask, size=2 * grow + 1)
            lin = srgb_to_lin(img)
            self._cache[key] = dict(
                img=img, lin=lin, mask=mask, depth=depth,
                bgfill=_fill_behind_subject(lin, bgw, scale),
            )
        return self._cache[key]

    def stack(self, scale: float, kind: str) -> list[np.ndarray]:
        key = ("stack", scale, kind)
        if key not in self._cache:
            src = self.layers(scale)["bgfill"]
            self._cache[key] = [
                src if r * scale < 0.5 else _convolve(src, _kernel(r * scale, kind)) for r in LEVELS
            ]
        return self._cache[key]

    def matte(self, scale: float, refine: bool, decontam: bool):
        key = ("matte", scale, refine, decontam)
        ms = MATTE_LONG_SIDE / max(self.W, self.H)
        if key not in self._cache and (refine or decontam) and scale > ms * 1.01:
            # solve at capped resolution, upsample, and only use it in the edge band
            a_lo, f_lo = self.matte(ms, refine, decontam)
            L = self.layers(scale)
            size = (L["img"].shape[1], L["img"].shape[0])
            alpha = np.clip(resize_f(a_lo, size), 0, 1)
            edge = ((alpha > 0.01) & (alpha < 0.99))[..., None]
            F = np.where(edge, resize_f(f_lo, size), L["img"]).astype(np.float32)
            self._cache[key] = (alpha.astype(np.float32), F)
        if key not in self._cache:
            L = self.layers(scale)
            img, m = L["img"].astype(np.float64), L["mask"]
            alpha = m.astype(np.float64)
            hard = m > 0.5
            if refine and hard.any() and (~hard).any():
                from pymatting import estimate_alpha_cf

                band = max(3, int(round(6 * scale)))
                tri = np.full(m.shape, 0.5)
                tri[binary_erosion(hard, iterations=band)] = 1
                tri[~binary_dilation(hard, iterations=band)] = 0
                alpha = np.clip(estimate_alpha_cf(img, tri), 0, 1)
            F = img
            if decontam and hard.any():
                from pymatting import estimate_foreground_ml

                F = np.clip(estimate_foreground_ml(img, alpha), 0, 1)
            self._cache[key] = (alpha.astype(np.float32), F.astype(np.float32))
        return self._cache[key]

    # ---- views
    def mask_view(self) -> np.ndarray:
        L = self.layers(self.preview_scale)
        img, m = L["img"], L["mask"][..., None]
        tint = img * 0.35 + np.array([0.55, 0.05, 0.1], np.float32) * 0.3
        return (np.clip(img * m + tint * (1 - m), 0, 1) * 255).astype(np.uint8)

    def render(self, p: dict, full: bool = False) -> np.ndarray:
        scale = 1.0 if full else self.preview_scale
        L = self.layers(scale)
        alpha, F = self.matte(scale, p["matting"], p["decontam"])

        # edge shape
        a = alpha
        sh = int(round(p["shrink"] * scale))
        if sh > 0:
            a = grey_erosion(a, size=(2 * sh + 1, 2 * sh + 1))
        if p["soft"] > 0:
            a = gaussian_filter(a, p["soft"] * scale)

        # blur radius per pixel (full-res px units)
        depth, m = L["depth"], L["mask"]
        if p["mode"] == "Depth-based":
            subj = m > 0.9
            d_f = float(np.median(depth[subj])) if (p["auto_focus"] and subj.any()) else p["focus"]
            far = np.clip(d_f - depth, 0, None) / max(d_f - depth.min(), 1e-3)
            near = np.clip(depth - d_f, 0, None) / max(depth.max() - d_f, 1e-3) * p["near"]
            r = np.maximum(far, near) * p["strength"]
        else:
            r = np.full(depth.shape, p["strength"], np.float32)
        r = np.clip(gaussian_filter(r, max(1.0, 3 * scale)), 0, MAX_STRENGTH)

        # interpolate the pre-blurred stack
        stack = self.stack(scale, p["bokeh"])
        lv = np.array(LEVELS, np.float32)
        idx = np.clip(np.searchsorted(lv, r) - 1, 0, len(lv) - 2)
        t = (r - lv[idx]) / (lv[idx + 1] - lv[idx])
        bg_lin = np.zeros_like(L["lin"])
        for i, level in enumerate(stack):
            w = np.where(idx == i, 1 - t, 0) + np.where(idx + 1 == i, t, 0)
            if w.any():
                bg_lin += level * w[..., None]

        # per-layer levels
        bg_lin = srgb_to_lin(levels(lin_to_srgb(bg_lin), *p["bg_levels"]))
        fg_lin = srgb_to_lin(levels(F, *p["fg_levels"]))

        # light wrap: let blurred background light spill onto the subject's edge,
        # imitating a real lens seeing slightly around the subject
        if p["wrap"] > 0:
            ww = max(1.0, p["wrap_width"] * scale)
            band = np.clip(gaussian_filter(1 - a, ww) * a * 2 * p["wrap"], 0, 1)[..., None]
            glow = gaussian_filter(bg_lin, (ww, ww, 0))
            fg_lin = fg_lin * (1 - band) + glow * band

        out = fg_lin * a[..., None] + bg_lin * (1 - a[..., None])
        result = (lin_to_srgb(out) * 255 + 0.5).astype(np.uint8)
        if full:  # full-res layers/stacks are ~1GB+; don't keep them after export
            for k in [k for k in self._cache if k[1] == 1.0]:
                del self._cache[k]
        return result
