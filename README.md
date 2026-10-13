# Manufacturer DXF Cleaner

Process messy manufacturer-supplied DXF drawings into cleaner, organised files
for manufacturing workflows. Incoming drawings often contain broken edges,
multiple parts in one file, and layers that do not clearly distinguish cutting,
folding, or marking operations.

## Processing Workflow

1. **Join broken edges.** Small gaps between edges are a common DXF issue and can
   prevent a profile from being recognised as a continuous contour. Join compatible
   connected edges and bridge small gaps within a configurable tolerance.
2. **Split into separate parts.** Group geometry belonging to each manufacturing
   part and produce a separate DXF for each part. Attach etch/engraving content
   to its owning part; copy shared annotations and identified sheet details to
   every part on `IGNORE`.
3. **Organise manufacturing layers.** Decompose each part into an external profile,
   internal cut geometry, and internal dividers such as fold lines. Preserve
   explicitly named etching and engraving content on `ETCH`, separate from cuts
   and folds. Put unclassified content on layer `0` for downstream review.

The organised output uses `EXTERNAL_GEOMETRY`, `INTERNAL_GEOMETRY`, and
`INTERNAL_DIVIDERS`, alongside `ETCH`, `IGNORE`, and `0`. Other source layers are
removed after their entities are routed to these output layers, including block
contents and layouts.

Processing preserves a copy of the source drawing and saves intermediate outputs
for inspection. Tolerances are in drawing units, not automatically millimetres.
Joining and classification target flat XY geometry; ambiguous or unsupported
geometry may still need manual review. The output is not a guarantee of
manufacturing readiness.

## DXF Digestion

[dxf-digestion.py](dxf-digestion-blackbox/dxf-digestion.py) provides a blackbox
input/output interface to the DXF processing logic used in the benchmark,
covering edge joining, part separation, and layer organisation.

## Benchmark and Viewer

The [benchmark](benchmark/README.md) evaluates processing against expected part
and geometry counts. Its local frontend lets you browse source drawings and
processed results, inspect layers, and compare geometry.

See the [benchmark README](benchmark/README.md) for setup and usage, the
[processing rules](benchmark/Rules.md) for implementation details, and the
[viewer documentation](benchmark/render/README.md) for frontend controls and
limitations.
