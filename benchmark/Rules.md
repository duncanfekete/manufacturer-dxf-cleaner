# DXF processing rules

Reconstruction guide for the current implementation, verified against source
on 2026-10-11. Unless explicitly marked proposed, the rules below are implemented.
Case-specific investigation and the latest benchmark status belong in
[BENCHMARK_DIAGNOSTICS.md](BENCHMARK_DIAGNOSTICS.md).

## 1. Pipeline and ownership

1. Preserve a byte-for-byte source copy as `original_file.dxf`.
2. Clean and join modelspace edges; save `edge_joined.dxf`.
3. Separate manufacturing parts; save `part_N.dxf` with all details on `IGNORE`.
   Return the current output paths. Do not delete previous outputs or perform
   output-directory housekeeping inside the editing functions.
4. Classify each part's layers; save `part_N_organized.dxf`.
5. Reload each organized file and measure its saved entities.

Geometry functions operate on Drawing objects without file I/O. Joining and
classification mutate the supplied drawing; grouping copies entities and
dependent resources into new drawings without modifying its input.
The orchestration layer owns loading, recovery, saving and stage-specific errors.

Implementation: [process_dxf.py](process_dxf.py).
Run the benchmark from the repository root with `python -m benchmark`.

## 2. Units, tolerances and dimensionality

| Setting | Default | Meaning |
| --- | ---: | --- |
| Join gap tolerance | 0.01 | Maximum endpoint gap, in drawing units |
| Join/classification curve sagitta | 0.01 | Curve approximation tolerance, in drawing units |
| Group gap tolerance | 0.01 | Maximum 3D distance between entity bounding boxes |
| Classification area tolerance | 1e-9 | Positive-area threshold, in squared drawing units |
| Parallel divider proximity | 0.1 | Maximum full-span Hausdorff distance divided by the shorter line length |
| Parallel divider angular tolerance | 1e-9 | Maximum absolute XY cross product of unit directions |
| LINE divider containment margin | 1e-6 | Drawing-unit boundary buffer for LINE classification and centered replacements only |
| Explicit BEND containment margin | 0.01 | Uses classification max_sagitta; no endpoint movement or relaxation of planarity |
| Explicit BEND LINE Z bound | 1e-6 | Normalize both endpoint Z values to zero only within this finite drawing-unit bound, with upright extrusion and zero thickness |
| Sheet frame area fraction | 0.8 | Candidate frame area divided by drawing XY bounding-box area |
| Sheet edge band fraction | 0.1 | Band width divided by outer frame diagonal |

Join tolerances must be finite and positive. Group gap and classification area
tolerances must be finite and nonnegative. These are drawing-unit values, not
automatically converted millimetres. Group copies preserve DXF version and units.

Joining and classification accept only entities passing ezdxf's pure-2D test:
WCS XY geometry, zero thickness and supported extrusion. Before joining, supported
modelspace curves and polylines with extrusion exactly (0, 0, -1) are made upright
without changing WCS geometry. Classification additionally normalizes near-zero
Z on explicit BEND LINEs only: both finite endpoint Z values must be within
1e-6, extrusion must be exactly (0, 0, 1), and thickness must be zero. XY
coordinates are unchanged. Other near-zero Z and tilted extrusion are not normalized.
Grouping uses 3D bounds; sheet detection projects supported paths into XY and
is a heuristic for flat sheets.

## 3. Cleanup and joining

Before collecting edges, make supported ARC, CIRCLE, ELLIPSE, LWPOLYLINE and
POLYLINE entities with exactly inverted Z extrusion upright using ezdxf. This
normalization also applies to closed and isolated entities; the subsequent
pure-2D check still excludes nonzero Z and thickness.
Inline checks verified inverted-arc joining and WCS path coverage in R12 and
modern DXFs, including save/reload, while tilted, elevated and thick arcs
remained unjoined. After that fix, the full private suite remained at 82/86 with no processing
exceptions; current per-drawing results are in the benchmark diagnostics.

1. Delete modelspace LINE entities whose start and end coordinates are exactly
   equal. Do not use the join gap tolerance as a minimum line length. Short
   nonzero lines remain intact; this cleanup does not cover other entity types.
2. Collect eligible open pure-2D edges, grouped by matching display attributes:
   layer, color, linetype, lineweight, ltscale, true_color, transparency and invisible.
3. Use ezdxf's spatial edge deposit to find simple connected chains. Do not join
   across display styles. Closed shapes, isolated edges and unsupported/non-XY
   entities are not joined. Inverted-extrusion normalization and zero-length
   LINE cleanup are the exceptions to leaving unjoined entities unchanged.
4. Bridge endpoint gaps within the gap tolerance using straight segments rather
   than moving source endpoints. This joining rule is not boundary-aware.
5. At branch junctions, merge two open multi-edge chains into a loop only if
   each uniquely matches the other at both endpoints, allowing either direction.
   Leave ambiguous matches and independent branch edges alone.
6. Build each multi-edge replacement once. Delegate reversal and arc bulges to
   ezdxf; approximate splines and non-circular ellipses using the sagitta setting.
7. Remove only the source entities used by the replacement chain. Retain display
   attributes, but do not promise preservation of source handles or entity-specific
   metadata on replacements.

**R12 catch:** drawings older than DXF2000 cannot save LWPOLYLINE reliably. Write
classic 2D POLYLINE with XY coordinates, widths, bulges and closure instead.
Newer drawings use LWPOLYLINE. Classification recognizes both closure APIs.
The R12 `$INSUNITS` export warning is a format limitation, not a benchmark failure.

Implementation: [dxf_editing_functions/join_edges.py](dxf_editing_functions/join_edges.py).

## 4. Bounded sheet-detail extraction

Apply this before ordinary part grouping. Do not classify everything near the
drawing extents as details without sheet-frame evidence.
Detect etch/engraving intent first and exclude those entities from sheet paths
and drawing bounds so etch content cannot become a sheet frame.

1. Construct flattened XY paths for supported curve entities. For annotations,
   block references and other bounded entities, use their XY bounding rectangles.
2. Identify valid positive-area closed contours that occupy at least 80% of the
   overall drawing XY bounding-box area and approximately match their axis-aligned
   rectangles. The allowed symmetric-difference area is
   `max(group_gap_tol * contour_perimeter, 1e-9)`.
3. Require at least two candidate frames and a smaller candidate contained by the
   largest frame. Otherwise leave sheet extraction disabled.
4. Set a fixed band width to 10% of the largest frame's diagonal. Inset that
   frame by the width with mitred corners to obtain the interior core.
5. Require a non-frame closed contour wholly inside the core. Protect all such
   contours and every entity whose geometry they cover. If none exist, disable
   extraction rather than guess.
6. Seed details with candidate frame entities. Recursively include unprotected
   entities within one band width of a selected detail, but only if their entire
   geometry remains inside the fixed edge band, buffered by the group gap tolerance.
   Compare frame paths, not their filled polygon areas, when clustering.
7. Exclude selected details from part grouping and copy them onto `IGNORE` in
   every part, including dependencies such as title-table block contents.

This is conservative, not universal drawing-sheet recognition. Single-frame
sheets and parts crossing the band may not be extracted. Nested rectangular
manufactured contours can resemble frames. Large detached annotations can also
change the drawing bounds used to recognize frames.

## 5. Parts, annotations and unsupported bounds

1. First extract modelspace entities whose layer contains etch or engrav
   (case-insensitive). Exclude them from sheet detection and geometry grouping.
   After grouping, assign each to a part only when its bounds overlap or lie
   within gap_tol of exactly one part's combined bounds. Copy owned etch content
   onto ETCH in that part, with independent block resources and attributes.
   Warn for unassigned or ambiguous etch content and put it on shared IGNORE.
   Etch-only inputs produce no parts; warn that their content remains in the source.
   Filter other TEXT/MTEXT, attributes, dimensions, leaders, hatches, images,
   and wipeouts into shared details. They cannot connect manufacturing parts.
   Also filter any modelspace entity whose source layer is exactly TEXT or IGNORE,
   case-insensitively, including outlined lettering geometry.
   Text inside block references is not independently
   filtered; INSERT references remain whole entities.
2. Require finite, computable bounds for each entity. Raise on unsupported or
   non-finite bounds rather than silently omit geometry.
3. **OLE2FRAME exception:** warn and exclude an unbounded OLE frame from grouping.
   Keep it only in the untouched original copy; do not promise it in details or parts.
4. After sheet extraction, group remaining entities by overlapping boxes or box
   distance within the group tolerance. Ignore layer names; connectivity is transitive.
   Treat INSERT references as whole entities, not independently grouped block children.
   Then absorb any group whose entire 3D bounds are enclosed by another group's
   combined bounds; repeat until no such groups remain. Keep the 0.01 proximity
   tolerance unchanged. This lets segmented enclosures retain detached contents.
   Combined bounds are not a closed exterior polygon: concave or open components
   can enclose unrelated objects in their bounding rectangle. Nested independent
   manufactured parts can also be absorbed; this heuristic does not infer intent.
5. Copy all filtered text and sheet-selected entities with dependencies onto
   IGNORE in every part, at their original coordinates. Detail block contents and
   attached attributes also use IGNORE; conflicting block names are renamed so
   manufacturing block layers remain unchanged. Preserve annotations in the
   input drawing and original copy rather than deleting them. Owned etch
   content is not included in these shared details.
6. Copy each group's entities and dependent resources into a same-version drawing.
   Return only the part drawings. No remaining geometry means an empty list and
   no part files or separate details file. Existing outputs are not deleted.

Implementation for sections 4-5:
[dxf_editing_functions/group_parts.py](dxf_editing_functions/group_parts.py).

## 6. Layer classification

1. Examine pure-2D LINE, LWPOLYLINE, POLYLINE and CIRCLE modelspace entities.
   First delete entities of these types whose source layer is exactly
   BEND_EXTENT, case-insensitively: these are auxiliary extent paths, not fold
   axes or cutouts. This cleanup also occurs when no eligible exterior exists.
   Capture exact BEND source-layer handles before reclassification.
   For source BEND LINEs only, set both endpoint Z values to zero when both
   are finite and within 1e-6, extrusion is exactly (0, 0, 1), and thickness is
   zero. Preserve handles and XY coordinates; still require the pure-2D test.
   Skip IGNORE, TEXT, and layers containing etch or engrav (case-insensitive).
   Do not classify unsupported entities merely because their bounds fit the part.
2. Flatten eligible paths for classification only. Require finite XY coordinates.
   Recognize circles and the appropriate lightweight/classic polyline closure flag.
3. Positive-area closed contours become polygon candidates. For invalid polygons,
   use Shapely make_valid, retain direct positive-area Polygon components above the
   area tolerance, and union them for classification. Multiple regions are allowed;
   the source DXF contour remains one entity. Raise if repair has no qualifying polygon.
4. Select the largest positive-area candidate as `external_geometry_layer`
   (default `EXTERNAL_GEOMETRY`). If no candidate exists, return without
   classification; extent cleanup and final layer routing still apply.
   This is not currently an exception.
5. Test each other contour's entire geometry against the exterior using covers:
   touching is permitted. LINE dividers use a 1e-6 drawing-unit boundary buffer
   to tolerate endpoint noise. Explicit source BEND entities instead use the
   classification max_sagitta margin (0.01 by default); other contours use
   strict coverage. This containment margin does not relax the separate
   bounded BEND LINE Z policy or flatten arbitrary 3D geometry. Contained positive-area contours
   become `internal_geometry_layer` (default `INTERNAL_GEOMETRY`); when
   `group_external_and_internal_geometry_layers` is true, they instead use
   `external_geometry_layer`. Contained open/zero-area contours become
   `internal_dividers_layer` (default `INTERNAL_DIVIDERS`). Uncontained and
   ineligible geometry goes to 0 during finalization. Do not force rejected BEND
   geometry onto a manufacturing layer merely to hide its name.
6. Collapse only nonzero pure-2D LINE entities classified as
   `internal_dividers_layer`.
   Exempt explicit source BEND axes: nearby independently labeled folds must
   remain separate, regardless of line length or proximity.
   Match display attributes and parallel directions, allowing reversed endpoints.
   Each candidate must match every existing group member within 10% of the
   shorter line's length by full-span Hausdorff distance. Do not join merely
   because endpoints are close. Sort across the spans: odd groups retain the
   existing middle line unchanged. Even groups center the middle pair's
   corresponding endpoints; require their convex hull and the centered line
   to fit within the buffered exterior, preventing bridging exterior notches.
   Do not require an odd group's hull to fit: its retained line is already
   contained and no new span is created. Delete other members from processed
   output; do not change cutouts,
   unclassified lines, etching, or polyline dividers. Original copies remain intact.
7. Finalize layers throughout the document, including blocks, attributes,
   classic polyline vertices, and layouts. Explicit IGNORE/TEXT references use
   IGNORE; otherwise layer names containing etch or engrav use ETCH.
   Non-manufacturing annotations use IGNORE unless routed to ETCH. Preserve the
   layers of successfully classified manufacturing entities; put everything
   unclassified on 0. Polyline subentities follow their parent, as do attributes
   of ETCH/IGNORE block references. This also occurs without an eligible boundary.
8. Keep only 0, ETCH, IGNORE, and the configured manufacturing layers, creating
   placeholders even when empty. Remove all other source layers after routing
   their entities. Clear removed layers from viewport frozen-layer lists, and
   reset the active layer to 0 if its layer was removed. Serialized DXFs contain
   only this set; ezdxf recreates an empty Defpoints layer when reading.

Polygon repair remains analysis-only, not a replacement manufacturing contour.
Parallel divider collapse explicitly changes saved LINE geometry after classification.

Implementation:
[dxf_editing_functions/seperate_into_layers.py](dxf_editing_functions/seperate_into_layers.py).

## 7. Structural recovery and failure reporting

1. Try normal DXF loading first. On DXFStructureError, try ezdxf recovery.
2. If recovery also fails structurally, permit a narrow missing-subclass repair
   for LWPOLYLINE tags only: known tag codes, exactly one vertex-count tag, and
   matching declared/actual X/Y coordinate counts are required.
3. Insert missing AcDbEntity/AcDbPolyline markers in memory while preserving
   coordinate tags. Reject unknown structures rather than speculate.
4. Reject unresolved audit errors. Warn on successful recovery and disclose that
   general recovery may change geometry; keep the original file unchanged.
5. Wrap processing exceptions with stage, source path, exception type and message.
   Invalid polygon errors additionally identify handle, entity type, layer and reason.
   Count mismatches are distinct from processing exceptions.

## 8. Benchmark contract

1. Recursively discover case-insensitive DXF extensions under the requested root.
   Each input has an adjacent JSON sidecar with a `parts` list.
2. Reload the final organized file. Count LWPOLYLINE/POLYLINE/CIRCLE entities on
   INTERNAL_GEOMETRY and LINE/LWPOLYLINE/POLYLINE/CIRCLE on INTERNAL_DIVIDERS.
3. Each supported saved entity counts once. Separate dashes, remaining parallel
   spans and repaired classification regions are not logical count groups.
   The 10% parallel-divider rule changes saved processing geometry; counting
   does not apply additional merging or boundary-aware bridging.
4. Any simplification must change processing output, not simulate a different
   output during counting. Do not change expected sidecars to hide defects.
5. Compare part-count records without relying on part order; retain duplicates.
   Review-marked inputs and processing exceptions do not pass.
6. Print per-file details only for failures, followed by the overall pass total.
   Keep warnings visible. Keep this rules guide and the diagnostics current after
   changes, and distinguish focused checks from full-suite verification.

Implementation: [benchmark.py](benchmark.py) and [process_dxf.py](process_dxf.py).

## 9. Proposed rules, not implemented

- Recognize outlined lettering on other annotation layers or unlabeled exports.
   Current filtering recognizes TEXT/MTEXT entity types and the exact TEXT layer.
- Extend bounded Z normalization beyond explicit BEND LINEs only with additional
   evidence; tilted, thick and genuinely 3D geometry must remain protected.
- Consider larger containment allowances only with explicit geometric evidence;
   current margins are 1e-6 for generic LINEs and max_sagitta for explicit BEND.
- Require hints or a better export when lost layers and substantial gaps prevent
  safe reconstruction. Do not globally raise joining tolerance to force closure.

## 10. Reconstruction checks

- BKM2647647/48/49: saved counts 0/8, 5/5 and 5/5; preserve R12 outlines on reload.
- Q-000527 BD-00098/BD-00107: remove invisible zero-length lines; saved counts 5/1.
- Joining: reverse chain orientation safely, retain independent branch dividers,
  bridge tiny gaps, and leave ambiguous pairings/style mismatches unchanged.
- Containment: accept boundary-touching features and reject crossing paths.
- Polygon repair: allow multiple valid components without rewriting source contours.
- Mounting plate: one part with 5/0; 24 sheet detail entities including its table INSERT.
- Bare rectangle plus contained circle: one intact part, no sheet details.
- Cleanup: delete exactly zero-length LINEs but retain a tested nonzero length of 1e-12.
- Text filtering: inside/outside TEXT and MTEXT appear only in details; a text-only
   drawing produces no parts, and grouping leaves source annotations intact.
- TEXT-layer glyph filtering: Middle Flat produces one part rather than 41;
   its 67 joined annotation entities are saved in details, not manufacturing parts.
- Parallel divider collapse: triplets keep their middle line, pairs are centered,
   and separated spans remain unchanged. Middle Flat now saves 4/8. BKM2647648/49
   retain 5/5 because their parallel-span regions leave the exterior.
   Verify positions, not just counts: all eight original Middle Flat BEND
   handles and endpoints survive save/reload, and all 16 side lines are deleted.
   Explicit labeled bends now bypass collapse; their extent paths are removed.
- Bottom Slide: 28/8 after extent removal and bounded BEND containment; all
  eight original bend handles and complete paths survive save/reload, including
  the long left spans. No BEND/BEND_EXTENT layers or modelspace entities remain
  in its organized output, or in Middle Flat's.

- Outter Left: 13/7 after bounded BEND LINE Z normalization; all seven original
   handles and XY endpoints survive save/reload with Z=0. BEND/BEND_EXTENT layers
   are absent. Inline guards reject Z above 1e-6, tilted extrusion and thickness.
- Outter Right grouping: 16 groups become two, with 163 main-component entities
   and 56 boxed-cluster entities. The two detached internal contours and 19 small
   glyph entities join the main component. Saved counts remain 23/0 and 52/0;
   grouping does not repair the open exterior or detect outlined lettering.
- Repeated splitting: return current part paths and preserve preexisting
   higher-numbered and unrelated files. Inline checks verified byte-for-byte
   preservation; output-directory cleanup is not part of editing logic.

Latest private-suite verification: 85/86 passing; Outter Right remains unresolved,
no processing exceptions, using temporary outputs and inline checks only.
This guide documents behavior, not certification for every manufacturer export.