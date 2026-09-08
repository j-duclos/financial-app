import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAccount,
  createHousehold,
  getAccount,
  getAccountLifecyclePreflight,
  getProfile,
  listHouseholds,
  updateAccount,
  archiveAccount,
} from "@budget-app/api-client";
import { type AccountType } from "@budget-app/shared";
import { AppHeader, Button, Card, ConfirmDialog, ErrorState, Screen, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError, fieldErrorsFromApiError } from "@/services/apiErrors";
import {
  invalidateAfterAccountFinancialMutation,
  invalidateAfterAccountMetadataEdit,
} from "@/lib/financialQueryRefresh";
import { formatMoneyFieldDisplay } from "@/lib/moneyInput";
import { singleHouseholdIdIfUnambiguous } from "@/lib/householdContext";
import {
  accountCreateApiPayload,
  sanitizeAccountMoneyInput,
  validateAccountOnboardingForm,
} from "./accountOnboardingForm";

const ACCOUNT_TYPES: AccountType[] = ["CHECKING", "SAVINGS", "CREDIT", "CASH", "OTHER"];

type FormState = {
  name: string;
  display_name: string;
  institution: string;
  account_type: AccountType;
  starting_balance: string;
  credit_limit: string;
  target_utilization_percent: string;
};

const emptyForm = (): FormState => ({
  name: "",
  display_name: "",
  institution: "",
  account_type: "CHECKING",
  starting_balance: "",
  credit_limit: "",
  target_utilization_percent: "10",
});

function normalizeMoneyInput(raw: string): string {
  return sanitizeAccountMoneyInput(raw);
}

export function AccountFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = id ? Number(id) : null;
  const isEdit = editId != null && editId > 0;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
  });

  const accountQuery = useQuery({
    queryKey: ["account", editId, "edit"],
    queryFn: () => getAccount(editId as number, true),
    enabled: isEdit,
  });

  useEffect(() => {
    const acc = accountQuery.data;
    if (!acc) return;
    setForm({
      name: acc.name,
      display_name: acc.display_name ?? "",
      institution: acc.institution ?? "",
      account_type: acc.account_type,
      starting_balance: acc.starting_balance ?? "",
      credit_limit: acc.credit_limit ?? "",
      target_utilization_percent: acc.target_utilization_percent ?? "10",
    });
  }, [accountQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let householdId = profileQuery.data?.default_household ?? null;
      if (!householdId) {
        const profile = await getProfile();
        householdId = profile.default_household;
      }
      if (!householdId) {
        const households = await listHouseholds();
        householdId = singleHouseholdIdIfUnambiguous(households);
        if (!householdId && households.length === 0) {
          const created = await createHousehold({ name: "My household" });
          householdId = created.id;
        } else if (!householdId && households.length > 1) {
          throw new Error("Choose a default household in Profile & Settings before adding an account.");
        }
      }
      if (!householdId) throw new Error("No household found on your profile.");

      const created = accountCreateApiPayload(
        {
          name: form.name,
          institution: form.institution,
          account_type: form.account_type,
          starting_balance: form.starting_balance,
          credit_limit: form.credit_limit,
        },
        householdId
      );

      if (isEdit && editId) {
        return updateAccount(editId, {
          name: created.name,
          institution: created.institution,
          account_type: created.account_type,
          credit_limit: created.credit_limit ?? undefined,
        });
      }
      return createAccount(created);
    },
    onSuccess: () => {
      if (!isEdit) {
        invalidateAfterAccountFinancialMutation(queryClient);
      } else {
        const acc = accountQuery.data;
        const financialFieldsChanged =
          acc != null &&
          (form.account_type !== acc.account_type ||
            form.credit_limit !== (acc.credit_limit ?? "") ||
            form.target_utilization_percent !== (acc.target_utilization_percent ?? "10"));
        if (financialFieldsChanged) {
          invalidateAfterAccountFinancialMutation(queryClient);
        } else {
          invalidateAfterAccountMetadataEdit(queryClient);
        }
      }
      router.back();
    },
    onError: (err) => {
      const fields = fieldErrorsFromApiError(err);
      if (Object.keys(fields).length > 0) {
        setFieldErrors(fields);
        return;
      }
      Alert.alert("Save failed", describeApiError(err));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const preflight = await getAccountLifecyclePreflight(editId, "archive");
      if (preflight.warnings.length > 0) {
        throw new Error(preflight.warnings.join("\n"));
      }
      return archiveAccount(editId);
    },
    onSuccess: () => {
      invalidateAfterAccountFinancialMutation(queryClient);
      router.back();
    },
    onError: (err) => Alert.alert("Archive failed", describeApiError(err)),
  });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const onSave = () => {
    const nextErrors = validateAccountOnboardingForm({
      name: form.name,
      institution: form.institution,
      account_type: form.account_type,
      starting_balance: form.starting_balance,
      credit_limit: form.credit_limit,
    });
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }
    saveMutation.mutate();
  };

  if (isEdit && accountQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Edit account" onBack={() => router.back()} />
      </Screen>
    );
  }

  if (isEdit && accountQuery.isError) {
    return (
      <Screen scroll>
        <AppHeader title="Edit account" onBack={() => router.back()} />
        <ErrorState message={describeApiError(accountQuery.error)} onRetry={() => void accountQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader title={isEdit ? "Edit account" : "Add account"} onBack={() => router.back()} />
      {isEdit && accountQuery.data?.plaid_item_id ? (
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          Linked bank accounts keep synced balances from the bank. You can update name and
          display details here.
        </Text>
      ) : null}
      <Card>
        <TextField
          label="Account name"
          value={form.name}
          onChangeText={(v) => setField("name", v)}
          error={fieldErrors.name}
        />
        <TextField
          label="Bank / institution (optional)"
          value={form.institution}
          onChangeText={(v) => setField("institution", v)}
          error={fieldErrors.institution}
        />

        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: 6 }}>
          Account type
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {ACCOUNT_TYPES.map((type) => (
            <Button
              key={type}
              label={type.charAt(0) + type.slice(1).toLowerCase()}
              variant={form.account_type === type ? "primary" : "secondary"}
              onPress={() => setField("account_type", type)}
            />
          ))}
        </View>

        {!isEdit ? (
          <>
            <TextField
              label={form.account_type === "CREDIT" ? "Current balance owed" : "Starting balance"}
              value={formatMoneyFieldDisplay(form.starting_balance)}
              onChangeText={(v) => setField("starting_balance", normalizeMoneyInput(v))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoCorrect={false}
              autoCapitalize="none"
              placeholder="$ 0.00"
              error={fieldErrors.starting_balance}
            />
            {form.account_type !== "CREDIT" ? (
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.caption,
                  marginTop: -8,
                  marginBottom: 12,
                }}
              >
                Opening ledger balance for this account.
              </Text>
            ) : null}
          </>
        ) : null}

        {form.account_type === "CREDIT" ? (
          <TextField
            label="Credit limit"
            value={formatMoneyFieldDisplay(form.credit_limit)}
            onChangeText={(v) => setField("credit_limit", normalizeMoneyInput(v))}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoCorrect={false}
            autoCapitalize="none"
            placeholder="$ 0.00"
            error={fieldErrors.credit_limit}
          />
        ) : null}
      </Card>

      <View style={{ marginTop: 16, gap: 8 }}>
        <Button label={isEdit ? "Save changes" : "Create account"} onPress={onSave} loading={saveMutation.isPending} />
        {isEdit ? (
          <Button label="Archive account" variant="danger" onPress={() => setArchiveOpen(true)} />
        ) : null}
      </View>

      <ConfirmDialog
        visible={archiveOpen}
        title="Archive account"
        message="Archived accounts are hidden from active lists but history is preserved. You can restore from the web app if needed."
        destructive
        loading={archiveMutation.isPending}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => archiveMutation.mutate()}
      />
    </Screen>
  );
}
