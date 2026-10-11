import math
import re

from ezdxf import edgesmith, path
from ezdxf.document import Drawing
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely import make_valid
from shapely.validation import explain_validity

from dxf_editing_functions.join_edges import STYLE_ATTRIBUTES


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
    are dividers. LINE divider containment allows a 1e-6 drawing-unit margin;
    explicit BEND axes allow max_sagitta. BEND_EXTENT paths are removed from
    the supported contour types; other contours require strict coverage.
    Upright zero-thickness BEND LINEs with finite endpoint Z within 1e-6 are
    normalized to Z=0 before eligibility checks, without changing XY coordinates.
    Curves are approximated for classification using max_sagitta in drawing
    units; area_tol is in squared drawing units. Classified parallel LINE dividers
    with matching styles collapse within 10% of the shorter span's length,
    except explicit BEND axes, which remain independent.
    Odd groups retain their middle line; even groups center the middle pair.
    Invalid positive-area polygons are repaired for classification only using
    their positive-area polygonal components. Repairs without polygonal area
    raise ValueError before layers are changed. Polygon repairs do not modify source geometry.
    Explicit etch/engraving layers retain their source layers and are not cuts or dividers.
    Other entities and uncontained contours retain their original layers.
    Layers referenced by other entities, blocks, or layouts are retained.
    If there is no positive-area closed contour, no classification occurs;
    supported BEND_EXTENT paths are still removed.
    """
    if not math.isfinite(max_sagitta) or max_sagitta <= 0:
        raise ValueError("max_sagitta must be finite and positive")
    if not math.isfinite(area_tol) or area_tol < 0:
        raise ValueError("area_tol must be finite and non-negative")

    # Step 1: Approximate eligible contours and select the largest closed boundary.
    contours = []
    bend_handles = set()
    for entity in doc.modelspace().query("LINE LWPOLYLINE POLYLINE CIRCLE"):
        if entity.dxf.layer.upper() == "BEND_EXTENT":
            doc.modelspace().delete_entity(entity)
            continue
        if entity.dxf.layer.upper() == "BEND":
            bend_handles.add(entity.dxf.handle)
            if (entity.dxftype() == "LINE"
                and entity.dxf.get("extrusion", (0, 0, 1)) == (0, 0, 1)
                and entity.dxf.get("thickness", 0) == 0
                and all(math.isfinite(vertex.z) and abs(vertex.z) <= 1e-6
                    for vertex in (entity.dxf.start, entity.dxf.end))):
                entity.dxf.start = (entity.dxf.start.x, entity.dxf.start.y, 0)
                entity.dxf.end = (entity.dxf.end.x, entity.dxf.end.y, 0)
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
                    if not polygons:
                        raise ValueError(
                            f"Invalid polygon in contour {entity.dxf.handle} "
                            f"({entity.dxftype()} on layer {entity.dxf.layer!r}): "
                            f"{explain_validity(polygon)}; repair produced "
                            "no positive-area polygons"
                        )
                    polygon = unary_union(polygons)
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

    # Step 2: Classify contained contours by area, testing their entire geometry.
    divider_boundary = external_polygon.buffer(1e-6)
    bend_boundary = external_polygon.buffer(max_sagitta)
    for entity, geometry, contour_area in contours:
        boundary = divider_boundary if entity.dxftype() == "LINE" else external_polygon
        if entity.dxf.handle in bend_handles:
            boundary = bend_boundary
        if entity is external_entity or not boundary.covers(geometry):
            continue
        entity.dxf.layer = (
            "INTERNAL_GEOMETRY" if contour_area > area_tol else "INTERNAL_DIVIDERS"
        )

    divider_groups = []
    for entity, geometry, _ in contours:
        if (entity.dxftype() != "LINE" or entity.dxf.layer != "INTERNAL_DIVIDERS"
            or entity.dxf.handle in bend_handles
            or not geometry.length or not divider_boundary.covers(geometry)):
            continue
        direction = (entity.dxf.end - entity.dxf.start).normalize()
        style = tuple(entity.dxf.get(name) for name in STYLE_ATTRIBUTES)
        group = next((group for group in divider_groups if all(
            style == other_style and abs(direction.cross(other_direction).z) <= 1e-9
            and geometry.hausdorff_distance(other_geometry) <= 0.1 * min(geometry.length, other_geometry.length)
            for _, other_geometry, other_direction, other_style in group
        )), None)
        if group is None:
            group = []
            divider_groups.append(group)
        group.append((entity, geometry, direction, style))
    for group in divider_groups:
        direction = group[0][2]
        group.sort(key=lambda item: -direction.y * item[0].dxf.start.x + direction.x * item[0].dxf.start.y)
        retained = group[len(group) // 2][0]
        if len(group) % 2 == 0:
            if not divider_boundary.covers(unary_union([item[1] for item in group]).convex_hull):
                continue
            other = group[len(group) // 2 - 1][0]
            start, end = other.dxf.start, other.dxf.end
            if (retained.dxf.end - retained.dxf.start).dot(end - start) < 0:
                start, end = end, start
            start, end = retained.dxf.start.lerp(start), retained.dxf.end.lerp(end)
            if not divider_boundary.covers(LineString([(start.x, start.y), (end.x, end.y)])):
                continue
            retained.dxf.start, retained.dxf.end = start, end
        for entity, _, _, _ in group:
            if entity is not retained:
                doc.modelspace().delete_entity(entity)

    # Step 3: Normalize the annotation layer regardless of its source name.
    for entity in doc.modelspace().query("TEXT MTEXT"):
        entity.dxf.layer = "TEXT"

    # Step 4: Remove unused layers without breaking block or layout references.
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
