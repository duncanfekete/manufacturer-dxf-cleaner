import math
import warnings
from typing import List

import ezdxf
from ezdxf import bbox, path, xref
from ezdxf.document import Drawing
from shapely.geometry import LineString, Polygon, box as geometry_box

from .layer_policy import ANNOTATION_TYPES, is_etch_layer


def _box_distance(first, second):
    return math.hypot(*(
        max(first_min - second_max, second_min - first_max, 0.0)
        for first_min, first_max, second_min, second_max in zip(
            first.extmin, first.extmax, second.extmin, second.extmax
        )
    ))


def _load_modelspace(
    source: Drawing, target: Drawing, *,
    filter_fn=None, conflict_policy=xref.ConflictPolicy.KEEP,
) -> None:
    # ezdxf's resource mapper writes mapped linetypes back onto source layers.
    linetypes = [(layer, layer.dxf.get("linetype")) for layer in source.layers]
    try:
        xref.load_modelspace(source, target, filter_fn=filter_fn, conflict_policy=conflict_policy)
    finally:
        for layer, linetype in linetypes:
            if linetype is None:
                layer.dxf.discard("linetype")
            else:
                layer.dxf.linetype = linetype


def _load_on_layer(source, target, handles, layer):
    if not handles:
        return
    existing_handles = set(target.entitydb)
    _load_modelspace(
        source, target,
        filter_fn=lambda entity: entity.dxf.handle in handles,
        conflict_policy=xref.ConflictPolicy.XREF_PREFIX,
    )
    if layer not in target.layers:
        target.layers.new(layer)
    for handle, entity in target.entitydb.items():
        if handle not in existing_handles and entity.is_alive and entity.dxf.hasattr("layer"):
            entity.dxf.layer = layer


def _sheet_detail_indices(entities, boxes, gap_tol):
    # Step 1: Find large nested rectangular contours near the drawing extents.
    shapes = {}
    contours = {}
    for index, entity in enumerate(entities):
        if boxes[index] is None:
            continue
        if entity.dxftype() in {"LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "ELLIPSE", "SPLINE"}:
            vertices = [(vertex.x, vertex.y) for vertex in path.make_path(entity).flattening(0.01)]
            if len(vertices) < 2:
                continue
            shapes[index] = LineString(vertices)
            closed = entity.dxftype() == "CIRCLE" or getattr(
                entity, "closed", getattr(entity, "is_closed", False)
            )
            if closed and len(vertices) >= 4:
                polygon = Polygon(vertices)
                if polygon.is_valid and polygon.area > 0:
                    contours[index] = polygon
        else:
            bounds = boxes[index]
            shapes[index] = geometry_box(
                bounds.extmin.x, bounds.extmin.y, bounds.extmax.x, bounds.extmax.y
            )
    if not contours:
        return set()
    drawing_bounds = geometry_box(
        min(bounds.extmin.x for bounds in boxes if bounds is not None),
        min(bounds.extmin.y for bounds in boxes if bounds is not None),
        max(bounds.extmax.x for bounds in boxes if bounds is not None),
        max(bounds.extmax.y for bounds in boxes if bounds is not None),
    )
    rectangles = {
        index: polygon for index, polygon in contours.items()
        if polygon.area >= drawing_bounds.area * 0.8
        and polygon.symmetric_difference(geometry_box(*polygon.bounds)).area
        <= max(gap_tol * polygon.length, 1e-9)
    }
    if len(rectangles) < 2:
        return set()
    frame = max(rectangles.values(), key=lambda polygon: polygon.area)
    if not any(frame.covers(polygon) and frame.area > polygon.area for polygon in rectangles.values()):
        return set()

    # Step 2: Protect interior part contours and everything they contain.
    min_x, min_y, max_x, max_y = frame.bounds
    band_width = math.hypot(max_x - min_x, max_y - min_y) * 0.1
    core = frame.buffer(-band_width, join_style="mitre")
    parts = [polygon for index, polygon in contours.items() if index not in rectangles and core.covers(polygon)]
    if not parts:
        return set()
    protected = {
        index for index, shape in shapes.items()
        if any(polygon.covers(shape) for polygon in parts)
    }

    # Step 3: Cluster edge details without allowing expansion outside the band.
    band = frame.difference(core).buffer(gap_tol)
    candidates = {
        index for index, shape in shapes.items()
        if index not in protected and band.covers(shape)
    }
    details = set(rectangles)
    pending = list(details)
    while pending:
        current = pending.pop()
        connected = {
            index for index in candidates - details
            if shapes[current].distance(shapes[index]) <= band_width
        }
        details.update(connected)
        pending.extend(connected)
    return details


def group_parts(
    doc: Drawing, *, gap_tol: float = 0.01
) -> List[Drawing]:
    """
    Using bounding box of items to group parts:
    1. Identify etch intent and annotations separately from geometry.
    2. Irrespectively of layers, create bounding boxes of all entities.
    3. Compare bounding boxes to determine which entities belong to the same part 
    -> If two bounding boxes overlap, or are within very close proximity, consider them part of the same group.
    4. Assign etch entities to a single part by bounding-box proximity.
    5. Create a Drawing per group, including a copy of all IGNORE details.
    6. Return the grouped Drawing components.

    Processes modelspace only, including block references as whole entities.
    Returns parts, preserving the source DXF version and units.
    Sheet extraction requires two nested rectangular contours, each covering
    at least 80% of the drawing bounds, and a closed part inside their edge
    band. The band is 10% of the outer frame diagonal. Part contours and their
    contents are protected; edge-detail clustering cannot leave the fixed band.
    Curves use flattened XY paths; annotations and block references use bounds.
    Etch/engraving layers are detected before annotations or sheet details and
    excluded from geometry grouping and sheet detection. Etch entities whose
    bounds overlap or lie within gap_tol of exactly one group's bounds are
    copied only to that part on ETCH. Unassigned or ambiguous etch entities
    emit a warning and become shared IGNORE details.
    Other annotations and entities on the case-insensitive TEXT or IGNORE layer
    are excluded from grouping and copied onto IGNORE in every part,
    at their original coordinates. Imported detail block contents
    and attached attributes also use IGNORE, without changing part blocks. Outlined
    lettering without that source layer is not automatically recognized.
    Proximity is the shortest 3D distance between boxes in drawing units.
    Group membership is transitive. Groups wholly enclosed by another group's
    combined 3D bounding box are then absorbed without increasing gap_tol.
    Bounding-box enclosure is a grouping heuristic, not proof of polygon
    containment or manufacturing intent. The source drawing is not modified and
    persistence is left to the caller. Entities without computable, finite
    bounds raise ValueError rather than being silently omitted, except OLE2FRAME
    objects, which have no spatial bounds and are excluded from part grouping.
    """
    if not math.isfinite(gap_tol) or gap_tol < 0:
        raise ValueError("gap_tol must be finite and non-negative")

    # Step 1: Preserve etch intent before extracting shared annotations.
    details = ezdxf.new(dxfversion=doc.dxfversion, units=doc.units)
    entities = list(doc.modelspace())
    etch_indices = {
        index for index, entity in enumerate(entities)
        if is_etch_layer(entity.dxf.layer)
    }
    text_indices = {
        index for index, entity in enumerate(entities)
        if index not in etch_indices and (
            entity.dxftype() in ANNOTATION_TYPES
            or entity.dxf.layer.casefold() in {"text", "ignore"}
        )
    }

    # Step 2: Compute one bounding box per entity, ignoring layers.
    cache = bbox.Cache()
    boxes = []
    non_spatial_indices = set()
    for index, entity in enumerate(entities):
        box = bbox.extents([entity], cache=cache)
        if not box.has_data or not all(
            math.isfinite(coordinate)
            for vertex in (box.extmin, box.extmax)
            for coordinate in vertex
        ):
            if entity.dxftype() == "OLE2FRAME":
                non_spatial_indices.add(index)
                warnings.warn(
                    f"Ignoring OLE2FRAME (handle {entity.dxf.handle}) during part grouping; "
                    "it has no spatial bounds and is retained only in the original DXF.",
                    RuntimeWarning,
                    stacklevel=2,
                )
                boxes.append(None)
                continue
            raise ValueError(
                f"Cannot compute bounds for {entity.dxftype()} "
                f"(handle {entity.dxf.handle})"
            )
        boxes.append(box)

    # Step 3: Extract bounded sheet-edge details before grouping parts.
    sheet_details = _sheet_detail_indices(
        entities,
        [None if index in etch_indices else bounds for index, bounds in enumerate(boxes)],
        gap_tol,
    )
    remaining = (
        set(range(len(entities))) - text_indices - etch_indices
        - non_spatial_indices - sheet_details
    )
    groups = []
    while remaining:
        start = min(remaining)
        remaining.remove(start)
        group = [start]
        pending = [start]
        while pending:
            current = boxes[pending.pop()]
            for candidate in sorted(remaining):
                other = boxes[candidate]
                if _box_distance(current, other) <= gap_tol:
                    remaining.remove(candidate)
                    group.append(candidate)
                    pending.append(candidate)
        groups.append(group)

    group_boxes = [bbox.extents([entities[index] for index in group], cache=cache) for group in groups]
    while True:
        enclosed = next(((outer, inner) for outer, bounds in enumerate(group_boxes)
            for inner, other in enumerate(group_boxes) if outer != inner
            and all(first_min <= second_min and second_max <= first_max
                for first_min, first_max, second_min, second_max in zip(
                    bounds.extmin, bounds.extmax, other.extmin, other.extmax))), None)
        if enclosed is None:
            break
        outer, inner = enclosed
        groups[outer].extend(groups[inner])
        groups.pop(inner)
        group_boxes.pop(inner)

    # Step 4: Assign etch content without allowing it to connect or create parts.
    part_etch_indices = [set() for _ in groups]
    ignored_etch_indices = set()
    for index in sorted(etch_indices - non_spatial_indices):
        owners = [
            owner for owner, bounds in enumerate(group_boxes)
            if _box_distance(boxes[index], bounds) <= gap_tol
        ]
        if len(owners) == 1:
            part_etch_indices[owners[0]].add(index)
        else:
            ignored_etch_indices.add(index)
            destination = (
                "retaining it as shared IGNORE content."
                if groups else "no part output exists; retained only in the source drawing."
            )
            warnings.warn(
                f"Etch entity {entities[index].dxftype()} (handle {entities[index].dxf.handle}) "
                f"matches {len(owners)} parts; {destination}",
                RuntimeWarning,
                stacklevel=2,
            )

    detail_handles = {
        entities[index].dxf.handle
        for index in sheet_details | text_indices | ignored_etch_indices
    }
    _load_modelspace(
        doc, details, filter_fn=lambda entity: entity.dxf.handle in detail_handles
    )

    # Step 5: Copy each group and its dependent resources into a new drawing.
    components = []
    for group, etch_group in zip(groups, part_etch_indices):
        component = ezdxf.new(dxfversion=doc.dxfversion, units=doc.units)
        handles = {entities[index].dxf.handle for index in group}
        _load_modelspace(
            doc, component, filter_fn=lambda entity: entity.dxf.handle in handles
        )
        _load_on_layer(
            doc, component,
            {entities[index].dxf.handle for index in etch_group}, "ETCH",
        )
        _load_on_layer(
            details, component,
            {entity.dxf.handle for entity in details.modelspace()}, "IGNORE",
        )
        components.append(component)

    # Step 6: No manufacturing geometry produces an empty parts list.
    return components
