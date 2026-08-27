import React, { memo } from "react";
import { Pressable } from "react-native";
import { SectionHeader } from "@/components/ui";
import { TransactionRowCard } from "./TransactionRowCard";
import type { TransactionListRow } from "./buildTransactionList";

type Props = {
  item: TransactionListRow;
  onPressTransaction: (id: number) => void;
};

export const TransactionListItem = memo(function TransactionListItem({
  item,
  onPressTransaction,
}: Props) {
  if (item.kind === "section") {
    return <SectionHeader title={item.title} />;
  }
  if (item.kind === "upcoming") {
    const txnId = item.row.transaction_id;
    return (
      <Pressable onPress={() => txnId != null && onPressTransaction(txnId)} disabled={txnId == null}>
        <TransactionRowCard timelineRow={item.row} runningBalance={item.runningBalance} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => onPressTransaction(item.txn.id)}>
      <TransactionRowCard txn={item.txn} runningBalance={item.runningBalance} />
    </Pressable>
  );
});
