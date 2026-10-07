import math
import re

from ezdxf import edgesmith, path
from ezdxf.document import Drawing
from shapely.geometry import LineString, Polygon


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
    Invalid positive-area polygons raise ValueError before layers are changed.
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

        geometry = LineString(vertices)
        contour_area = 0.0
        if len(vertices) >= 4 and vertices[0] == vertices[-1]:
            polygon = Polygon(vertices)
            if polygon.area > area_tol:
                if not polygon.is_valid:
                    raise ValueError(f"Invalid polygon in contour {entity.dxf.handle}")
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


def count_internal_dividers(doc: Drawing, *, linear_tol: float = 1e-6) -> int:
    """Count collinear straight divider segments as one fold, preserving DXF entities.

    Gaps along the same supporting line do not create additional dividers.
    Parallel offset lines and non-straight paths count separately. linear_tol
    is the allowed perpendicular deviation in drawing units.
    """
    if not math.isfinite(linear_tol) or linear_tol <= 0:
        raise ValueError("linear_tol must be finite and positive")

    straight_dividers: list[tuple[float, float, float, float]] = []
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
        if not any(
            abs(direction_x * carrier_y - direction_y * carrier_x) <= 1e-9
            and all(
                abs(carrier_x * (vertex_y - anchor_y) - carrier_y * (vertex_x - anchor_x))
                <= linear_tol
                for vertex_x, vertex_y in vertices
            )
            for anchor_x, anchor_y, carrier_x, carrier_y in straight_dividers
        ):
            straight_dividers.append((origin_x, origin_y, direction_x, direction_y))
    return len(straight_dividers) + other_count
