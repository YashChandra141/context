export type DiffLine = { kind: "same" | "add" | "del"; text: string };

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split("\n");
  const after = newText.split("\n");
  if (before.length * after.length > 40_000) {
    return [
      ...before.map((text) => ({ kind: "del" as const, text })),
      ...after.map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const scores = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const row = scores[i];
    const next = scores[i + 1];
    if (!row || !next) continue;
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const down = next[j] ?? 0;
      const right = row[j + 1] ?? 0;
      row[j] =
        before[i] === after[j] ? (next[j + 1] ?? 0) + 1 : Math.max(down, right);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const current = before[i];
    const next = after[j];
    if (current === next) {
      lines.push({ kind: "same", text: current ?? "" });
      i += 1;
      j += 1;
      continue;
    }
    const down = scores[i + 1]?.[j] ?? 0;
    const right = scores[i]?.[j + 1] ?? 0;
    if (down >= right) {
      lines.push({ kind: "del", text: current ?? "" });
      i += 1;
    } else {
      lines.push({ kind: "add", text: next ?? "" });
      j += 1;
    }
  }
  while (i < before.length)
    lines.push({ kind: "del", text: before[i++] ?? "" });
  while (j < after.length) lines.push({ kind: "add", text: after[j++] ?? "" });
  return lines;
}
