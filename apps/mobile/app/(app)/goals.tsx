import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function GoalsPlaceholder() {
  const router = useRouter();
  return <PlaceholderScreen title="Goals" showBack onBack={() => router.back()} />;
}
