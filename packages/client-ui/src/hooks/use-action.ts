import { isAxiosError } from "axios";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function errorKind(
  error: unknown,
  isLocal = false,
):
  | "unauthorized"
  | "timeout"
  | "network"
  | "networkLocal"
  | "unsupported"
  | "requestFailed" {
  // AbortSignal timeout aborts land here as DOMExceptions, before any
  // axios-specific checks — the caller decides whether to surface them.
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "timeout";
  if (isAxiosError(error)) {
    if ([401, 403].includes(error.response?.status ?? 0)) return "unauthorized";
    if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? ""))
      return "timeout";
    if ([404, 405, 501].includes(error.response?.status ?? 0))
      return "unsupported";
    if (!error.response) return isLocal ? "networkLocal" : "network";
  }
  return "requestFailed";
}

export interface RunOptions {
  /** false → the caller renders the failure itself (dialog, inline state). */
  errorToast?: boolean;
}

export function useAction(isLocal = false) {
  const { t } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const run = useCallback(
    // notify: true → generic "saved"; false → caller owns feedback;
    // string → success copy for the verb actually performed.
    async (
      work: () => Promise<unknown>,
      notify: boolean | string = true,
      options: RunOptions = {},
    ) => {
      if (locked.current) return false;
      locked.current = true;
      setPending(true);
      try {
        await work();
        if (notify)
          toast.success(typeof notify === "string" ? notify : tc("saved"));
        return true;
      } catch (error) {
        if (options.errorToast !== false) {
          // requestFailed is the catch-all: LocalAPI fetch errors carry the
          // concrete cause ("HTTP 404", the server's error text); surfacing
          // it separates "endpoint missing in this build" from real server
          // failures instead of swallowing both behind one sentence.
          const kind = errorKind(error, isLocal);
          const description =
            kind === "requestFailed" && error instanceof Error && error.message
              ? error.message
              : undefined;
          toast.error(t(kind), {
            duration: 6000,
            ...(description ? { description } : {}),
          });
        }
        return false;
      } finally {
        locked.current = false;
        setPending(false);
      }
    },
    [t, tc, isLocal],
  );
  return { run, pending };
}
