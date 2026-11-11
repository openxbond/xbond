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

export function useAction(isLocal = false) {
  const { t } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const run = useCallback(
    // notify: true → generic "saved"; false → caller owns feedback;
    // string → success copy for the verb actually performed.
    async (work: () => Promise<unknown>, notify: boolean | string = true) => {
      if (locked.current) return false;
      locked.current = true;
      setPending(true);
      try {
        await work();
        if (notify)
          toast.success(typeof notify === "string" ? notify : tc("saved"));
        return true;
      } catch (error) {
        toast.error(t(errorKind(error, isLocal)), { duration: 6000 });
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
