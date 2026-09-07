import { APP_NAME, APP_NAME_PREFIX, APP_NAME_SUFFIX, BRAND_COLORS } from "@budget-app/shared";

export type BrandSize = "small" | "medium" | "large";

const SIZE: Record<BrandSize, string> = {
  small: "text-lg",
  medium: "text-2xl",
  large: "text-3xl",
};

type Props = {
  size?: BrandSize;
  className?: string;
};

export function BrandWordmark({ size = "medium", className = "" }: Props) {
  return (
    <span
      className={`inline-block font-bold tracking-tight ${SIZE[size]} ${className}`}
      aria-label={APP_NAME}
    >
      <span style={{ color: BRAND_COLORS.navy }}>{APP_NAME_PREFIX}</span>
      <span className="font-semibold" style={{ color: BRAND_COLORS.teal }}>
        {APP_NAME_SUFFIX}
      </span>
    </span>
  );
}

export default BrandWordmark;
