import math

from ezdxf import edgesmith, path
from ezdxf.document import Drawing
from ezdxf.entities import Insert, Polyline, Viewport
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely import make_valid
from shapely.validation import explain_validity

from .join_edges import STYLE_ATTRIBUTES
from .layer_policy import ANNOTATION_TYPES, is_etch_layer

DIVIDER_AXIS_TOL = 1e-6
DIVIDER_GAP_MIN_RATIO = 0.1
DIVIDER_GAP_MAX_RATIO = 0.5


def _finalize_layers(
    doc: Drawing, organized_layers: set[str], classified_handles: set[str]
) -> Drawing:
    for name in sorted(organized_layers):
        if name not in doc.layers:
            doc.layers.new(name)
    for entity in doc.entitydb.values():
        if not entity.is_alive or not entity.dxf.hasattr("layer"):
            continue
        if entity.dxf.layer.casefold() in {"ignore", "text"}:
            entity.dxf.layer = "IGNORE"
        elif is_etch_layer(entity.dxf.layer):
            entity.dxf.layer = "ETCH"
        elif entity.dxftype() in ANNOTATION_TYPES:
            entity.dxf.layer = "IGNORE"
        elif entity.dxf.handle not in classified_handles:
            entity.dxf.layer = "0"

    for entity in doc.entitydb.values():
        if not entity.is_alive:
            continue
        if isinstance(entity, Polyline):
            for child in entity.all_sub_entities():
                child.dxf.layer = entity.dxf.layer
        elif isinstance(entity, Insert) and entity.dxf.layer in {"ETCH", "IGNORE"}:
            for child in entity.all_sub_entities():
                child.dxf.layer = entity.dxf.layer

    retained_layers = {name.casefold() for name in organized_layers}
    for entity in doc.entitydb.values():
        if entity.is_alive and isinstance(entity, Viewport):
            entity.frozen_layers = [
                name for name in entity.frozen_layers if name.casefold() in retained_layers
            ]
    for layer in list(doc.layers):
        if layer.dxf.name.casefold() not in retained_layers:
            doc.layers.remove(layer.dxf.name)
    if doc.header.get("$CLAYER", "0").casefold() not in retained_layers:
        doc.header["$CLAYER"] = "0"
    return doc


def separate_layers(
    doc: Drawing,
    *,
    max_sagitta: float = 0.01,
    area_tol: float = 1e-9,
    external_geometry_layer: str = "EXTERNAL_GEOMETRY",
    internal_geometry_layer: str = "INTERNAL_GEOMETRY",
    internal_dividers_layer: str = "INTERNAL_DIVIDERS",
    group_external_and_internal_geometry_layers: bool = False,
) -> Drawing:
    """
    Separate layers into logical grouping based on geometry: external geometry, internal geometries, internal dividers.
    1. Identify external geometry and move it to a dedicated layer.
    -> Outermost polyline of the part
    2. Identify internal geometries and move them to a dedicated layer.
    -> Polylines and circles fully contained within the boundary, with positive area.
    3. Identify internal dividers and move them to a dedicated layer.
    -> Lines and polylines fully contained within the outermost polyline, and with no area.
    4. Move TEXT and MTEXT to IGNORE, except ETCH annotations.
    5. Route unclassified content to 0 and remove non-output layers.

    Layer names are configurable and default to EXTERNAL_GEOMETRY,
    INTERNAL_GEOMETRY and INTERNAL_DIVIDERS. When
    group_external_and_internal_geometry_layers is True, both the external
    contour and contained positive-area contours use external_geometry_layer;
    dividers continue to use internal_dividers_layer.
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
    except explicit BEND axes, which remain independent. Same-axis divider
    segments with matching styles join when their positive gap is 10%-50% of
    the shorter segment length and the joined line stays inside the exterior.
    Odd groups retain their middle line; even groups center the middle pair.
    Invalid positive-area polygons are repaired for classification only using
    their positive-area polygonal components. Repairs without polygonal area
    raise ValueError before layers are changed. Polygon repairs do not modify source geometry.
    Entities whose source layer contains "etch" or "engrav"
    (case-insensitive) move to ETCH and are not cuts or dividers.
    Layer normalization includes blocks, attached entities, and layouts.
    An ETCH placeholder layer is created if absent and retained even when empty.
    IGNORE entities retain their layer and are excluded from classification.
    Source TEXT layers and non-manufacturing annotations use IGNORE unless
    routed to ETCH. Unclassified geometry and other unknown content use layer 0.
    Only 0, IGNORE, ETCH, and the configured manufacturing layers remain.
    If there is no positive-area closed contour, no classification occurs;
    supported BEND_EXTENT paths are still removed and annotation layers normalized.
    """
    if not math.isfinite(max_sagitta) or max_sagitta <= 0:
        raise ValueError("max_sagitta must be finite and positive")
    if not math.isfinite(area_tol) or area_tol < 0:
        raise ValueError("area_tol must be finite and non-negative")

    # Step 1: Approximate eligible contours and select the largest closed boundary.
    contours = []
    bend_handles = set()
    for entity in doc.modelspace().query("LINE LWPOLYLINE POLYLINE CIRCLE"):
        if entity.dxf.layer.casefold() in {"ignore", "text"}:
            continue
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
        if is_etch_layer(entity.dxf.layer):
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
    organized_layers = {
        "0", "IGNORE", "ETCH", external_geometry_layer, internal_geometry_layer,
        internal_dividers_layer,
    }
    if not boundaries:
        return _finalize_layers(doc, organized_layers, set())
    external_entity, external_polygon, _ = max(boundaries, key=lambda contour: contour[2])
    for name in sorted(organized_layers):
        if name not in doc.layers:
            doc.layers.new(name)
    external_entity.dxf.layer = external_geometry_layer
    classified_handles = {external_entity.dxf.handle}
    contained_geometry_layer = (
        external_geometry_layer
        if group_external_and_internal_geometry_layers
        else internal_geometry_layer
    )

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
            contained_geometry_layer if contour_area > area_tol else internal_dividers_layer
        )
        classified_handles.add(entity.dxf.handle)

    divider_groups = []
    for entity, geometry, _ in contours:
        if (entity.dxftype() != "LINE" or entity.dxf.layer != internal_dividers_layer
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

    axis_groups = []
    for entity, geometry, _ in contours:
        if (
            not entity.is_alive
            or entity.dxftype() != "LINE"
            or entity.dxf.layer != "INTERNAL_DIVIDERS"
            or not geometry.length
        ):
            continue
        start, end = entity.dxf.start, entity.dxf.end
        direction = (end - start).normalize()
        if direction.x < 0 or (abs(direction.x) <= 1e-12 and direction.y < 0):
            direction = -direction
        style = tuple(entity.dxf.get(name) for name in STYLE_ATTRIBUTES)
        axis_group = next((group for group in axis_groups if (
            style == group[0][3]
            and abs(direction.cross(group[0][2]).z) <= 1e-9
            and all(
                abs((point - group[0][0].dxf.start).cross(group[0][2]).z)
                <= DIVIDER_AXIS_TOL
                for point in (start, end)
            )
        )), None)
        if axis_group is None:
            axis_group = []
            axis_groups.append(axis_group)
        axis_group.append((entity, geometry, direction, style))

    internal_geometry = [
        geometry
        for entity, geometry, contour_area in contours
        if entity.is_alive
        and entity.dxf.layer == "INTERNAL_GEOMETRY"
        and contour_area > area_tol
    ]
    for axis_group in axis_groups:
        axis_direction = axis_group[0][2]
        axis_origin = axis_group[0][0].dxf.start
        segments = []
        for item in axis_group:
            entity = item[0]
            endpoints = (entity.dxf.start, entity.dxf.end)
            projections = [
                (point.x - axis_origin.x) * axis_direction.x
                + (point.y - axis_origin.y) * axis_direction.y
                for point in endpoints
            ]
            if projections[0] <= projections[1]:
                low_point, high_point = endpoints
                low, high = projections
            else:
                low_point, high_point = endpoints[1], endpoints[0]
                low, high = projections[1], projections[0]
            segments.append((low, high, low_point, high_point, item))
        segments.sort(key=lambda segment: segment[0])

        component = []
        component_end = 0.0
        previous_length = 0.0

        def join_component() -> None:
            if len(component) < 2:
                return
            joined_start = component[0][2]
            joined_end = component[-1][3]
            joined_geometry = LineString([
                (joined_start.x, joined_start.y),
                (joined_end.x, joined_end.y),
            ])
            if (
                not divider_boundary.covers(joined_geometry)
                or any(joined_geometry.intersects(obstacle) for obstacle in internal_geometry)
            ):
                return
            retained = component[0][4][0]
            retained.dxf.start = joined_start
            retained.dxf.end = joined_end
            for segment in component[1:]:
                doc.modelspace().delete_entity(segment[4][0])

        for segment in segments:
            low, high, _, _, item = segment
            segment_length = item[1].length
            if not component:
                component = [segment]
                component_end = high
                previous_length = segment_length
                continue
            gap = low - component_end
            gap_ratio = gap / min(previous_length, segment_length)
            if DIVIDER_GAP_MIN_RATIO <= gap_ratio <= DIVIDER_GAP_MAX_RATIO:
                component.append(segment)
                component_end = max(component_end, high)
                previous_length = segment_length
                continue
            join_component()
            component = [segment]
            component_end = high
            previous_length = segment_length
        join_component()

    return _finalize_layers(doc, organized_layers, classified_handles)
