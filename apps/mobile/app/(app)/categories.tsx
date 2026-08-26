import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function CategoriesPlaceholder() {
  const router = useRouter();
  return <PlaceholderScreen title="Categories" showBack onBack={() => router.back()} />;
}
