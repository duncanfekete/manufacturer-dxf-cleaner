import ezdxf
import os
import shutil
import warnings
from dataclasses import dataclass, field
from io import BytesIO, StringIO
from pathlib import Path

from ezdxf import recover
from ezdxf.audit import Auditor
from ezdxf.document import Drawing
from ezdxf.lldxf.tagger import ascii_tags_loader
from ezdxf.lldxf.tags import group_tags
from ezdxf.lldxf.tagwriter import TagWriter
from ezdxf.lldxf.types import DXFTag
from typing_extensions import TypedDict

from dxf_editing_functions.group_parts import group_parts
from dxf_editing_functions.join_edges import join_edges
from dxf_editing_functions.seperate_into_layers import count_internal_dividers, separate_layers


class PartGeometry(TypedDict):
    internal_geometry: int
    internal_dividers: int


@dataclass
class DXFProcessingResult:
    output_paths: list[str] = field(default_factory=list)
    parts: list[PartGeometry] = field(default_factory=list)

# 1. Create results directory for a given DXF file path
def create_results_directory(file_path: str) -> str:
    # Validate file path contains dxf
    if not file_path.lower().endswith('.dxf'):
        raise ValueError("No DXF file at provided file_path")

    source_path = Path(file_path).resolve()
    try:
        datasets_index = source_path.parts.index("datasets")
    except ValueError as error:
        raise ValueError("file_path must be inside a datasets directory") from error

    output_directory = (
        Path(__file__).resolve().parent
        / "results"
        / Path(*source_path.parts[datasets_index + 1 : -1])
        / source_path.stem
    )

    result_dir=f"{output_directory}/original_file.dxf"

    output_directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, result_dir)
    
    return result_dir

def recover_polyline_subclasses(file_path: Path) -> tuple[Drawing, Auditor]:
    """Restore missing subclass markers on simple LWPOLYLINE tags in memory."""
    common_codes = {8, 6, 62, 48, 60, 67, 370, 410, 420, 430, 440}
    geometry_codes = {90, 70, 43, 38, 39, 10, 20, 40, 41, 42, 91, 210, 220, 230}
    base_codes = {0, 5, 330}
    output = StringIO()
    writer = TagWriter(output)
    repaired_count = 0
    with file_path.open(encoding="latin-1") as source:
        for tags in group_tags(ascii_tags_loader(source)):
            if tags[0].value == "LWPOLYLINE" and not any(tag.code == 100 for tag in tags):
                count_tags = [tag for tag in tags if tag.code == 90]
                if (
                    any(tag.code not in base_codes | common_codes | geometry_codes for tag in tags)
                    or len(count_tags) != 1
                    or int(count_tags[0].value) != sum(tag.code == 10 for tag in tags)
                    or sum(tag.code == 10 for tag in tags) != sum(tag.code == 20 for tag in tags)
                ):
                    raise ezdxf.DXFStructureError(f"Cannot safely repair LWPOLYLINE in {file_path}")
                writer.write_tags([tag for tag in tags if tag.code in base_codes])
                writer.write_tag(DXFTag(100, "AcDbEntity"))
                writer.write_tags([tag for tag in tags if tag.code in common_codes])
                writer.write_tag(DXFTag(100, "AcDbPolyline"))
                writer.write_tags([tag for tag in tags if tag.code in geometry_codes])
                repaired_count += 1
            else:
                writer.write_tags(tags)
    if not repaired_count:
        raise ezdxf.DXFStructureError(f"No repairable markerless LWPOLYLINE in {file_path}")
    warnings.warn(
        f"Restored subclass markers on {repaired_count} LWPOLYLINE entities in {file_path}; "
        "coordinate tags were preserved.",
        RuntimeWarning,
        stacklevel=2,
    )
    return recover.read(BytesIO(output.getvalue().encode("latin-1")))


# 2. Join edge, created "edge_joined.dxf" in results
def join_part_edges(results_file_path: str) -> str:
    source_path = Path(results_file_path)
    output_path = source_path.with_name("edge_joined.dxf")
    try:
        doc = ezdxf.readfile(source_path)
    except ezdxf.DXFStructureError:
        try:
            doc, auditor = recover.readfile(source_path)
        except ezdxf.DXFStructureError:
            doc, auditor = recover_polyline_subclasses(source_path)
        if auditor.has_errors:
            raise ezdxf.DXFStructureError(
                f"Unresolved DXF audit errors in {source_path}: "
                f"{[error.message for error in auditor.errors]}"
            )
        warnings.warn(
            f"Recovered {source_path} with {len(auditor.fixes)} DXF repairs; "
            "geometry may have changed.",
            RuntimeWarning,
            stacklevel=2,
        )
    join_edges(doc).saveas(output_path)
    return str(output_path)

# 3. Separate parts in one dxf to several dxf
def split_dxf_parts(file_path: str) -> list[str]:
    """
    Receives an edge_joined or original_file dxf file path and splits it into separate parts.
    Each part is saved as a separate DXF file in the same directory as the input file.
    Contained or overlapping TEXT and MTEXT stay with parts; detached text is
    saved together in details.dxf.
    
    Returns the part paths, or an empty list if the drawing contains no geometry.
    """
    source_path = Path(file_path)
    doc = ezdxf.readfile(source_path)
    parts, details = group_parts(doc)
    details.saveas(source_path.with_name("details.dxf"))
    output_paths: list[str] = []
    for index, part in enumerate(parts, start=1):
        output_path = source_path.with_name(f"part_{index}.dxf")
        part.saveas(output_path)
        output_paths.append(str(output_path))
    return output_paths

#4. Takes a list of dxf and creates a variant of them with layers organised systematically
def organize_layers(file_paths: list[str]) -> DXFProcessingResult:
    """
    Receives a list of DXF file paths and creates variants of them with layers organized systematically.
    Each organized DXF is saved in the same directory as the input file with a "_organized" suffix.
    
    Returns saved paths and named geometry counts for each part. Collinear
    straight divider segments count as one logical fold, including dashed folds.
    """
    result = DXFProcessingResult()
    for file_path in file_paths:
        source_path = Path(file_path)
        output_path = source_path.with_name(
            f"{source_path.stem}_organized{source_path.suffix}"
        )
        doc = ezdxf.readfile(source_path)
        separate_layers(doc).saveas(output_path)
        modelspace = doc.modelspace()
        result.parts.append({
            "internal_geometry": len(modelspace.query(
                'LWPOLYLINE POLYLINE CIRCLE[layer=="INTERNAL_GEOMETRY"]'
            )),
            "internal_dividers": count_internal_dividers(doc),
        })
        result.output_paths.append(str(output_path))
    return result

def process_dxf_file(file_path: str) -> DXFProcessingResult:
    """
    Processes a single DXF file through the full pipeline:
    1. Creates a results directory and copies the original file.
    2. Joins edges.
    3. Splits the DXF into separate parts.
    4. Organizes layers for each part.

    Returns final processed paths and per-part internal geometry/divider counts.
    """
    original_file = create_results_directory(file_path)
    edge_joined_file = join_part_edges(original_file)
    split_files = split_dxf_parts(edge_joined_file)
    return organize_layers(split_files)