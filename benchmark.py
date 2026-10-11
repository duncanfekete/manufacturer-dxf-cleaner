from pydantic import BaseModel, Field
import json
from pathlib import Path

from ezdxf import DXFError

from process_dxf import DXFProcessingError, PartGeometry, process_dxf_file

class DXFRegistry:
    def __init__(self, root_directory: str | None = None) -> None:
        self.registry: list[DXF] = []
        self.results: list[DXF] = []
        if root_directory is not None:
            self.load_directory(root_directory)

    def add_dxf(self, dxf: "DXF") -> None:
        self.registry.append(dxf)

    def load_directory(self, root_directory: str) -> None:
        for dxf in collect_dxf_from_directory(root_directory):
            self.add_dxf(dxf)

    def run_benchmark(self) -> None:
        self.results.clear()
        if not self.registry:
            print("No DXF files found.")
            return

        for dxf in self.registry:
            try:
                dxf.resolve_dxf()
            except (OSError, ValueError, DXFError, DXFProcessingError) as error:
                dxf.error = f"{type(error).__name__}: {error}"
            self.results.append(dxf.model_copy(deep=True))

        for dxf in self.results:
            if dxf.passed:
                continue
            print(f"DXF: {dxf.root_directory}")
            if dxf.needs_review:
                print(f"Needs Review: {dxf.review_reason}")
            if dxf.error is not None:
                print(f"Error: {dxf.error}")
            print(f"Expected Parts: {dxf.expected_parts}, Resolved Parts: {dxf.resolved_parts}")

        print(f"Total Failed: {self.fail_count} out of {self.total_count}")

    def dump_results(self, file_path: str | Path) -> None:
        output_path = Path(file_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "total_count": self.total_count,
            "pass_count": self.pass_count,
            "fail_count": self.fail_count,
            "results": [
                {**dxf.model_dump(mode="json"), "passed": dxf.passed}
                for dxf in self.results
            ],
        }
        with output_path.open("w", encoding="utf-8") as output_file:
            json.dump(payload, output_file, indent=2)
            output_file.write("\n")

    @property
    def total_count(self) -> int:
        return len(self.results)

    @property
    def pass_count(self) -> int:
        return sum(dxf.passed for dxf in self.results)

    @property
    def fail_count(self) -> int:
        return self.total_count - self.pass_count

class DXF(BaseModel):
    root_directory: str
    expected_parts: list[PartGeometry]
    resolved_parts: list[PartGeometry] = Field(default_factory=list)
    needs_review: bool = False
    review_reason: str | None = None
    error: str | None = None

    def resolve_dxf(self) -> None:
        """
        Runs full DXF clean and breakdown process.
        """
        self.resolved_parts = []
        self.error = None
        result = process_dxf_file(self.root_directory)
        self.resolved_parts = result.parts

    @property
    def passed(self) -> bool:
        return (
            not self.needs_review
            and
            self.error is None
            and sorted(tuple(sorted(part.items())) for part in self.expected_parts)
            == sorted(tuple(sorted(part.items())) for part in self.resolved_parts)
        )

def collect_dxf_from_directory(root_directory: str) -> list[DXF]:
    benchmarks = []
    dxf_paths = sorted(
        path for path in Path(root_directory).rglob("*")
        if path.is_file() and path.suffix.lower() == ".dxf"
    )

    for dxf_path in dxf_paths:
        json_path = dxf_path.with_suffix(".json")
        with json_path.open(encoding="utf-8") as json_file:
            expected_geometry = json.load(json_file)

        benchmarks.append(DXF(
            root_directory=str(dxf_path),
            expected_parts=expected_geometry["parts"],
            needs_review=expected_geometry.get("needs_review", False),
            review_reason=expected_geometry.get("review_reason"),
        ))
    return benchmarks