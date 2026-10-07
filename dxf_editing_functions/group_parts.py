import math
from typing import List

import ezdxf
from ezdxf import bbox, xref
from ezdxf.document import Drawing


def group_parts(
    doc: Drawing, *, gap_tol: float = 0.01
) -> tuple[List[Drawing], Drawing]:
    """
    Using bounding box of items to group parts:
    1. Identify modelspace TEXT and MTEXT separately from geometry.
    2. Irrespectively of layers, create bounding boxes of all entities.
    3. Compare bounding boxes to determine which entities belong to the same part 
    -> If two bounding boxes overlap, or are within very close proximity, consider them part of the same group.
    4. Assign contained or overlapping text to parts; detached text to details.
    5. Create a Drawing component per group of entities.
    6. Return the grouped Drawing components and the details drawing.

    Processes modelspace only, including block references as whole entities.
    Returns (parts, details), preserving the source DXF version and units.
    Text touching or overlapping a part's geometry bounding box is copied to
    that part. Text overlapping multiple parts is copied to each, without
    merging them. Text matching no part is copied to details. Text matching
    uses direct 3D box overlap, not gap_tol, and cannot expand a part's bounds.
    Proximity is the shortest 3D distance between boxes in drawing units.
    Group membership is transitive. The source drawing is not modified and
    persistence is left to the caller. Entities without computable, finite
    bounds raise ValueError rather than being silently omitted.
    """
    if not math.isfinite(gap_tol) or gap_tol < 0:
        raise ValueError("gap_tol must be finite and non-negative")

    # Step 1: Identify text separately so it cannot connect geometry groups.
    details = ezdxf.new(dxfversion=doc.dxfversion, units=doc.units)
    entities = list(doc.modelspace())
    text_indices = {
        index for index, entity in enumerate(entities)
        if entity.dxftype() in {"TEXT", "MTEXT"}
    }

    # Step 2: Compute one bounding box per entity, ignoring layers.
    cache = bbox.Cache()
    boxes = []
    for entity in entities:
        box = bbox.extents([entity], cache=cache)
        if not box.has_data or not all(
            math.isfinite(coordinate)
            for vertex in (box.extmin, box.extmax)
            for coordinate in vertex
        ):
            raise ValueError(
                f"Cannot compute bounds for {entity.dxftype()} "
                f"(handle {entity.dxf.handle})"
            )
        boxes.append(box)

    # Step 3: Grow connected groups, including indirect overlaps/proximity.
    remaining = set(range(len(entities))) - text_indices
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
                axis_gaps = (
                    max(first_min - second_max, second_min - first_max, 0.0)
                    for first_min, first_max, second_min, second_max in zip(
                        current.extmin, current.extmax, other.extmin, other.extmax
                    )
                )
                if math.hypot(*axis_gaps) <= gap_tol:
                    remaining.remove(candidate)
                    group.append(candidate)
                    pending.append(candidate)
        groups.append(group)

    # Step 4: Assign text using fixed geometry bounds, keeping detached details.
    part_boxes = [
        bbox.extents([entities[index] for index in group], cache=cache)
        for group in groups
    ]
    detail_handles = set()
    for index in sorted(text_indices):
        text_box = boxes[index]
        matched = False
        for group, part_box in zip(groups, part_boxes):
            if all(
                text_min <= part_max and part_min <= text_max
                for text_min, text_max, part_min, part_max in zip(
                    text_box.extmin, text_box.extmax,
                    part_box.extmin, part_box.extmax
                )
            ):
                group.append(index)
                matched = True
        if not matched:
            detail_handles.add(entities[index].dxf.handle)
    xref.load_modelspace(
        doc, details, filter_fn=lambda entity: entity.dxf.handle in detail_handles
    )

    # Step 5: Copy each group and its dependent resources into a new drawing.
    components = []
    for group in groups:
        component = ezdxf.new(dxfversion=doc.dxfversion, units=doc.units)
        handles = {entities[index].dxf.handle for index in group}
        xref.load_modelspace(
            doc, component, filter_fn=lambda entity: entity.dxf.handle in handles
        )
        components.append(component)

    # Step 6: Return parts and details; no geometry produces an empty parts list.
    return components, details
