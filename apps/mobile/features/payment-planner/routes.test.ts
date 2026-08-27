import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const paymentPlannerRoute = readFileSync(join(dir, "../../app/(app)/payment-planner.tsx"), "utf8");
const planDetailsRoute = readFileSync(
  join(dir, "../../app/(app)/payment-planner/plan-details.tsx"),
  "utf8"
);

describe("Payment Planner Expo routes", () => {
  it("default-exports Payment Planner screen route", () => {
    expect(paymentPlannerRoute).toMatch(/export default function PaymentPlannerRoute/);
    expect(paymentPlannerRoute).toMatch(/PaymentPlannerScreen/);
  });

  it("default-exports Plan Details screen route", () => {
    expect(planDetailsRoute).toMatch(/export default function PlanDetailsRoute/);
    expect(planDetailsRoute).toMatch(/PlanDetailsScreen/);
  });
});
