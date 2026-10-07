import type { CadEntity } from "./types";

export function updateEntitySelection(
  current: readonly CadEntity[],
  entity: CadEntity | null,
  additive: boolean,
  multiSelectEnabled: boolean,
): CadEntity[] {
  if (!entity) return [];
  if (!additive || !multiSelectEnabled) return [entity];
  return current.some((item) => item.id === entity.id)
    ? current.filter((item) => item.id !== entity.id)
    : [...current, entity];
}
