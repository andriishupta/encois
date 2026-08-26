export function parseOptions(argv: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument?.startsWith("--")) continue;
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (!key || !value || value.startsWith("--"))
      throw new Error(`Missing value for --${key ?? "option"}.`);
    options[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return options;
}

export function required(
  options: Record<string, string>,
  name: string,
): string {
  const value = options[name]?.trim();
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug)
    throw new Error("Organization name must produce a non-empty slug.");
  return slug;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url)
    throw new Error("DATABASE_MIGRATION_URL is required for operator scripts.");
  return url;
}
