import { Pressable, Text, View } from "react-native";
import type { PermissionRequest } from "@/lib/store";

export function PermissionSheet({
  permission,
  onRespond,
}: {
  permission: PermissionRequest;
  onRespond: (optionId: string) => void;
}) {
  return (
    <View className="border-t border-amber-800 bg-zinc-900 px-4 py-4">
      <Text className="text-xs uppercase tracking-wide text-amber-300">
        Permission needed
      </Text>
      <Text className="mt-1 text-base text-zinc-100">{permission.title}</Text>
      <View className="mt-3 gap-2">
        {permission.options.map((option) => (
          <Pressable
            key={option.optionId}
            className={`rounded-xl px-4 py-3 ${option.kind.startsWith("reject") ? "bg-zinc-800" : "bg-emerald-600"}`}
            onPress={() => onRespond(option.optionId)}
          >
            <Text className="text-center font-medium text-white">
              {option.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
