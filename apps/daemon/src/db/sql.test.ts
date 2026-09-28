import { describe, expect, test } from "bun:test";
import { splitSql } from "./sql";

describe("sql splitter", () => {
  test("splits drizzle statement breakpoints", () => {
    const statements = splitSql(`
CREATE TABLE "machines" (
  "id" text PRIMARY KEY
);
--> statement-breakpoint
-- comment only
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" text PRIMARY KEY
);
`);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("machines");
    expect(statements[1]).toContain("sessions");
  });
});
