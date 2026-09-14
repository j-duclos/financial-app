import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateAccount } from "@budget-app/api-client";
import {
  HOME_ACCOUNT_PIN_LIMIT_MESSAGE,
  type Account,
} from "@budget-app/shared";
import { describeApiError } from "@/services/api";
import { invalidateAfterAccountMetadataEdit } from "@/lib/financialQueryRefresh";
import { accountQueryKeys } from "./queryKeys";
import {
  canPinAnotherHomeAccount,
  countPinnedHomeAccounts,
  patchHomePinInAccountCaches,
} from "./homeAccountPin";

function accountsFromMainList(queryClient: ReturnType<typeof useQueryClient>): Account[] {
  const page = queryClient.getQueryData<{ results?: Account[] }>(accountQueryKeys.mainList());
  return page?.results ?? [];
}

export function useHomeAccountPin() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: { account: Account; pinned: boolean }) => {
      return updateAccount(input.account.id, { pinned_to_home: input.pinned });
    },
    onMutate: async (input) => {
      const current = accountsFromMainList(queryClient);
      if (input.pinned && !canPinAnotherHomeAccount(current, input.account.id)) {
        throw new Error(HOME_ACCOUNT_PIN_LIMIT_MESSAGE);
      }
      const nextOrder = input.pinned
        ? input.account.home_pin_order ?? countPinnedHomeAccounts(current) + 1
        : null;
      patchHomePinInAccountCaches(queryClient, input.account.id, {
        pinned_to_home: input.pinned,
        home_pin_order: nextOrder,
      });
    },
    onError: (err) => {
      invalidateAfterAccountMetadataEdit(queryClient);
      Alert.alert("Home pin", describeApiError(err));
    },
    onSuccess: (updated) => {
      patchHomePinInAccountCaches(queryClient, updated.id, {
        pinned_to_home: updated.pinned_to_home ?? false,
        home_pin_order: updated.home_pin_order ?? null,
      });
      invalidateAfterAccountMetadataEdit(queryClient);
    },
  });

  const toggleHomePin = (account: Account) => {
    const pinned = account.pinned_to_home === true;
    if (!pinned && !canPinAnotherHomeAccount(accountsFromMainList(queryClient), account.id)) {
      Alert.alert("Home pin", HOME_ACCOUNT_PIN_LIMIT_MESSAGE);
      return;
    }
    mutation.mutate({ account, pinned: !pinned });
  };

  return {
    toggleHomePin,
    isPending: mutation.isPending,
    pendingAccountId: mutation.variables?.account.id ?? null,
  };
}
