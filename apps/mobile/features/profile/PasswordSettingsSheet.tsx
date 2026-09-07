import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { changePassword } from "@budget-app/api-client";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { describeApiError } from "@/services/api";
import { useTheme } from "@/theme";
import {
  PASSWORD_CHANGE_SUCCESS,
  clientPasswordErrors,
  passwordApiFieldErrors,
  type PasswordFieldErrors,
} from "./profileSettings";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function PasswordSettingsSheet({ visible, onClose }: Props) {
  const theme = useTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});
      setFormError(null);
    }
  }, [visible]);

  const changeMutation = useMutation({
    mutationFn: () =>
      changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      }),
    onSuccess: () => {
      onClose();
      Alert.alert("Password", PASSWORD_CHANGE_SUCCESS);
    },
    onError: (err) => {
      const message = describeApiError(err);
      setFormError(message);
      setFieldErrors(passwordApiFieldErrors(message));
    },
  });

  function submit() {
    const errors = clientPasswordErrors({ currentPassword, newPassword, confirmPassword });
    if (errors) {
      setFieldErrors(errors);
      setFormError("Fix the highlighted password fields.");
      return;
    }
    setFieldErrors({});
    setFormError(null);
    changeMutation.mutate();
  }

  return (
    <BottomSheet visible={visible} title="Change password" onClose={onClose} keyboardAware>
      <ScrollView keyboardShouldPersistTaps="handled">
        {formError ? (
          <Text style={{ color: theme.colors.critical, marginBottom: 12 }}>{formError}</Text>
        ) : null}
        <TextField
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          error={fieldErrors.current}
          textContentType="password"
          autoComplete="password"
        />
        <TextField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          error={fieldErrors.next}
          textContentType="newPassword"
          autoComplete="password-new"
        />
        <TextField
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          error={fieldErrors.confirm}
          textContentType="newPassword"
          autoComplete="password-new"
        />
        <Button label="Update password" onPress={submit} loading={changeMutation.isPending} />
      </ScrollView>
    </BottomSheet>
  );
}
