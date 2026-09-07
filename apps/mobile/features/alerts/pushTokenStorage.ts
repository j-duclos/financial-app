import AsyncStorage from "@react-native-async-storage/async-storage";
import { unregisterPushDeviceByToken } from "@budget-app/api-client";
import { PUSH_TOKEN_STORAGE_KEY } from "./projectedFundsPush";

export async function unregisterStoredPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) return;
  try {
    await unregisterPushDeviceByToken(token);
  } catch {
    /* logout should continue even if unregister fails */
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}
