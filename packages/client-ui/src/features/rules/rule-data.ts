import { isAxiosError } from "axios";
import useSWR from "swr";

import { useClient } from "@/state/controller-target";
import { useCapabilities } from "@/state/core-settings";

export function useRuleProviders() {
  const client = useClient();
  const capabilities = useCapabilities();
  const { data, mutate, error, isLoading } = useSWR(
    capabilities.ruleProviders ? ["/providers/rules", client] : null,
    async () => {
      try {
        return Object.values(
          (await client.getRuleProviders()).data.providers ?? {},
        );
      } catch (error) {
        if (
          isAxiosError(error) &&
          [404, 405, 501].includes(error.response?.status ?? 0)
        )
          return [];
        throw error;
      }
    },
  );
  return { providers: data ?? [], update: mutate, error, isLoading };
}

export function useRule(enabled: boolean) {
  const client = useClient();
  const { data, mutate, error } = useSWR(
    enabled ? ["/rules", client] : null,
    async () => (await client.getRules()).data.rules ?? [],
    { revalidateOnFocus: false },
  );
  // 首次載入與「真的沒有規則」必須可分，否則空態會在載入期間誤報。
  return {
    rules: data,
    update: mutate,
    error,
    isLoading: enabled && data === undefined && !error,
  };
}
