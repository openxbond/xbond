import { isMobileApp } from "./host.ts";
import { invokeTauri } from "./local-api-bootstrap.ts";

/**
 * Saves text content as a file named for the user. The desktop webviews have
 * no `<a download>` blob handling (WebKitGTK and WKWebView silently drop the
 * navigation), so the desktop shell owns a save-dialog command that writes
 * only the user-confirmed path; plain browser hosts keep the blob download.
 * Mobile shells have neither surface, so the export fails loudly instead of
 * doing nothing.
 */
export async function saveTextFile(
  contents: string,
  fileName: string,
  filterName: string,
  extensions: string[],
): Promise<boolean> {
  const invoke = invokeTauri();
  if (invoke) {
    if (isMobileApp()) {
      throw new Error("file export is not supported in this host");
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
    new Blob([contents], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = objectURL;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  return true;
}
