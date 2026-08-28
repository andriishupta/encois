export type ApplicationError<Code extends string = string> = Error & {
  readonly name: "ApplicationError";
  readonly code: Code;
};

/** Create a boundary-safe error without mistaking vendor errors for service errors. */
export function applicationError<Code extends string>(
  code: Code,
  message: string,
): ApplicationError<Code> {
  const error = new Error(message) as ApplicationError<Code>;
  error.name = "ApplicationError";
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}

export function isApplicationError(value: unknown): value is ApplicationError {
  return value instanceof Error && value.name === "ApplicationError";
}
