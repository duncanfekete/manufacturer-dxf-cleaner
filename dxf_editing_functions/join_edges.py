import math
from collections import defaultdict

from ezdxf import edgeminer, edgesmith, upright
from ezdxf.document import Drawing
from ezdxf.lldxf.const import DXF2000


STYLE_ATTRIBUTES = (
    "layer", "color", "linetype", "lineweight", "ltscale",
    "true_color", "transparency", "invisible",
)


def _close_paired_chains(chains, gap_tol):
    # Step 1: Find open multi-edge chains that could form an outline.
    open_indices = [
        index for index, chain in enumerate(chains)
        if len(chain) > 1 and not edgeminer.is_loop(chain, gap_tol=gap_tol)
    ]
    # Step 2: Match both endpoints, allowing either chain direction.
    matches = defaultdict(list)
    for position, first_index in enumerate(open_indices):
        first = chains[first_index]
        for second_index in open_indices[position + 1:]:
            second = chains[second_index]
            for oriented in (second, edgeminer.reverse_chain(second)):
                if edgeminer.is_loop([*first, *oriented], gap_tol=gap_tol):
                    matches[first_index].append((second_index, oriented))
                    matches[second_index].append((first_index, first))
                    break

    # Step 3: Close only unique pairs and leave ambiguous branches unchanged.
    removed = set()
    for first_index, candidates in matches.items():
        if len(candidates) != 1:
            continue
        second_index, oriented = candidates[0]
        if first_index < second_index and len(matches[second_index]) == 1:
            chains[first_index] = [*chains[first_index], *oriented]
            removed.add(second_index)
    return [chain for index, chain in enumerate(chains) if index not in removed]


def join_edges(
    doc: Drawing,
    *,
    gap_tol: float = 0.01,
    max_sagitta: float = 0.01,
) -> Drawing:
    """Join matching-style flat XY edges in place.

    Connected edges become polylines; endpoint gaps up to gap_tol are bridged
    by straight segments. At branch junctions, two open multi-edge chains
    become a closed outline only when they uniquely match at both endpoints.
    Supported curves and polylines with exactly inverted Z extrusion are made
    upright without changing their WCS geometry. Other branches, isolated edges,
    closed shapes and non-XY geometry are not joined. ezdxf preserves arc bulges
    and handles chain reversal; splines
    and non-circular ellipses are approximated using max_sagitta.

    Both tolerances are in drawing units. Replacement polylines retain display
    attributes, not source handles or entity-specific metadata. R12 drawings
    use classic POLYLINE entities; newer drawings use LWPOLYLINE.
    """
    # Step 1: Validate the gap and curve approximation tolerances.
    if not math.isfinite(gap_tol) or gap_tol <= 0:
        raise ValueError("gap_tol must be finite and positive")
    if not math.isfinite(max_sagitta) or max_sagitta <= 0:
        raise ValueError("max_sagitta must be finite and positive")

    # Step 2: Collect flat XY edges with matching display attributes.
    modelspace = doc.modelspace()
    for entity in modelspace.query("ARC CIRCLE ELLIPSE LWPOLYLINE POLYLINE"):
        if entity.dxf.get("extrusion") == (0, 0, -1):
            upright.upright(entity)
    for entity in list(modelspace.query("LINE")):
        if entity.dxf.start == entity.dxf.end:
            modelspace.delete_entity(entity)
    entities_by_style = defaultdict(list)
    for entity in edgesmith.filter_open_edges(modelspace):
        if edgesmith.is_pure_2d_entity(entity):
            style = tuple(entity.dxf.get(name) for name in STYLE_ATTRIBUTES)
            entities_by_style[style].append(entity)

            # Step 3: Find connected chains and close uniquely matched outline pairs.
    for style, entities in entities_by_style.items():
        edges = list(edgesmith.edges_from_entities_2d(entities, gap_tol=gap_tol))
        if len(edges) < 2:
            continue
        deposit = edgeminer.Deposit(edges, gap_tol=gap_tol)
        chains = _close_paired_chains(
            list(edgeminer.find_all_simple_chains(deposit)), gap_tol
        )
        attributes = {
            name: value for name, value in zip(STYLE_ATTRIBUTES, style)
            if value is not None
        }
        # Step 4: Build each replacement polyline, retaining curves and style.
        for chain in chains:
            if len(chain) < 2:
                continue
            polyline = edgesmith.lwpolyline_from_chain(
                chain, dxfattribs=attributes, max_sagitta=max_sagitta
            )
            polyline.closed = edgeminer.is_loop(chain, gap_tol=gap_tol)
            # Step 5: Add a polyline supported by the drawing's DXF version.
            if doc.dxfversion < DXF2000:
                modelspace.add_polyline2d(
                    polyline.get_points("xyseb"),
                    format="xyseb",
                    close=polyline.closed,
                    dxfattribs=attributes,
                )
            else:
                modelspace.add_entity(polyline)
            # Step 6: Remove only the source edges used in this chain.
            for edge in chain:
                modelspace.delete_entity(edge.payload)
    # Step 7: Return the modified drawing without file I/O.
    return doc