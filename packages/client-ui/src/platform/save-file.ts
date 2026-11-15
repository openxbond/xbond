import { isMobileApp } from "./host.ts";
import { invokeTauri } from "./local-api-bootstrap.ts";

export type ExportTextMethod = "save" | "share";

/**
 * Saves text content as a file named for the user. The desktop webviews have
 * no `<a download>` blob handling (WebKitGTK and WKWebView silently drop the
 * navigation), so the desktop shell owns a save-dialog command that writes
 * only the user-confirmed path; plain browser hosts keep the blob download.
 * Mobile shells export through the native plugin (save dialog / share sheet).
 */
export async function saveTextFile(
  contents: string,
  fileName: string,
  filterName: string,
  extensions: string[],
  mimeType = "text/plain;charset=utf-8",
): Promise<boolean> {
  const invoke = invokeTauri();
  if (invoke) {
    if (isMobileApp()) {
      const saved = (await invoke("plugin:xbond|save_text_file", {
        contents,
        fileName,
        mimeType,
      })) as boolean;
      return saved;
    }
    const saved = (await invoke("save_text_file", {
      contents,
      fileName,
      filterName,
      extensions,
    })) as boolean;
    return saved;
  }
  const objectURL = URL.createObjectURL(
    new Blob([contents], { type: mimeType }),
  );
  const a = document.createElement("a");
  a.href = objectURL;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  return true;
}

/** Shares text content through the mobile system share sheet. */
export async function shareTextFile(
  contents: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8",
): Promise<boolean> {
  const invoke = invokeTauri();
  if (!invoke || !isMobileApp()) {
    throw new Error("share is not supported in this host");
  }
  const shared = (await invoke("plugin:xbond|share_text_file", {
    contents,
    fileName,
    mimeType,
  })) as boolean;
  return shared;
}
