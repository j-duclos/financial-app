import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changeEmail, resendVerification, type UserProfile } from "@budget-app/api-client";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { describeApiError } from "@/services/api";
import { useTheme } from "@/theme";
import {
  EMAIL_CHANGE_SUCCESS,
  applyUpdatedProfileCache,
  emailVerificationLabel,
  hasProfileEmail,
  profileEmailDisplay,
  shouldShowResendVerification,
} from "./profileSettings";

type Props = {
  visible: boolean;
  profile: UserProfile | undefined;
  onClose: () => void;
  onProfileRefreshed: () => Promise<unknown>;
};

export function EmailSettingsSheet({ visible, profile, onClose, onProfileRefreshed }: Props) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const email = profile?.email;
  const verified = profile?.email_verified === true;
  const hasEmail = hasProfileEmail(email);

  useEffect(() => {
    if (!visible) {
      setChanging(false);
      setNewEmail("");
      setCurrentPassword("");
      setFormError(null);
    }
  }, [visible]);

  const changeMutation = useMutation({
    mutationFn: () =>
      changeEmail({
        email: newEmail.trim(),
        current_password: currentPassword,
      }),
    onSuccess: async (result) => {
      if (profile) {
        applyUpdatedProfileCache(queryClient, {
          ...profile,
          email: result.email,
          email_verified: result.email_verified,
        });
      }
      await onProfileRefreshed();
      setChanging(false);
      setNewEmail("");
      setCurrentPassword("");
      setFormError(null);
      Alert.alert("Email updated", EMAIL_CHANGE_SUCCESS);
    },
    onError: (err) => setFormError(describeApiError(err)),
  });

  const resendMutation = useMutation({
    mutationFn: resendVerification,
    onSuccess: (result) => {
      Alert.alert("Verification email", result.detail || "Verification email sent.");
    },
    onError: (err) => Alert.alert("Couldn’t send email", describeApiError(err)),
  });

  function submitChange() {
    if (!newEmail.trim()) {
      setFormError("Enter a new email address.");
      return;
    }
    if (!currentPassword) {
      setFormError("Enter your current password.");
      return;
    }
    setFormError(null);
    changeMutation.mutate();
  }

  return (
    <BottomSheet visible={visible} title="Email" onClose={onClose} keyboardAware>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Current email</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 4 }}>
          {profileEmailDisplay(email)}
        </Text>
        {hasEmail ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
            {emailVerificationLabel(verified)}
          </Text>
        ) : null}

        {formError ? (
          <Text style={{ color: theme.colors.critical, marginTop: 12 }}>{formError}</Text>
        ) : null}

        {changing ? (
          <View style={{ marginTop: 16 }}>
            <TextField
              label="New email"
              value={newEmail}
              onChangeText={setNewEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextField
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
            />
            <Button
              label="Save email"
              onPress={submitChange}
              loading={changeMutation.isPending}
            />
            <View style={{ marginTop: 8 }}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setChanging(false);
                  setFormError(null);
                }}
              />
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 8 }}>
            <Button
              label={hasEmail ? "Change email" : "Add email"}
              onPress={() => {
                setChanging(true);
                setFormError(null);
              }}
            />
            {shouldShowResendVerification({ email, verified }) ? (
              <Button
                label="Resend verification email"
                variant="secondary"
                loading={resendMutation.isPending}
                onPress={() => resendMutation.mutate()}
              />
            ) : null}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
