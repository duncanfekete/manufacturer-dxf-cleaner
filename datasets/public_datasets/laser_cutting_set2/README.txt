# Basic sheet-metal operations DXF dataset — collection 2

This second collection contains public DXFs from three open-hardware projects. It is separate from the first dataset. Files are unmodified source downloads; filenames are prefixed by repository owner to avoid collisions. The manifest records original paths, URLs, observed layer names, hashes, and operation notes.

## Contents

- 12 production DXFs from OpenAMRobot mobile-base hardware: chassis panels, cover, base, and simple wheel/motor/center/support brackets.
- 3 files from an ESP32 camera-slider project: tilt-bracket flat pattern, tripod mount plate, and slider plate. The slider plate is described upstream as machined aluminum, so treat it as cut-only geometry.
- 1 laser-cut-and-bent Z-bracket flat pattern.

## Operation interpretation

The collection is useful for cut-profile and hole recognition, plus basic flat-pattern/bracket geometry. Only the camera-slider tilt bracket and Z-bracket are explicitly described by their sources as fold/bend parts. Do not infer etch from text or line colors; assign operations only after reviewing the source layer mapping and intended manufacturing process. DXF layer names are listed in `manifest.csv` as observed from entity records and may not fully capture layer-table metadata.

Expected-result JSON files with `needs_review: true` are intentionally incomplete and must be reviewed before using this collection for pass/fail benchmarking. Their `review_reason` identifies the unresolved geometry or operation mapping. Only files without that flag currently contain reviewed expected counts.

## Source and license notes

- OpenAMRobot mobile-base CAD: CERN-OHL-P-2.0 (license text included under `licenses/`).
- ESP32 3-axis camera slider: CERN-OHL-S-2.0 (license text included under `licenses/`).
- Rigid Z bracket: CERN-OHL-P-2.0 (license text included under `licenses/`).

Retain the applicable source license and attribution when redistributing or modifying files. This is a research collection, not a production-ready package; validate dimensions, units, closed contours, bend allowances, materials, and layer-to-operation mapping before manufacture.
