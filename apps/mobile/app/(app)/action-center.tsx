import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function ActionCenterPlaceholder() {
  const router = useRouter();
  return <PlaceholderScreen title="Action Center" showBack onBack={() => router.back()} />;
}
