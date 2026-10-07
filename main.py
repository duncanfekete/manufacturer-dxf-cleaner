from pathlib import Path

from process_dxf import process_dxf_file


def main() -> None:
	test_directory = Path(__file__).resolve().parent / "datasets" / "public_datasets" / "test"
	if not test_directory.is_dir():
		raise FileNotFoundError(f"Test directory not found: {test_directory}")

	file_paths = sorted(
		path
		for path in test_directory.rglob("*")
		if path.is_file() and path.suffix.lower() == ".dxf"
	)
	if not file_paths:
		print(f"No DXF files found in {test_directory}")
		return

	failed_files = []
	for file_path in file_paths:
		print(f"Processing {file_path.relative_to(test_directory)}")
		try:
			result = process_dxf_file(str(file_path))
		except Exception as error:
			print(f"Failed: {file_path.name}: {error}")
			failed_files.append(file_path)
			continue
		for output_path in result.output_paths:
			print(f"Saved: {output_path}")

	print(f"Processed {len(file_paths) - len(failed_files)}/{len(file_paths)} DXF files")
	if failed_files:
		raise SystemExit(1)


if __name__ == "__main__":
	main()
