import math
from collections import defaultdict

from ezdxf import edgeminer, edgesmith
from ezdxf.document import Drawing


STYLE_ATTRIBUTES = (
    "layer", "color", "linetype", "lineweight", "ltscale",
    "true_color", "transparency", "invisible",
)


def join_edges(
    doc: Drawing,
    *,
    gap_tol: float = 0.01,
    max_sagitta: float = 0.01,
) -> Drawing:
    """Join flat XY modelspace edges in place and return the supplied drawing.

    1. Validate the gap and curve approximation tolerances.
    2. Collect open, flat XY modelspace entities, grouped by display attributes.
    3. Convert each group to edges and find chains connected within gap_tol.
    4. Build a polyline for each multi-edge chain and mark detected loops closed.
    5. Add each polyline to modelspace and remove its source entities.
    6. Return the same Drawing object, leaving persistence to the caller.

    Gap and curve approximation tolerances are in drawing units. Gaps are
    bridged by straight segments, not by moving source endpoints. Only
    multi-edge chains with matching display attributes are replaced. Closed
    shapes, isolated edges, and non-XY geometry are preserved. Chains stop at
    ambiguous junctions. Arcs retain their bulges; splines and non-circular
    ellipses are approximated using max_sagitta. Replacement polylines retain
    display attributes, but not source handles or entity-specific metadata.
    """
    # Step 1: Require finite, positive tolerances before changing the drawing.
    if not math.isfinite(gap_tol) or gap_tol <= 0:
        raise ValueError("gap_tol must be finite and positive")
    if not math.isfinite(max_sagitta) or max_sagitta <= 0:
        raise ValueError("max_sagitta must be finite and positive")

    # Step 2: Collect eligible entities without joining across display styles.
    modelspace = doc.modelspace()
    entities_by_style = defaultdict(list)
    for entity in edgesmith.filter_open_edges(modelspace):
        if not edgesmith.is_pure_2d_entity(entity):
            continue
        style = tuple(entity.dxf.get(name) for name in STYLE_ATTRIBUTES)
        entities_by_style[style].append(entity)

    # Step 3: Build a spatial edge index per style and find connected chains.
    for style, entities in entities_by_style.items():
        edges = list(edgesmith.edges_from_entities_2d(entities, gap_tol=gap_tol))
        if len(edges) < 2:
            continue
        deposit = edgeminer.Deposit(edges, gap_tol=gap_tol)
        for chain in edgeminer.find_all_simple_chains(deposit):
            if len(chain) < 2:
                continue
            # Step 4: Preserve display attributes and create the joined polyline.
            attributes = {
                name: value
                for name, value in zip(STYLE_ATTRIBUTES, style)
                if value is not None
            }
            polyline = edgesmith.lwpolyline_from_chain(
                chain, dxfattribs=attributes, max_sagitta=max_sagitta
            )
            polyline.closed = edgeminer.is_loop(chain, gap_tol=gap_tol)

            # Step 5: Replace only the source entities belonging to this chain.
            modelspace.add_entity(polyline)
            for edge in chain:
                modelspace.delete_entity(edge.payload)

    # Step 6: Return the modified drawing without loading or saving files.
    return doc