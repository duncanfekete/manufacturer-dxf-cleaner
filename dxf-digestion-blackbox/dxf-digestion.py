import sys
from pathlib import Path

from ezdxf.document import Drawing

# Resolve the repository from this module's location so callers do not have to
# run from the repository root or set PYTHONPATH. Import the benchmark's actual
# helpers through their package paths to keep geometry behaviour identical.
repository_directory = str(Path(__file__).resolve().parents[1])
if repository_directory not in sys.path:
    sys.path.insert(0, repository_directory)

from benchmark.dxf_editing_functions.group_parts import group_parts
from benchmark.dxf_editing_functions.join_edges import join_edges
from benchmark.dxf_editing_functions.seperate_into_layers import separate_layers


def process_drawing(drawing: Drawing) -> list[Drawing]:
    """Return organised parts followed by details using the benchmark's rules.

    Accept an already-loaded Drawing and keep every processing stage in memory.
    Joining modifies the supplied drawing in place; grouping creates independent
    part drawings, which are then classified in place. The last returned drawing
    always contains annotations and detected sheet details, without part-layer
    classification. Empty and details-only inputs return just that drawing.

    No DXF files are read or written, no recovery reader is invoked, and no
    benchmark counts are computed. The caller owns loading, saving, and handling
    processing exceptions. Tolerances remain the helpers' drawing-unit defaults.
    """
    # Step 1: Join broken edges, just as join_part_edges does in the benchmark.
    # The helper cleans zero-length lines and joins compatible flat XY edges,
    # bridging small gaps. Pass its returned Drawing directly to grouping instead
    # of saving edge_joined.dxf and loading that file again.
    joined_drawing = join_edges(drawing)

    # Step 2: Split the joined geometry, just as split_dxf_parts does.
    # group_parts copies each part into its own Drawing and returns annotations
    # and detected sheet details separately. The benchmark saves those details,
    # but only passes manufacturing parts to layer organisation; do the same here
    # without writing part_N.dxf or details.dxf.
    parts, details = group_parts(joined_drawing)

    # Step 3: Organise each part, just as organize_layers does.
    # Classify the external profile, internal cuts, and internal dividers while
    # retaining explicit etching/engraving layers. These returned drawings are
    # the in-memory equivalents of the benchmark's part_N_organized.dxf outputs.
    # Skip saving, reloading, and counting: this interface returns geometry only.
    organised_parts: list[Drawing] = []
    for part in parts:
        organised_parts.append(separate_layers(part))

    # Step 4: Include the equivalent of details.dxf after the organised parts.
    # Keep its source layers rather than classifying it as manufacturing geometry.
    # Always include it, even when empty, so the final item has a stable meaning.
    return [*organised_parts, details]