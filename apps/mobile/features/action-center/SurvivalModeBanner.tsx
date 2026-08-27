import React, { memo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  recommendationCardCopy,
  type RecommendationListEntry,
} from "@budget-app/shared";
import { Card, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { survivalModePlannerPath } from "./navigation";

const SURVIVAL_PRIMARY_LABEL = "Review survival plan";

type Props = {
  entry: RecommendationListEntry;
};

export const SurvivalModeBanner = memo(function SurvivalModeBanner({ entry }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const { rec } = entry;
  const { condition, action } = recommendationCardCopy(rec);
  const body = action && action !== condition ? `${condition} ${action}`.trim() : condition;

  return (
    <Card
      style={{
        borderColor: theme.colors.critical,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{rec.title}</Text>
      {body ? (
        <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 8 }}>{body}</Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <Button
          label={SURVIVAL_PRIMARY_LABEL}
          onPress={() => router.push(survivalModePlannerPath())}
        />
      </View>
    </Card>
  );
});
