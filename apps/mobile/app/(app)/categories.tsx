import { PlaceholderScreen } from "@/components/PlaceholderScreen";
import { useRouter } from "expo-router";

export default function CategoriesPlaceholder() {
  const router = useRouter();
  return (
    <PlaceholderScreen
      title="Categories"
      showBack
      onBack={() => router.back()}
      message="Full category management (create, edit, archive) is available on the web app for this beta. Mobile supports category selection when editing transactions and budgets."
    />
  );
}
