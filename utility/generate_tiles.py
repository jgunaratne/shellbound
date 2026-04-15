#!/usr/bin/env python3
"""
generate_tiles.py — Seamless Tile Atlas Generator

Generates a 4x4 grid of 16 visually distinct tiles that tile perfectly
with zero visible seams. Uses a shared seamless base with per-tile
interior variations (crops, flips, color jitter, noise).

Usage:
    python generate_tiles.py <input.png> [--output output.png] [--tile-size 256]
                                          [--blend-width 48] [--preview]

Requirements:
    pip install Pillow numpy
"""

import argparse
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_array(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float64)


def _to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------------------
# Float-safe resize (avoids uint8 clipping for signed Laplacian values)
# ---------------------------------------------------------------------------
def _resize_float(arr, new_h, new_w):
    """Resize a float64 array using PIL's 32-bit float mode (no clipping)."""
    if new_h == arr.shape[0] and new_w == arr.shape[1]:
        return arr.copy()
    if arr.ndim == 2:
        img = Image.fromarray(arr.astype(np.float32), mode='F')
        return np.asarray(img.resize((new_w, new_h), Image.BILINEAR)).astype(np.float64)
    ch = arr.shape[2]
    out = np.zeros((new_h, new_w, ch), dtype=np.float64)
    for c in range(ch):
        img = Image.fromarray(arr[..., c].astype(np.float32), mode='F')
        out[..., c] = np.asarray(img.resize((new_w, new_h), Image.BILINEAR)).astype(np.float64)
    return out


# ---------------------------------------------------------------------------
# Laplacian pyramid blending
# ---------------------------------------------------------------------------
def _blur_float(arr, radius=2):
    """Gaussian blur for pyramid downsampling (values are in image range)."""
    img = _to_image(arr)
    blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))
    return _to_array(blurred)


def laplacian_pyramid_blend(base, overlay, mask, levels=5):
    """Multi-band blend: low freqs over wide area, high freqs over narrow area.

    Eliminates the visible halo that simple alpha blending produces at the
    mask boundary.
    """
    # Build Gaussian pyramids (blur → downsample)
    gp_b, gp_o, gp_m = [base], [overlay], [mask]
    for _ in range(levels - 1):
        h, w = gp_b[-1].shape[:2]
        nh, nw = max(1, h // 2), max(1, w // 2)
        gp_b.append(_resize_float(_blur_float(gp_b[-1]), nh, nw))
        gp_o.append(_resize_float(_blur_float(gp_o[-1]), nh, nw))
        gp_m.append(_resize_float(gp_m[-1], nh, nw))

    # Laplacian pyramids = difference between consecutive Gaussian levels
    lp_b, lp_o = [], []
    for i in range(levels - 1):
        h, w = gp_b[i].shape[:2]
        lp_b.append(gp_b[i] - _resize_float(gp_b[i + 1], h, w))
        lp_o.append(gp_o[i] - _resize_float(gp_o[i + 1], h, w))
    lp_b.append(gp_b[-1])
    lp_o.append(gp_o[-1])

    # Blend each frequency band with the mask at that scale
    blended = []
    for i in range(levels):
        m = np.broadcast_to(gp_m[i], lp_b[i].shape)
        blended.append(lp_b[i] * (1.0 - m) + lp_o[i] * m)

    # Reconstruct from coarsest level up
    result = blended[-1]
    for i in range(levels - 2, -1, -1):
        h, w = blended[i].shape[:2]
        result = _resize_float(result, h, w) + blended[i]
    return result


# ---------------------------------------------------------------------------
# Value noise (no external deps)
# ---------------------------------------------------------------------------
def _hash2d(x, y):
    h = x * 374761393 + y * 668265263
    h = (h ^ (h >> 13)) * 1274126177
    return (h & 0x7FFFFFFF).astype(np.float64) / 0x7FFFFFFF


def value_noise_2d(rows, cols, scale=4.0, seed=0):
    y_coords, x_coords = np.mgrid[0:rows, 0:cols]
    x = x_coords.astype(np.float64) / cols * scale + seed * 17.31
    y = y_coords.astype(np.float64) / rows * scale + seed * 13.73
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    xf, yf = x - xi, y - yi
    sx = xf * xf * (3 - 2 * xf)
    sy = yf * yf * (3 - 2 * yf)
    n00, n10 = _hash2d(xi, yi), _hash2d(xi + 1, yi)
    n01, n11 = _hash2d(xi, yi + 1), _hash2d(xi + 1, yi + 1)
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy


# ---------------------------------------------------------------------------
# Luminosity equalisation (PoE Step 3)
# ---------------------------------------------------------------------------
def equalize_luminosity(img: Image.Image, blur_radius: int = 64) -> Image.Image:
    arr = _to_array(img)
    gray = np.mean(255.0 - arr[..., :3], axis=2, keepdims=True)
    gray_rgb = np.repeat(gray, 3, axis=2)
    if arr.shape[2] == 4:
        gray_img = _to_image(np.concatenate([gray_rgb, arr[..., 3:4]], axis=2))
    else:
        gray_img = _to_image(gray_rgb)
    blur_arr = _to_array(gray_img.filter(ImageFilter.GaussianBlur(radius=blur_radius)))[..., :3]
    base = arr[..., :3]
    low = 2.0 * base * blur_arr / 255.0
    high = 255.0 - 2.0 * (255.0 - base) * (255.0 - blur_arr) / 255.0
    blended = base * 0.5 + np.where(base < 128, low, high) * 0.5
    if arr.shape[2] == 4:
        return _to_image(np.concatenate([blended, arr[..., 3:4]], axis=2))
    return _to_image(blended)


# ---------------------------------------------------------------------------
# Make a texture seamlessly tileable (half-offset blend)
# ---------------------------------------------------------------------------
def make_seamless(arr: np.ndarray, blend_width: int) -> np.ndarray:
    """Make texture seamlessly tileable using the half-offset blend technique.

    1. Original has seams at edges, clean center
    2. Offset by half has seams at center, clean edges
    3. Blend: original in center, offset at edges → seamless everywhere
    """
    h, w = arr.shape[:2]
    offset = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)

    # Smooth cosine ramp: 0 at edges → 1 in interior
    def cosine_ramp(size, bw):
        ramp = np.ones(size)
        if bw > 0:
            t = np.linspace(0, math.pi / 2, bw)
            ramp[:bw] = np.sin(t) ** 2
            ramp[-bw:] = np.cos(np.linspace(0, math.pi / 2, bw)) ** 2
        return ramp

    mx = cosine_ramp(w, blend_width)
    my = cosine_ramp(h, blend_width)
    mask = (my[:, None] * mx[None, :])[..., None]

    return arr * mask + offset * (1 - mask)


# ---------------------------------------------------------------------------
# Interior mask — defines where per-tile variation is visible
# ---------------------------------------------------------------------------
def make_interior_mask(size: int, margin: int, seed: int = 0) -> np.ndarray:
    """Smooth mask with noise-distorted boundary.

    Uses 4 octaves of value noise for a fractal, organic-looking boundary
    that hides the geometric tile grid.
    """
    # Base distance field: distance from nearest edge, normalised to [0, 1]
    ys, xs = np.mgrid[0:size, 0:size]
    dist_from_edge = np.minimum(
        np.minimum(ys, size - 1 - ys),
        np.minimum(xs, size - 1 - xs),
    ).astype(np.float64)

    # 4 octaves of noise for fractal boundary distortion
    noise = value_noise_2d(size, size, scale=3.0, seed=seed) * 1.0
    noise += value_noise_2d(size, size, scale=6.0, seed=seed + 100) * 0.5
    noise += value_noise_2d(size, size, scale=12.0, seed=seed + 200) * 0.25
    noise += value_noise_2d(size, size, scale=24.0, seed=seed + 300) * 0.125
    noise /= 1.875  # normalise back to ~[0,1]

    # Distort: shift the effective distance by noise (±35% of margin)
    distortion = (noise - 0.5) * margin * 0.65
    dist_distorted = dist_from_edge + distortion

    # Smooth ramp from 0 (at edge) to 1 (at margin depth)
    t = np.clip(dist_distorted / max(margin, 1), 0, 1)
    # Cosine-squared for smooth falloff
    mask = (np.sin(t * math.pi / 2)) ** 2
    return mask


def _match_color(overlay: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Adjust overlay's per-channel mean and std to match the base.

    This reduces color/brightness discontinuities at the blend boundary.
    """
    result = overlay.copy()
    for c in range(min(3, overlay.shape[2])):
        o_mean = overlay[..., c].mean()
        o_std = max(overlay[..., c].std(), 1e-6)
        b_mean = base[..., c].mean()
        b_std = base[..., c].std()
        result[..., c] = (overlay[..., c] - o_mean) * (b_std / o_std) + b_mean
    return result


def _match_color_edge(overlay: np.ndarray, base: np.ndarray,
                      margin: int) -> np.ndarray:
    """Match overlay color stats specifically in the edge strip.

    The edge strip is where the blend mask transitions, so matching
    color/brightness here (rather than globally) reduces visible
    discontinuities right at the seam zone.
    """
    h, w = overlay.shape[:2]
    # Build a mask for the edge strip (margin pixels from each border)
    edge_mask = np.zeros((h, w), dtype=bool)
    edge_mask[:margin, :] = True
    edge_mask[-margin:, :] = True
    edge_mask[:, :margin] = True
    edge_mask[:, -margin:] = True

    result = overlay.copy()
    for c in range(min(3, overlay.shape[2])):
        o_edge = overlay[..., c][edge_mask]
        b_edge = base[..., c][edge_mask]
        o_mean, o_std = o_edge.mean(), max(o_edge.std(), 1e-6)
        b_mean, b_std = b_edge.mean(), b_edge.std()
        # Apply the edge-derived correction globally (smooth result)
        result[..., c] = (overlay[..., c] - o_mean) * (b_std / o_std) + b_mean
    return result


# ---------------------------------------------------------------------------
# Wrap-safe crop
# ---------------------------------------------------------------------------
def _wrap_crop(src, ox, oy, h, w):
    sh, sw = src.shape[:2]
    rows = (np.arange(h) + oy) % sh
    cols = (np.arange(w) + ox) % sw
    return src[np.ix_(rows, cols)].copy()


# ---------------------------------------------------------------------------
# Core atlas generation
# ---------------------------------------------------------------------------
PHI = (1 + math.sqrt(5)) / 2


def generate_tile_atlas(
    source_path: str,
    tile_size: int = 256,
    blend_width: int = 72,
    do_equalize: bool = True,
) -> Image.Image:
    src_img = Image.open(source_path).convert("RGBA")
    if do_equalize:
        src_img = equalize_luminosity(src_img)

    # Ensure source is at least tile_size in each dimension
    if src_img.width < tile_size or src_img.height < tile_size:
        reps_x = max(1, (tile_size + src_img.width - 1) // src_img.width)
        reps_y = max(1, (tile_size + src_img.height - 1) // src_img.height)
        tiled = Image.new("RGBA", (src_img.width * reps_x, src_img.height * reps_y))
        for ry in range(reps_y):
            for rx in range(reps_x):
                tiled.paste(src_img, (rx * src_img.width, ry * src_img.height))
        src_img = tiled

    src = _to_array(src_img)
    sh, sw, channels = src.shape

    # --- Step 1: Create seamless base tile ---
    cy = max(0, (sh - tile_size) // 2)
    cx = max(0, (sw - tile_size) // 2)
    base_crop = src[cy:cy + tile_size, cx:cx + tile_size].copy()
    seamless_base = make_seamless(base_crop, blend_width)

    # --- Step 2: Interior masks (unique noise boundary per tile) ---
    interior_masks = [
        make_interior_mask(tile_size, blend_width, seed=i)[..., None]
        for i in range(16)
    ]

    # --- Step 3: Systematic transforms for maximum variety ---
    # 4 transform combos: (no-op, flip-H, flip-V, flip-both/180°)
    transforms = [
        lambda a: a,                                          # identity
        lambda a: a[:, ::-1, :].copy(),                       # flip horizontal
        lambda a: a[::-1, :, :].copy(),                       # flip vertical
        lambda a: a[::-1, ::-1, :].copy(),                    # rotate 180°
    ]

    # --- Step 4: Generate 16 tile variants ---
    # 4 source crops × 4 transforms = 16 unique tiles
    atlas = np.zeros((tile_size * 4, tile_size * 4, channels), dtype=np.float64)

    for idx in range(16):
        rng = np.random.RandomState(idx * 31 + 17)

        # Start with the sharp seamless base (already seamless at edges)
        tile = seamless_base.copy()

        # Each tile gets a unique crop AND a systematic transform
        transform_idx = idx % 4

        # Unique crop per tile using golden ratio spacing
        ox = int((idx * PHI * sw * 0.618) % max(1, sw))
        oy = int((idx * PHI * PHI * sh * 0.618) % max(1, sh))
        overlay = _wrap_crop(src, ox, oy, tile_size, tile_size).astype(np.float64)

        # Apply systematic transform
        overlay = transforms[transform_idx](overlay)

        # Also apply a secondary random flip for extra variety
        if rng.random() > 0.7:
            overlay = overlay[::-1, :, :].copy()

        # Match overlay color/brightness to base, prioritising the edge strip
        overlay = _match_color_edge(overlay, seamless_base, blend_width)

        # Subtle per-tile brightness jitter
        overlay[..., :3] *= 1.0 + (rng.random() - 0.5) * 0.05

        # Noise-distorted interior mask for this tile
        imask = interior_masks[idx]

        # Multi-band blend: seamless transitions at all frequency scales
        pyr_levels = min(5, max(2, int(math.log2(tile_size)) - 3))
        tile = laplacian_pyramid_blend(tile, overlay, imask, levels=pyr_levels)

        # Place in atlas
        row, col = idx // 4, idx % 4
        y0, x0 = row * tile_size, col * tile_size
        atlas[y0:y0 + tile_size, x0:x0 + tile_size] = tile

    return _to_image(atlas)


# ---------------------------------------------------------------------------
# Preview: random tile assembly
# ---------------------------------------------------------------------------
def generate_preview(atlas: Image.Image, tile_size: int,
                     grid_w: int = 8, grid_h: int = 8) -> Image.Image:
    tiles = []
    for idx in range(16):
        row, col = idx // 4, idx % 4
        x0, y0 = col * tile_size, row * tile_size
        tiles.append(atlas.crop((x0, y0, x0 + tile_size, y0 + tile_size)))

    preview = Image.new("RGBA", (grid_w * tile_size, grid_h * tile_size))
    rng = random.Random(42)
    for gy in range(grid_h):
        for gx in range(grid_w):
            tile = rng.choice(tiles)
            preview.paste(tile, (gx * tile_size, gy * tile_size))
    return preview


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Generate a 4x4 seamless tile atlas from a source PNG.",
    )
    parser.add_argument("input", help="Path to the source PNG image")
    parser.add_argument("--output", "-o", help="Output atlas path")
    parser.add_argument("--tile-size", "-s", type=int, default=256)
    parser.add_argument("--blend-width", "-b", type=int, default=72,
                        help="Edge blend margin in pixels (default: 48)")
    parser.add_argument("--equalize", dest="equalize",
                        action="store_true", default=True)
    parser.add_argument("--no-equalize", dest="equalize",
                        action="store_false")
    parser.add_argument("--preview", "-p", action="store_true")
    parser.add_argument("--preview-grid", type=int, nargs=2, default=[8, 8],
                        metavar=("W", "H"))

    args = parser.parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output) if args.output else (
        input_path.parent / f"{input_path.stem}_tiles.png"
    )

    if args.blend_width >= args.tile_size // 2:
        args.blend_width = args.tile_size // 4

    print(f"Source:      {input_path}")
    print(f"Tile size:   {args.tile_size}x{args.tile_size}")
    print(f"Blend width: {args.blend_width}px")
    print(f"Output:      {output_path}")
    print()

    print("Generating tile atlas...")
    atlas = generate_tile_atlas(
        str(input_path), args.tile_size, args.blend_width, args.equalize)
    atlas.save(str(output_path))
    print(f"  Saved atlas: {output_path} ({atlas.width}x{atlas.height})")

    if args.preview:
        preview_path = output_path.parent / f"{output_path.stem}_preview.png"
        gw, gh = args.preview_grid
        print(f"Generating {gw}x{gh} preview...")
        preview = generate_preview(atlas, args.tile_size, gw, gh)
        preview.save(str(preview_path))
        print(f"  Saved preview: {preview_path} ({preview.width}x{preview.height})")

    print("\nDone!")


if __name__ == "__main__":
    main()
