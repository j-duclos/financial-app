import { APP_TAGLINE } from "@budget-app/shared";
import BrandLogo, { type BrandSize } from "./BrandLogo";

type Props = {
  size?: BrandSize;
  showTagline?: boolean;
  className?: string;
};

export default function BrandLockup({ size = "large", showTagline = true, className = "" }: Props) {
  return (
    <div className={`text-center space-y-2 ${className}`}>
      <BrandLogo size={size} />
      {showTagline ? <p className="text-sm text-gray-500">{APP_TAGLINE}</p> : null}
    </div>
  );
}
