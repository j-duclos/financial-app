import React, { useCallback, useMemo, useState } from "react";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumCheckout } from "@/hooks/usePremiumUpgrade";
import { PremiumUpgradeContext } from "./premiumUpgradeContext";
import { PremiumUpgradeSheet } from "./PremiumUpgradeSheet";

export function PremiumUpgradeProvider({ children }: { children: React.ReactNode }) {
  const { billing } = useBillingStatus();
  const { startUpgrade, upgrading } = usePremiumCheckout();
  const [visible, setVisible] = useState(false);
  const [contextMessage, setContextMessage] = useState<string | undefined>();

  const promptUpgrade = useCallback(
    (message?: string) => {
      if (billing?.is_premium) return;
      setContextMessage(message);
      setVisible(true);
    },
    [billing?.is_premium]
  );

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const onUpgrade = useCallback(() => {
    setVisible(false);
    void startUpgrade();
  }, [startUpgrade]);

  const value = useMemo(() => ({ promptUpgrade }), [promptUpgrade]);

  return (
    <PremiumUpgradeContext.Provider value={value}>
      {children}
      <PremiumUpgradeSheet
        visible={visible}
        contextMessage={contextMessage}
        upgrading={upgrading}
        onClose={close}
        onUpgrade={onUpgrade}
      />
    </PremiumUpgradeContext.Provider>
  );
}
