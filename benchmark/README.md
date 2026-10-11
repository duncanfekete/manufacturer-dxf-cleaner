# DXF Processing Benchmark

The benchmark runs the DXF cleanup pipeline against datasets with expected part
and geometry counts. It joins broken edges, separates parts, organises their
layers, and checks the saved output against adjacent JSON metadata. The local
frontend provides a Dashboard, File Browser, and CAD viewer for inspecting source
drawings and processed results.

For the project's overall purpose, see the [root README](../README.md). Detailed
processing behaviour is documented in [Rules.md](Rules.md).

## Setup

From the repository root, install the Python dependencies, then enter the
benchmark directory:

```sh
python -m pip install -r requirements.txt
cd benchmark
```

The Python examples and benchmark commands below run from `benchmark/`.

## Joining Small Gaps

```python
import ezdxf
from dxf_editing_functions.join_edges import join_edges

doc = ezdxf.readfile("part.dxf")
doc = join_edges(doc, gap_tol=0.01)
doc.saveas("part_joined.dxf")
```

The function accepts an `ezdxf.document.Drawing`, modifies it in place, and returns
the same drawing. The caller handles loading and saving; `join_edges` performs no
file I/O.

Tolerances are in drawing units. Connected, flat XY modelspace edges with matching
layer and display attributes are replaced with joined polylines. Tiny gaps are
bridged by straight segments, not snapped. Detected loops are marked closed.
Closed shapes, isolated edges, non-XY geometry, and other entities are not joined.
Supported inverted-extrusion geometry is made upright, and exactly zero-length
LINE entities are removed before joining. Ambiguous junctions remain separate;
block contents and paperspace are not processed.
Arcs retain their bulges; splines and non-circular ellipses are approximated using
`max_sagitta` (default `0.01` drawing units). Replacement polylines retain the listed
display attributes, but not source handles, XDATA, or other entity-specific metadata.

## Run the Benchmark

Pass the dataset root directory to the benchmark:

```sh
python -m main datasets/public_datasets/laser_cutting_set
```

The benchmark recursively finds DXFs under the provided directory and loads each
adjacent JSON file. Quote the directory path if it contains spaces. The process
returns a non-zero exit code when any entry fails or needs review.

Expected metadata uses named counts for each part:

```json
{
	"parts": [
		{
			"internal_geometry": 3,
			"internal_dividers": 0
		}
	]
}
```

An empty `parts` list means the DXF contains no parts. Each listed part implicitly
has one external profile, so only internal geometry and divider counts are stored.
Part order does not affect matching, but duplicate parts are counted separately.
Resolved counts are measured by reloading the final organized DXF. Each supported
entity on `INTERNAL_GEOMETRY` or `INTERNAL_DIVIDERS` counts once; separate divider
segments remain separate counts unless processing actually combines them in the
saved file. Benchmark counting performs no logical gap or proximity merging. Layers
with explicit `ETCH`, `ETCHING`, `ENGRAVE`, or `ENGRAVING` name tokens retain
their source layers and are excluded from cut/fold classification.
Legacy JSON files with aggregate counts must be updated to this format before
registration. Reports include expected and resolved counts, each DXF's pass
status, processing errors, and total/pass/fail counts. Structurally malformed
DXFs are retried with ezdxf's recovery reader; successful recovery emits a
warning because repairs may alter geometry. Files that still cannot be
processed are recorded as failures without stopping the benchmark or session.
Run `python -m main --help` to see the accepted root-directory argument.

## Results

Processed files are written under `results/`, mirroring the dataset subdirectories
and using a folder for each source drawing. Outputs include `original_file.dxf`,
`edge_joined.dxf`, separate `part_N.dxf` files, `details.dxf`, and
`part_N_organized.dxf` files. These stages let you inspect how joining, grouping,
and layer classification affect a drawing.

## DXF Viewer

The [render app](render/README.md) includes a Dashboard and nested File Browser for
`datasets/` and `results/`, with the CAD viewer copied from `cad-viewer-demo`.
Open a source or result DXF to inspect geometry, toggle layers, and take
measurements. The viewer is read-only and does not edit DXFs.

From `benchmark/`:

```sh
cd render
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173, or use `pnpm dev --port 5174` if that port is occupied.
`pnpm build` builds the app and `pnpm test` runs its tests. Repository browsing also
works with `pnpm preview` after building; it requires the local server, not static
HTML hosting. Keep the server on loopback: the browser exposes local dataset and
result filenames, including private datasets.