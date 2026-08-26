import React, { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAccount,
  getAccount,
  getAccountLifecyclePreflight,
  getProfile,
  updateAccount,
  archiveAccount,
} from "@budget-app/api-client";
import { type AccountType } from "@budget-app/shared";
import { AppHeader, Button, Card, ConfirmDialog, ErrorState, Screen, TextField } from "@/components/ui";
import { describeApiError, fieldErrorsFromApiError } from "@/services/apiErrors";
import { invalidateFinancialQueries } from "@/lib/financialQueryRefresh";

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

export function AccountFormScreen() {
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
      const householdId = profileQuery.data?.default_household;
      if (!householdId) throw new Error("No household found on your profile.");

      const payload = {
        name: form.name.trim(),
        display_name: form.display_name.trim() || null,
        institution: form.institution.trim() || "Manual",
        account_type: form.account_type,
        starting_balance: form.starting_balance.trim() || null,
        credit_limit: form.account_type === "CREDIT" ? form.credit_limit.trim() || null : null,
        target_utilization_percent:
          form.account_type === "CREDIT" ? form.target_utilization_percent.trim() || "10" : null,
      };

      if (isEdit && editId) {
        return updateAccount(editId, {
          name: payload.name,
          display_name: payload.display_name ?? undefined,
          institution: payload.institution,
          account_type: payload.account_type,
          credit_limit: payload.credit_limit ?? undefined,
          target_utilization_percent: payload.target_utilization_percent ?? undefined,
        });
      }
      return createAccount({
        household: householdId,
        ...payload,
      });
    },
    onSuccess: () => {
      invalidateFinancialQueries(queryClient);
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
      invalidateFinancialQueries(queryClient);
      router.back();
    },
    onError: (err) => Alert.alert("Archive failed", describeApiError(err)),
  });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      <Card>
        <TextField label="Name" value={form.name} onChangeText={(v) => setField("name", v)} error={fieldErrors.name} />
        <TextField
          label="Display name"
          value={form.display_name}
          onChangeText={(v) => setField("display_name", v)}
          error={fieldErrors.display_name}
        />
        <TextField
          label="Institution"
          value={form.institution}
          onChangeText={(v) => setField("institution", v)}
          error={fieldErrors.institution}
        />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {ACCOUNT_TYPES.map((type) => (
            <Button
              key={type}
              label={type}
              variant={form.account_type === type ? "primary" : "secondary"}
              onPress={() => setField("account_type", type)}
            />
          ))}
        </View>

        {!isEdit ? (
          <TextField
            label="Starting balance"
            value={form.starting_balance}
            onChangeText={(v) => setField("starting_balance", v)}
            keyboardType="decimal-pad"
            error={fieldErrors.starting_balance}
          />
        ) : null}

        {form.account_type === "CREDIT" ? (
          <>
            <TextField
              label="Credit limit"
              value={form.credit_limit}
              onChangeText={(v) => setField("credit_limit", v)}
              keyboardType="decimal-pad"
              error={fieldErrors.credit_limit}
            />
            <TextField
              label="Utilization target (%)"
              value={form.target_utilization_percent}
              onChangeText={(v) => setField("target_utilization_percent", v)}
              keyboardType="decimal-pad"
              error={fieldErrors.target_utilization_percent}
            />
          </>
        ) : null}
      </Card>

      <View style={{ marginTop: 16, gap: 8 }}>
        <Button label={isEdit ? "Save changes" : "Create account"} onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} />
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
