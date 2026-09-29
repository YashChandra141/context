import type { EventMessage } from "@phone/protocol";
import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { DiffBlock } from "@/components/DiffBlock";
import { buildTranscript } from "@/lib/transcript";

export function Transcript({ events }: { events: EventMessage[] }) {
  const scroller = useRef<ScrollView>(null);
  const blocks = buildTranscript(events);
  if (blocks.length === 0) {
    return (
      <Text className="px-4 py-8 text-center text-zinc-500">
        Send a prompt to start this session.
      </Text>
    );
  }
  return (
    <ScrollView
      ref={scroller}
      contentContainerClassName="gap-3 px-4 py-4"
      onContentSizeChange={() =>
        scroller.current?.scrollToEnd({ animated: false })
      }
    >
      {blocks.map((block) => {
        if (block.kind === "notice") {
          return (
            <Text key={block.id} className="text-sm text-zinc-500">
              {block.text}
            </Text>
          );
        }
        if (block.kind === "tool") {
          return (
            <View
              key={block.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3"
            >
              <Text className="font-medium text-zinc-100">{block.title}</Text>
              {block.status ? (
                <Text className="mt-1 text-xs uppercase text-zinc-500">
                  {block.status}
                </Text>
              ) : null}
              {block.text ? (
                <Text className="mt-2 font-mono text-xs text-zinc-300">
                  {block.text}
                </Text>
              ) : null}
              {block.diffs.map((diff) => (
                <DiffBlock
                  key={diff.path}
                  path={diff.path}
                  oldText={diff.oldText}
                  newText={diff.newText}
                />
              ))}
            </View>
          );
        }
        const mine = block.role === "user";
        return (
          <View
            key={block.id}
            className={`max-w-[90%] rounded-2xl px-3 py-2 ${mine ? "self-end bg-emerald-700" : "self-start bg-zinc-800"}`}
          >
            {mine || block.role === "thought" ? (
              <Text
                className={
                  block.role === "thought"
                    ? "text-sm italic text-zinc-400"
                    : "text-base text-white"
                }
              >
                {block.text}
              </Text>
            ) : (
              <Markdown style={markdownStyle}>{block.text}</Markdown>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const markdownStyle = {
  body: { color: "#f4f4f5", fontSize: 16 },
  code_inline: { backgroundColor: "#27272a", color: "#d4d4d8" },
  fence: { backgroundColor: "#18181b", color: "#e4e4e7" },
  link: { color: "#6ee7b7" },
};
