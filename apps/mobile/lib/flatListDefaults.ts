/** Shared FlatList tuning for primary financial lists (Transactions, Budget, etc.). */
export const FINANCIAL_LIST_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;
