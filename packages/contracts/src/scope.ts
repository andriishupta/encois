import {
  OrganizationUnitType,
  type OrganizationUnitType as OrganizationUnitTypeValue,
  ScopeRuleMode,
  type ScopeRuleMode as ScopeRuleModeValue,
} from "./values.js";

export type OrganizationUnitNode = {
  id: string;
  parentId?: string;
  type: OrganizationUnitTypeValue;
};

export type ScopeRule = {
  unitId: string;
  mode: ScopeRuleModeValue;
};

export type EffectiveScope = {
  directUnitIds: readonly string[];
  inheritedUnitIds: readonly string[];
  explicitGrantUnitIds: readonly string[];
  explicitRestrictionUnitIds: readonly string[];
  resolvedUnitIds: readonly string[];
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function expandUnits(
  units: readonly OrganizationUnitNode[],
  starts: readonly string[],
): string[] {
  const known = new Set(units.map((unit) => unit.id));
  const children = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    const siblings = children.get(unit.parentId) ?? [];
    siblings.push(unit.id);
    children.set(unit.parentId, siblings);
  }

  const expanded: string[] = [];
  const queue = unique(starts);
  for (let index = 0; index < queue.length; index += 1) {
    const unitId = queue[index];
    if (!unitId || expanded.includes(unitId)) continue;
    if (known.has(unitId)) expanded.push(unitId);
    for (const childId of children.get(unitId) ?? []) queue.push(childId);
  }
  return expanded;
}

/**
 * Computes the deterministic visibility set used by the Gateway. Direct
 * membership scopes inherit descendants; explicit grants add descendants;
 * restrictions remove a unit subtree. Unknown unit IDs are ignored so a
 * stale membership cannot widen access.
 */
export function resolveEffectiveScope(input: {
  units: readonly OrganizationUnitNode[];
  directUnitIds: readonly string[];
  rules?: readonly ScopeRule[];
}): EffectiveScope {
  const directUnitIds = unique(input.directUnitIds);
  const rules = input.rules ?? [];
  const grantUnitIds = unique(
    rules
      .filter((rule) => rule.mode === ScopeRuleMode.Grant)
      .map((rule) => rule.unitId),
  );
  const restrictionRoots = unique(
    rules
      .filter((rule) => rule.mode === ScopeRuleMode.Restrict)
      .map((rule) => rule.unitId),
  );
  const directExpanded = expandUnits(input.units, directUnitIds);
  const grantExpanded = expandUnits(input.units, grantUnitIds);
  const restrictedExpanded = expandUnits(input.units, restrictionRoots);
  const restricted = new Set(restrictedExpanded);
  const resolvedUnitIds = unique([...directExpanded, ...grantExpanded]).filter(
    (unitId) => !restricted.has(unitId),
  );

  return {
    directUnitIds: directExpanded.filter((unitId) =>
      directUnitIds.includes(unitId),
    ),
    inheritedUnitIds: directExpanded.filter(
      (unitId) => !directUnitIds.includes(unitId) && !restricted.has(unitId),
    ),
    explicitGrantUnitIds: grantExpanded.filter(
      (unitId) => !restricted.has(unitId),
    ),
    explicitRestrictionUnitIds: restrictedExpanded,
    resolvedUnitIds,
  };
}

export { OrganizationUnitType, ScopeRuleMode };
