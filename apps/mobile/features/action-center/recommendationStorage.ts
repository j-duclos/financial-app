import {
  dismissRecommendation as dismissRecommendationApi,
  restoreRecommendation as restoreRecommendationApi,
  snoozeRecommendation as snoozeRecommendationApi,
  unsnoozeRecommendation as unsnoozeRecommendationApi,
} from "@budget-app/api-client";
import { isSurvivalModeId } from "@budget-app/shared";

export async function dismissRecommendation(id: string): Promise<void> {
  if (isSurvivalModeId(id)) return;
  await dismissRecommendationApi(id);
}

export async function snoozeRecommendation(id: string): Promise<void> {
  if (isSurvivalModeId(id)) return;
  await snoozeRecommendationApi(id);
}

export async function unsnoozeRecommendation(id: string): Promise<void> {
  await unsnoozeRecommendationApi(id);
}

export async function restoreRecommendation(id: string): Promise<void> {
  await restoreRecommendationApi(id);
}

export async function snoozeResolveRisk(snoozeId: string | null | undefined): Promise<void> {
  if (snoozeId) await snoozeRecommendation(snoozeId);
}
