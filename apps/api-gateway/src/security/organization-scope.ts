import type { OrganizationUnitNode } from "@encois/contracts";

type ScopeUnit = Pick<OrganizationUnitNode, "id" | "type"> & { parentId?: string | null };

function knownUnitIds(units: readonly ScopeUnit[]): Set<string> {
  return new Set(units.map((unit) => unit.id));
}

/** Expands scope roots through the organization hierarchy without trusting unknown IDs. */
export function expandOrganizationScope(
  units: readonly ScopeUnit[],
  roots: readonly string[],
): ReadonlySet<string> {
  const known = knownUnitIds(units);
  const children = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id]);
  }

  const expanded = new Set<string>();
  const queue = [...new Set(roots)];
  for (let index = 0; index < queue.length; index += 1) {
    const unitId = queue[index];
    if (!unitId || expanded.has(unitId) || !known.has(unitId)) continue;
    expanded.add(unitId);
    queue.push(...(children.get(unitId) ?? []));
  }
  return expanded;
}

export function isKnownOrganizationUnit(units: readonly ScopeUnit[], unitId: string): boolean {
  return knownUnitIds(units).has(unitId);
}

/** Returns true when every target unit is covered by at least one scope root. */
export function organizationScopeCovers(
  units: readonly ScopeUnit[],
  roots: readonly string[],
  targetUnitIds: readonly string[],
): boolean {
  if (targetUnitIds.length === 0) return false;
  if (roots.includes("*")) return targetUnitIds.every((unitId) => isKnownOrganizationUnit(units, unitId));
  const expanded = expandOrganizationScope(units, roots);
  return targetUnitIds.every((unitId) => expanded.has(unitId));
}

/** Returns true when two hierarchical scopes share at least one readable unit. */
export function organizationScopesOverlap(
  units: readonly ScopeUnit[],
  leftRoots: readonly string[],
  rightRoots: readonly string[],
): boolean {
  if (leftRoots.includes("*") || rightRoots.includes("*")) return true;
  const left = expandOrganizationScope(units, leftRoots);
  const right = expandOrganizationScope(units, rightRoots);
  for (const unitId of left) {
    if (right.has(unitId)) return true;
  }
  return false;
}
