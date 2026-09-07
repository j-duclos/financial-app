import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { deleteUserAccount, getDeleteAccountPreflight } from "@budget-app/api-client";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { describeApiError } from "@/services/api";
import { useTheme } from "@/theme";
import {
  DELETE_ACCOUNT_CONSEQUENCES,
  DELETE_CONFIRMATION,
  clientDeleteAccountError,
  deleteAccountBlockingCopy,
} from "./profileSettings";

type Props = {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => Promise<void>;
};

export function DeleteAccountSheet({ visible, onClose, onDeleted }: Props) {
  const theme = useTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const preflightQuery = useQuery({
    queryKey: ["delete-account-preflight"],
    queryFn: getDeleteAccountPreflight,
    enabled: visible,
  });

  useEffect(() => {
    if (!visible) {
      setCurrentPassword("");
      setConfirmation("");
      setFormError(null);
    }
  }, [visible]);

  const preflight = preflightQuery.data;
  const blockers = preflight ? deleteAccountBlockingCopy(preflight) : [];
  const canAttemptDelete = preflight?.can_delete === true;

  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteUserAccount({
        current_password: currentPassword,
        confirmation,
      }),
    onSuccess: async () => {
      await onDeleted();
    },
    onError: (err) => setFormError(describeApiError(err)),
  });

  function submit() {
    if (!canAttemptDelete) return;
    const error = clientDeleteAccountError({ currentPassword, confirmation });
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    deleteMutation.mutate();
  }

  return (
    <BottomSheet visible={visible} title="Delete account" onClose={onClose} keyboardAware>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>
          Account deletion is permanent.
        </Text>
        {DELETE_ACCOUNT_CONSEQUENCES.map((line) => (
          <Text key={line} style={{ color: theme.colors.textMuted, marginBottom: 6, fontSize: 13 }}>
            • {line}
          </Text>
        ))}

        {preflightQuery.isLoading ? (
          <View style={{ paddingVertical: 16 }}>
            <ActivityIndicator color={theme.colors.tint} />
          </View>
        ) : null}

        {preflightQuery.isError ? (
          <Text style={{ color: theme.colors.critical, marginVertical: 12 }}>
            Could not check whether this account can be deleted. Try again later.
          </Text>
        ) : null}

        {blockers.length > 0 ? (
          <View style={{ marginVertical: 12, gap: 6 }}>
            {blockers.map((text) => (
              <Text key={text} style={{ color: theme.colors.warning }}>
                {text}
              </Text>
            ))}
          </View>
        ) : null}

        {formError ? (
          <Text style={{ color: theme.colors.critical, marginBottom: 12 }}>{formError}</Text>
        ) : null}

        {canAttemptDelete ? (
          <>
            <TextField
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
            />
            <TextField
              label={`Type ${DELETE_CONFIRMATION} to confirm`}
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Button
              label="Delete my account"
              variant="danger"
              onPress={submit}
              loading={deleteMutation.isPending}
            />
          </>
        ) : preflight && !canAttemptDelete ? (
          <Text style={{ color: theme.colors.textSecondary, marginTop: 8 }}>
            Resolve the issues above before deleting this account.
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}
