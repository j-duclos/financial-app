import React from "react";
import { Linking, Text } from "react-native";
import { useTheme } from "@/theme";
import { getPrivacyPolicyUrl, getTermsUrl } from "@/constants/appInfo";
import {
  PRIVACY_POLICY_LABEL,
  REGISTER_LEGAL_ACKNOWLEDGEMENT_AND,
  REGISTER_LEGAL_ACKNOWLEDGEMENT_PREFIX,
  TERMS_OF_SERVICE_LABEL,
} from "./premiumUpgradeCopy";

type Props = {
  prefix?: string;
};

export function LegalInlineLinks({
  prefix = REGISTER_LEGAL_ACKNOWLEDGEMENT_PREFIX,
}: Props) {
  const theme = useTheme();
  const termsUrl = getTermsUrl();
  const privacyUrl = getPrivacyPolicyUrl();
  const linkStyle = {
    color: theme.colors.tint,
    textDecorationLine: "underline" as const,
  };

  return (
    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
      {prefix}
      <Text
        accessibilityRole="link"
        style={linkStyle}
        onPress={() => void Linking.openURL(termsUrl)}
      >
        {TERMS_OF_SERVICE_LABEL}
      </Text>
      {REGISTER_LEGAL_ACKNOWLEDGEMENT_AND}
      <Text
        accessibilityRole="link"
        style={linkStyle}
        onPress={() => void Linking.openURL(privacyUrl)}
      >
        {PRIVACY_POLICY_LABEL}
      </Text>
      .
    </Text>
  );
}
