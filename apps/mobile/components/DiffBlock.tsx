import { Text, View } from "react-native";
import { diffLines } from "@/lib/diff";

export function DiffBlock({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string;
  newText: string;
}) {
  const lines = diffLines(oldText, newText).map((line, index) => ({
    ...line,
    id: `${path}:${index}:${line.kind}:${line.text.length}`,
  }));
  return (
    <View className="mt-2 overflow-hidden rounded-lg bg-zinc-950">
      <Text className="px-3 py-2 font-mono text-xs text-zinc-400">{path}</Text>
      {lines.map((line) => (
        <Text
          key={line.id}
          className={`px-3 font-mono text-xs ${line.kind === "add" ? "bg-emerald-950 text-emerald-300" : line.kind === "del" ? "bg-red-950 text-red-300" : "text-zinc-400"}`}
        >
          {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
          {line.text}
        </Text>
      ))}
    </View>
  );
}
