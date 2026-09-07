import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { AuthenticatedFile } from "@budget-app/api-client";

export async function shareAuthenticatedFile(file: AuthenticatedFile): Promise<void> {
  const dest = new File(Paths.cache, file.filename);
  if (dest.exists) {
    dest.delete();
  }
  dest.create();
  dest.write(file.data);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest.uri, {
      mimeType: file.contentType,
      dialogTitle: file.filename,
      UTI: file.contentType.includes("csv") ? "public.comma-separated-values-text" : "public.json",
    });
    return;
  }
  throw new Error("Sharing is not available on this device.");
}
