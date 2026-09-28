export function splitSql(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((part) => part.trim().replace(/;+\s*$/u, "").trim())
    .filter((part) => part.length > 0 && part.split("\n").some((line) => !line.trim().startsWith("--") && line.trim() !== ""));
}
