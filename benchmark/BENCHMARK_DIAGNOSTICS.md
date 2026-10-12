# Benchmark diagnostics

## Package startup

Run the benchmark from the repository root so package imports resolve consistently:

```sh
python -m benchmark --help
```

This checks CLI startup without processing dataset files.

## Configurable classification layers

`separate_layers` now accepts names for the external geometry, internal
geometry and divider layers. The optional
`group_external_and_internal_geometry_layers` flag assigns contained
positive-area contours to the external geometry layer when enabled; dividers
remain on their configured layer. Focused in-memory checks passed for default
names and custom names with grouping enabled. The full benchmark was not run.