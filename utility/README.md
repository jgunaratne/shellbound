# Shellbound Utilities

## generate_tiles.py — Wang Tile Atlas Generator

Generates a **4×4 grid of 16 Wang tiles** from a source PNG image, creating textures that can tile infinitely without visible large-scale repetition. Based on the technique described in the [Path of Exile dev diary](https://www.pathofexile.com/forum/view-thread/55091).

### How It Works

Wang tiles use **edge-matching** rules to create non-repeating patterns:

- Each tile has 4 edges (top, right, bottom, left)
- Each edge is one of **2 types** (A or B)
- 2⁴ = **16 total tile combinations** arranged in a 4×4 atlas
- At runtime, tiles are randomly placed on a grid — matching adjacent edge types — producing an organic, non-periodic surface

The script automates the manual Photoshop process from the PoE article:

1. **Luminosity equalisation** — Flattens large-scale brightness variation (invert → desaturate → blur → overlay blend)
2. **Edge strip extraction** — Samples two distinct horizontal and two vertical strips from different regions of the source
3. **Tile construction** — Crops 16 offset regions from the source and blends the appropriate edge strips onto each edge with feathered alpha
4. **Atlas output** — Assembles all 16 tiles into a single `4×4` PNG atlas

### Requirements

```bash
pip install Pillow numpy
```

### Usage

```bash
# Basic usage (generates grass_tiles.png)
python utility/generate_tiles.py assets/grass.png

# Custom tile size and output
python utility/generate_tiles.py assets/stone.png --tile-size 512 --output assets/stone_atlas.png

# With an 8×8 tiling preview
python utility/generate_tiles.py assets/dirt.png --preview

# Skip luminosity equalisation
python utility/generate_tiles.py assets/moss.png --no-equalize

# Full options
python utility/generate_tiles.py assets/ground.png \
    --tile-size 512 \
    --blend-width 64 \
    --preview \
    --preview-grid 10 10
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output, -o` | `<input>_tiles.png` | Output path for the atlas |
| `--tile-size, -s` | `256` | Size of each tile in pixels |
| `--blend-width, -b` | `32` | Feathered seam blend width in pixels |
| `--equalize` | `on` | Equalise luminosity (flatten brightness) |
| `--no-equalize` | — | Skip luminosity equalisation |
| `--preview, -p` | `off` | Generate an assembled preview image |
| `--preview-grid W H` | `8 8` | Grid dimensions for the preview |

### Output

- **Atlas**: A single PNG with all 16 tiles in a 4×4 grid. The tile at grid position `(col, row)` has index `row*4 + col`, encoding edges as `top*8 + right*4 + bottom*2 + left`.
- **Preview** (optional): An assembled image showing the tiles placed randomly with edge-matching constraints, demonstrating the non-repeating result.

### Using the Atlas in a Shader

The atlas is designed to be consumed by a GPU shader that:

1. Assigns each terrain cell a random tile index (constrained by neighbour edges)
2. Samples the correct tile from the atlas using UV offset: `uv_offset = vec2(col, row) / 4.0`

See [GPU Gems 2, Chapter 12](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-12-tile-based-texture-mapping) for shader implementation details.
