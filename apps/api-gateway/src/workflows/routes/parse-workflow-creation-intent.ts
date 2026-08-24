import { isJsonObject, type WorkflowCreationIntent } from "@encois/contracts";

const modes = new Set<WorkflowCreationIntent["mode"]>([
  "template",
  "blueprint",
  "manual",
]);

export function parseWorkflowCreationIntent(
  value: unknown,
): WorkflowCreationIntent | null {
  if (
    !isJsonObject(value) ||
    typeof value.name !== "string" ||
    !modes.has(value.mode as WorkflowCreationIntent["mode"])
  )
    return null;
  if (value.description !== undefined && typeof value.description !== "string")
    return null;
  if (value.businessKey !== undefined && typeof value.businessKey !== "string")
    return null;
  if (value.templateKey !== undefined && typeof value.templateKey !== "string")
    return null;
  if (
    value.blueprintKey !== undefined &&
    typeof value.blueprintKey !== "string"
  )
    return null;
  if (value.prompt !== undefined && typeof value.prompt !== "string")
    return null;
  if (value.businessInput !== undefined && !isJsonObject(value.businessInput))
    return null;
  if (value.start !== undefined && typeof value.start !== "boolean")
    return null;
  if (value.scope !== undefined) {
    if (
      !isJsonObject(value.scope) ||
      !Array.isArray(value.scope.ids) ||
      value.scope.ids.some((id) => typeof id !== "string")
    )
      return null;
  }
  return {
    mode: value.mode as WorkflowCreationIntent["mode"],
    name: value.name,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(typeof value.businessKey === "string"
      ? { businessKey: value.businessKey }
      : {}),
    ...(typeof value.templateKey === "string"
      ? { templateKey: value.templateKey }
      : {}),
    ...(typeof value.blueprintKey === "string"
      ? { blueprintKey: value.blueprintKey }
      : {}),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(isJsonObject(value.businessInput)
      ? { businessInput: value.businessInput }
      : {}),
    ...(isJsonObject(value.scope)
      ? { scope: { ids: value.scope.ids as string[] } }
      : {}),
    ...(typeof value.start === "boolean" ? { start: value.start } : {}),
  };
}
