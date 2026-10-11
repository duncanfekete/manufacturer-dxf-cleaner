import argparse
from pathlib import Path

from benchmark.benchmark import DXFRegistry


def main() -> int:
	parser = argparse.ArgumentParser(description="Benchmark every DXF under a directory.")
	parser.add_argument("root_directory", type=Path, help="Directory containing DXFs and expected JSON files")
	arguments = parser.parse_args()
	if not arguments.root_directory.is_dir():
		parser.error(f"not a directory: {arguments.root_directory}")

	registry = DXFRegistry(str(arguments.root_directory.resolve()))
	registry.run_benchmark()
	return int(registry.fail_count > 0)


if __name__ == "__main__":
	raise SystemExit(main())
