import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function ReconcilePlaceholder() {
  const router = useRouter();
  return <PlaceholderScreen title="Reconcile" showBack onBack={() => router.back()} />;
}
