import math
import re

from ezdxf import edgesmith, path
from ezdxf.document import Drawing
from shapely.geometry import LineString, Polygon
from shapely import make_valid
from shapely.validation import explain_validity


def separate_layers(
    doc: Drawing,
    *,
    max_sagitta: float = 0.01,
    area_tol: float = 1e-9,
) -> Drawing:
    """
    Separate layers into logical grouping based on geometry: external geometry, internal geometries, internal dividers.
    1. Identify external geometry and move it to a dedicated layer.
    -> Outermost polyline of the part
    2. Identify internal geometries and move them to a dedicated layer.
    -> Polylines and circles fully contained within the boundary, with positive area.
    3. Identify internal dividers and move them to a dedicated layer.
    -> Lines and polylines fully contained within the outermost polyline, and with no area.
    4. Move TEXT and MTEXT to the text layer.
    5. Remove unused source layers, retaining the required layer 0.

    Processes one part's flat XY modelspace lines, polylines and circles in place and returns the
    same Drawing without file I/O. The largest valid closed contour is the
    external boundary. Lines, open polylines and closed contours with area <= area_tol
    are dividers. Containment permits touching, but not crossing, the boundary.
    Curves are approximated for classification using max_sagitta in drawing
    units; area_tol is in squared drawing units. DXF geometry is not changed.
    Invalid positive-area polygons are repaired for classification only when
    repair produces exactly one positive-area polygon; ambiguous repairs raise
    ValueError before layers are changed. Source geometry is not modified.
    Explicit etch/engraving layers retain their source layers and are not cuts or dividers.
    Other entities and uncontained contours retain their original layers.
    Layers referenced by other entities, blocks, or layouts are retained.
    If there is no positive-area closed contour, the drawing is unchanged.
    """
    if not math.isfinite(max_sagitta) or max_sagitta <= 0:
        raise ValueError("max_sagitta must be finite and positive")
    if not math.isfinite(area_tol) or area_tol < 0:
        raise ValueError("area_tol must be finite and non-negative")

    # Step 1: Approximate eligible contours and select the largest closed boundary.
    contours = []
    for entity in doc.modelspace().query("LINE LWPOLYLINE POLYLINE CIRCLE"):
        layer_tokens = re.split(r"[\W_]+", entity.dxf.layer.upper())
        if {"ETCH", "ETCHING", "ENGRAVE", "ENGRAVING"}.intersection(layer_tokens):
            continue
        if not edgesmith.is_pure_2d_entity(entity):
            continue
        vertices = [
            (vertex.x, vertex.y)
            for vertex in path.make_path(entity).flattening(max_sagitta)
        ]
        if len(vertices) < 2:
            continue
        if not all(math.isfinite(value) for vertex in vertices for value in vertex):
            raise ValueError(f"Non-finite coordinates in contour {entity.dxf.handle}")

        is_closed = entity.dxftype() == "CIRCLE" or getattr(
            entity, "closed", getattr(entity, "is_closed", False)
        )
        if is_closed and vertices[0] != vertices[-1]:
            vertices.append(vertices[0])

        geometry = LineString(vertices)
        contour_area = 0.0
        if is_closed and len(vertices) >= 4:
            polygon = Polygon(vertices)
            if polygon.area > area_tol:
                if not polygon.is_valid:
                    repaired = make_valid(polygon)
                    polygons = (
                        [repaired]
                        if isinstance(repaired, Polygon)
                        else [part for part in repaired.geoms if isinstance(part, Polygon)]
                    )
                    polygons = [part for part in polygons if part.area > area_tol]
                    if len(polygons) != 1:
                        raise ValueError(
                            f"Invalid polygon in contour {entity.dxf.handle} "
                            f"({entity.dxftype()} on layer {entity.dxf.layer!r}): "
                            f"{explain_validity(polygon)}; repair produced "
                            f"{len(polygons)} positive-area polygons"
                        )
                    polygon = polygons[0]
                geometry = polygon
                contour_area = polygon.area
        contours.append((entity, geometry, contour_area))

    boundaries = [contour for contour in contours if contour[2] > area_tol]
    if not boundaries:
        return doc
    external_entity, external_polygon, _ = max(boundaries, key=lambda contour: contour[2])
    organized_layers = {
        "0", "TEXT", "EXTERNAL_GEOMETRY", "INTERNAL_GEOMETRY", "INTERNAL_DIVIDERS"
    }
    for name in sorted(organized_layers):
        if name not in doc.layers:
            doc.layers.new(name)
    external_entity.dxf.layer = "EXTERNAL_GEOMETRY"

    # Step 2: Move contained positive-area contours, testing their entire geometry.
    for entity, geometry, contour_area in contours:
        if entity is external_entity or contour_area <= area_tol:
            continue
        if external_polygon.covers(geometry):
            entity.dxf.layer = "INTERNAL_GEOMETRY"

    # Step 3: Move contained open or zero-area contours to the divider layer.
    for entity, geometry, contour_area in contours:
        if contour_area <= area_tol and external_polygon.covers(geometry):
            entity.dxf.layer = "INTERNAL_DIVIDERS"

    # Step 4: Normalize the annotation layer regardless of its source name.
    for entity in doc.modelspace().query("TEXT MTEXT"):
        entity.dxf.layer = "TEXT"

    # Step 5: Remove unused layers without breaking block or layout references.
    used_layers = {
        entity.dxf.layer.casefold()
        for entity in doc.entitydb.values()
        if entity.is_alive and entity.dxf.hasattr("layer")
    }
    retained_layers = {name.casefold() for name in organized_layers} | used_layers
    for layer in list(doc.layers):
        if layer.dxf.name.casefold() not in retained_layers:
            doc.layers.remove(layer.dxf.name)
    if doc.header.get("$CLAYER", "0").casefold() not in retained_layers:
        doc.header["$CLAYER"] = "0"

    return doc


def count_internal_dividers(
    doc: Drawing,
    *,
    linear_tol: float = 1e-6,
    merge_gap_tol: float = 0.01,
) -> int:
    """Count connected straight dividers and regular dashed folds logically.

    Collinear fragments merge when they touch or are within merge_gap_tol.
    Repeated, evenly spaced dash patterns on the same supporting line count as
    one fold. Separated, irregular spans on that line count independently.
    Parallel offset lines and non-straight paths count separately. Tolerances
    are in drawing units.
    """
    if not math.isfinite(linear_tol) or linear_tol <= 0:
        raise ValueError("linear_tol must be finite and positive")
    if not math.isfinite(merge_gap_tol) or merge_gap_tol < 0:
        raise ValueError("merge_gap_tol must be finite and non-negative")

    straight_dividers: list[
        tuple[float, float, float, float, list[tuple[float, float]]]
    ] = []
    other_count = 0
    for entity in doc.modelspace().query(
        'LINE LWPOLYLINE POLYLINE CIRCLE[layer=="INTERNAL_DIVIDERS"]'
    ):
        vertices = [
            (vertex.x, vertex.y)
            for vertex in path.make_path(entity).flattening(0.01)
        ]
        if len(vertices) < 2:
            other_count += 1
            continue
        origin_x, origin_y = vertices[0]
        end_x, end_y = max(
            vertices,
            key=lambda vertex: math.hypot(vertex[0] - origin_x, vertex[1] - origin_y),
        )
        length = math.hypot(end_x - origin_x, end_y - origin_y)
        if length <= linear_tol:
            other_count += 1
            continue
        direction_x = (end_x - origin_x) / length
        direction_y = (end_y - origin_y) / length
        if any(
            abs(direction_x * (vertex_y - origin_y) - direction_y * (vertex_x - origin_x))
            > linear_tol
            for vertex_x, vertex_y in vertices
        ):
            other_count += 1
            continue
        matching_group = next(
            (
                group
                for group in straight_dividers
                if abs(direction_x * group[3] - direction_y * group[2]) <= 1e-9
                and all(
                    abs(group[2] * (vertex_y - group[1]) - group[3] * (vertex_x - group[0]))
                    <= linear_tol
                    for vertex_x, vertex_y in vertices
                )
            ),
            None,
        )
        if matching_group is None:
            projections = [
                direction_x * (vertex_x - origin_x)
                + direction_y * (vertex_y - origin_y)
                for vertex_x, vertex_y in vertices
            ]
            straight_dividers.append((
                origin_x,
                origin_y,
                direction_x,
                direction_y,
                [(min(projections), max(projections))],
            ))
        else:
            anchor_x, anchor_y, carrier_x, carrier_y, intervals = matching_group
            projections = [
                carrier_x * (vertex_x - anchor_x)
                + carrier_y * (vertex_y - anchor_y)
                for vertex_x, vertex_y in vertices
            ]
            intervals.append((min(projections), max(projections)))

    logical_count = 0
    for _, _, _, _, intervals in straight_dividers:
        merged_intervals: list[tuple[float, float]] = []
        for interval_start, interval_end in sorted(intervals):
            if (
                merged_intervals
                and interval_start - merged_intervals[-1][1] <= merge_gap_tol
            ):
                previous_start, previous_end = merged_intervals[-1]
                merged_intervals[-1] = (
                    previous_start,
                    max(previous_end, interval_end),
                )
            else:
                merged_intervals.append((interval_start, interval_end))

        if len(merged_intervals) >= 3:
            lengths = [end - start for start, end in merged_intervals]
            gaps = [
                next_start - end
                for (_, end), (next_start, _) in zip(
                    merged_intervals, merged_intervals[1:]
                )
            ]
            mean_length = sum(lengths) / len(lengths)
            mean_gap = sum(gaps) / len(gaps)
            is_regular_dash_pattern = (
                max(lengths) - min(lengths) <= max(mean_length * 0.1, linear_tol)
                and max(gaps) - min(gaps) <= max(mean_gap * 0.1, linear_tol)
            )
        else:
            is_regular_dash_pattern = False

        logical_count += 1 if is_regular_dash_pattern else len(merged_intervals)

    return logical_count + other_count
