import { error as showError, success } from "@components/Message";
import { useI18n } from "@stores/jotai";
import { isAxiosError } from "axios";
import { useCallback, useRef, useState } from "react";

export function errorKind(
  error: unknown,
): "unauthorized" | "timeout" | "network" | "unsupported" | "requestFailed" {
  if (isAxiosError(error)) {
    if ([401, 403].includes(error.response?.status ?? 0)) return "unauthorized";
    if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? ""))
      return "timeout";
    if ([404, 405, 501].includes(error.response?.status ?? 0))
      return "unsupported";
    if (!error.response) return "network";
  }
  return "requestFailed";
}

export function useAction() {
  const { translation } = useI18n();
  const { t } = translation("Runtime");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const run = useCallback(
    async (work: () => Promise<unknown>, notify = true) => {
      if (locked.current) return false;
      locked.current = true;
      setPending(true);
      try {
        await work();
        if (notify) success(t("saved"));
        return true;
      } catch (error) {
        showError(t(errorKind(error)), 6000);
        return false;
      } finally {
        locked.current = false;
        setPending(false);
      }
    },
    [t],
  );
  return { run, pending };
}
