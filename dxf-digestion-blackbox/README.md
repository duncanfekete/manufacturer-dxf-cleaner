# DXF Digestion

[dxf-digestion.py](dxf-digestion.py) exposes the benchmark's processing pipeline
as an in-memory Python API:

```python
def process_drawing(drawing: Drawing) -> list[Drawing]:
	...
```

It joins broken edges, splits manufacturing parts, and organises each part's
layers using the same helpers and default tolerances as the
[benchmark](../benchmark/README.md). The returned list contains the equivalents
of `part_N_organized.dxf`, without saving or reloading
intermediate files.

Joining modifies the supplied drawing in place. Grouping creates independent
part drawings, which are then organised in place. Every returned part includes
shared annotations and detected sheet details on `IGNORE`, at their original
coordinates and without manufacturing-layer classification. There is no separate
details drawing; empty or details-only inputs return an empty list.
Processing exceptions propagate to the caller.
Etch/engraving intent is detected before detail extraction and copied only to
a uniquely owning part on `ETCH`. Ambiguous or unassigned etch content emits a
warning and becomes shared `IGNORE` instead. Unclassified content uses `0`.
Final layers are `0`, `ETCH`, `IGNORE`, `EXTERNAL_GEOMETRY`, `INTERNAL_GEOMETRY`,
and `INTERNAL_DIVIDERS`; other source layers are removed after routing their
entities, including block contents and layouts.

The caller handles loading, saving, and any malformed-file recovery. This API
does not read or write DXFs, run benchmarks, or compute benchmark counts.
Tolerances are in drawing units, not automatically millimetres.

## Usage

Install dependencies from the repository root with
`python -m pip install -r requirements.txt`. Keep this directory alongside
`benchmark/`: the module imports the existing benchmark helpers rather than
duplicating their geometry logic.

The script's hyphenated filename requires loading it with `importlib` rather
than a normal Python import. From the repository root:

```python
import importlib.util
from pathlib import Path

module_path = Path("dxf-digestion-blackbox/dxf-digestion.py").resolve()
spec = importlib.util.spec_from_file_location("dxf_digestion", module_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# drawing is an ezdxf Drawing already loaded or created by the caller.
organised_parts = module.process_drawing(drawing)
# Each part's modelspace includes its own copy of the IGNORE details.
```