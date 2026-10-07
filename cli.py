from pathlib import Path
import shlex

import click
from ezdxf import DXFError

from benchmark import DXFRegistry


class SessionExit(click.exceptions.Exit):
	pass


def run_session(registry: DXFRegistry) -> None:
	while True:
		try:
			command = click.prompt("dxf", prompt_suffix="> ")
		except click.Abort:
			click.echo()
			return
		try:
			arguments = shlex.split(command)
			if not arguments:
				continue
			with cli.make_context("dxf", arguments, obj=registry) as context:
				cli.invoke(context)
		except SessionExit:
			return
		except click.ClickException as error:
			error.show()
		except click.exceptions.Exit:
			continue
		except click.Abort:
			click.echo("Aborted.", err=True)
		except ValueError as error:
			click.echo(f"Error: {error}", err=True)


@click.group(chain=True, invoke_without_command=True)
@click.pass_context
def cli(context: click.Context) -> None:
	"""Start a persistent command session, or chain commands in one invocation."""
	if context.obj is None:
		context.obj = DXFRegistry()
	if context.invoked_subcommand is None:
		run_session(context.obj)


@cli.command("exit_session")
def exit_session() -> None:
	"""Close the current command session."""
	raise SessionExit()


@cli.command("register")
@click.argument(
	"directory",
	type=click.Path(exists=True, file_okay=False, resolve_path=True, path_type=Path),
)
@click.pass_obj
def register_directory(registry: DXFRegistry, directory: Path) -> None:
	"""Add DXFs and their expected JSON metadata from DIRECTORY."""
	previous_count = len(registry.registry)
	try:
		registry.load_directory(str(directory))
	except (OSError, ValueError, KeyError) as error:
		raise click.ClickException(f"Could not register {directory}: {error}") from error
	added_count = len(registry.registry) - previous_count
	if not added_count:
		raise click.ClickException(f"No DXF files found in {directory}.")
	registry.results.clear()
	click.echo(f"Registered {added_count} DXF files from {directory}.")


@cli.command("run")
@click.pass_obj
def run_registry(registry: DXFRegistry) -> None:
	"""Run the benchmark on all registered DXFs."""
	if not registry.registry:
		raise click.ClickException("Register a directory before running the benchmark.")
	try:
		registry.run_benchmark()
	except (OSError, ValueError, DXFError) as error:
		raise click.ClickException(f"Benchmark failed: {error}") from error


@cli.command("dump")
@click.argument(
	"directory",
	type=click.Path(file_okay=False, resolve_path=True, path_type=Path),
)
@click.pass_obj
def dump_registry(registry: DXFRegistry, directory: Path) -> None:
	"""Write the registry results to DIRECTORY/benchmark.json."""
	if not registry.results:
		raise click.ClickException("Run the benchmark before dumping results.")
	output_path = directory / "benchmark.json"
	try:
		registry.dump_results(output_path)
	except OSError as error:
		raise click.ClickException(f"Could not write {output_path}: {error}") from error
	click.echo(f"Results written to {output_path}.")


if __name__ == "__main__":
	cli()
