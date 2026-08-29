import { Stack } from "expo-router";

/**
 * Nested layout so parent Stack.Screen name="goal/[id]" resolves.
 * Without this file Expo only sees goal/[id]/index and goal/[id]/contributions,
 * which traps navigation when pushing `/goal/:id`.
 */
export default function GoalIdLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="contributions" />
    </Stack>
  );
}
