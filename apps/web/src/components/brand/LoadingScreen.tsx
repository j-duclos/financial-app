import { APP_NAME, APP_TAGLINE } from "@budget-app/shared";
import BrandLogo from "./BrandLogo";

type Props = {
  label?: string;
};

export default function LoadingScreen({ label }: Props) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6"
      role="status"
      aria-label={label ?? `Loading ${APP_NAME}`}
    >
      <div>
        <BrandLogo size="large" />
        <p className="mt-3 text-sm text-gray-500 text-center">{APP_TAGLINE}</p>
        <div className="mt-8 flex justify-center">
          <span className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      </div>
    </div>
  );
}
