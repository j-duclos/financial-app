import { useState } from "react";
import { APP_NAME } from "@budget-app/shared";
import logoUrl from "../../assets/branding/flowsight-logo.jpg";
import { BrandWordmark } from "./BrandWordmark";

export type BrandSize = "small" | "medium" | "large";

const HEIGHT: Record<BrandSize, number> = {
  small: 64,
  medium: 108,
  large: 156,
};

type Props = {
  size?: BrandSize;
  className?: string;
};

export default function BrandLogo({ size = "medium", className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const height = HEIGHT[size];

  if (failed) {
    return (
      <div className={`flex justify-center ${className}`} aria-label={APP_NAME} role="img">
        <BrandWordmark size={size} />
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={APP_NAME}
      className={`mx-auto object-contain ${className}`}
      style={{ height, width: "auto", maxWidth: "100%" }}
      onError={() => setFailed(true)}
    />
  );
}
