import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function ReconcilePlaceholder() {
  const router = useRouter();
  return (
    <PlaceholderScreen
      title="Reconcile"
      showBack
      onBack={() => router.back()}
      message="Statement reconciliation is not included in the mobile beta because it is financially sensitive. Use the web app to reconcile accounts."
    />
  );
}
