# manufacturer-dxf-cleaner
Taking messing dxfs (messy layers, breaks, several parts) and decomposing them into one or more clean dxfs.

## Joining Small Gaps

Install dependencies with `python -m pip install -r requirements.txt`, then:

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
Closed shapes, isolated edges, non-XY geometry, and other entities are preserved.
Chains stop at ambiguous junctions; block contents and paperspace are not processed.
Arcs retain their bulges; splines and non-circular ellipses are approximated using
`max_sagitta` (default `0.01` drawing units). Replacement polylines retain the listed
display attributes, but not source handles, XDATA, or other entity-specific metadata.

## Benchmark CLI

Install dependencies with `python -m pip install -r requirements.txt`, then start
an interactive session:

```sh
python -m cli
```

At the `dxf>` prompt, enter commands separately:

```text
register datasets/public_datasets/test
run
dump results/benchmarks
exit_session
```

The registry stays in memory until `exit_session`, Ctrl-D, or Ctrl-C closes the
session. Quote directory paths containing spaces. Command errors leave the
session running. Chained one-shot commands are also supported:

```sh
python cli.py register datasets/public_datasets/test run dump results/benchmarks
```

`register DIRECTORY` recursively loads DXFs and their adjacent JSON metadata.
Multiple `register` commands can precede `run`. `run` benchmarks the in-memory
registry, and `dump DIRECTORY` writes `benchmark.json`, creating the output
directory if needed and replacing an existing report. Separate CLI processes do
not retain the registry. Registering more files after a run clears its results,
so run again before exporting.

Expected metadata uses named counts for each part:

```json
{
	"no_parts": 1,
	"parts": [
		{
			"external_geometry": 1,
			"internal_geometry": 3,
			"internal_dividers": 0
		}
	]
}
```

Part order does not affect matching, but duplicate parts are counted separately.
Internal divider counts represent logical folds: straight segments on the same
supporting line count once, including dashed or retraced lines. Parallel offset
lines and non-straight divider paths count separately. The saved DXF retains
the original segments; counting does not bridge gaps or alter geometry. Layers
with explicit `ETCH`, `ETCHING`, `ENGRAVE`, or `ENGRAVING` name tokens retain
their source layers and are excluded from cut/fold classification.
Legacy JSON files with aggregate counts must be updated to this format before
registration. Reports include expected and resolved counts, each DXF's pass
status, processing errors, and total/pass/fail counts. Structurally malformed
DXFs are retried with ezdxf's recovery reader; successful recovery emits a
warning because repairs may alter geometry. Files that still cannot be
processed are recorded as failures without stopping the benchmark or session.
Use `python cli.py --help` or
`python cli.py register --help` for command help.

## DXF Viewer

The [render app](render/README.md) includes a Dashboard and nested File Browser for `datasets/` and `results/`, with the CAD viewer copied from `cad-viewer-demo`.

```sh
cd render
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173, or use `pnpm dev --port 5174` if that port is occupied. `pnpm build` builds the app and `pnpm test` runs its tests. Repository browsing also works with `pnpm preview` after building; it requires the local server, not static HTML hosting.
