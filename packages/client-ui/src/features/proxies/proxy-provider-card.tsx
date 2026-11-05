import { compareDesc } from "@xbond/client/latency";
import {
  type Provider as IProvider,
  type Proxy as IProxy,
} from "@xbond/client/request";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/icon-font";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { fromNow } from "@/i18n/relative-time";
import { useClient } from "@/state/controller-target";
import { useLanguage } from "@/state/user-preferences";

import { useLatency } from "./latency-context";
import { useProxyProviders } from "./proxy-data";
import { Proxy } from "./proxy-row";

interface ProvidersProps {
  provider: IProvider;
  search?: string;
}

export function Provider(props: ProvidersProps) {
  const { update } = useProxyProviders();
  const { lang } = useLanguage();
  const client = useClient();

  const { provider } = props;
  const { t } = useTranslation("proxies");

  const { pending: visible, run } = useAction();
  const { invalidate } = useLatency();

  function handleHealthCheck() {
    void run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      await client.healthCheckProvider(provider.name);
      await update();
      invalidate(provider.proxies.map((p) => p.name));
    });
  }
  function handleUpdate() {
    void run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      await client.updateProvider(provider.name);
      await update();
      invalidate(provider.proxies.map((p) => p.name));
    });
  }

  const proxies = useMemo(() => {
    return (provider.proxies as IProxy[])
      .slice()
      .sort((a, b) => -1 * compareDesc(a, b));
  }, [provider.proxies]);

  return (
    <Card className="relative flex flex-col text-base text-foreground">
      {visible && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/72">
          <Spinner className="size-5" />
        </div>
      )}
      <div className="flex flex-col justify-between md:flex-row md:items-center">
        <div className="flex items-center">
          <span className="mr-6">{provider.name}</span>
          <Badge variant="secondary">{provider.vehicleType}</Badge>
        </div>
        <div className="flex items-center pt-3 md:pt-0">
          {provider.updatedAt && (
            <span className="text-sm">{`${t("providerUpdateTime")}: ${fromNow(new Date(provider.updatedAt), lang)}`}</span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("providerHealthCheck")}
            className="ml-4 text-destructive hover:text-destructive"
            disabled={visible}
            onClick={handleHealthCheck}
          >
            <Icon aria-hidden="true" type="healthcheck" size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("providerUpdate")}
            className="ml-1"
            disabled={visible}
            onClick={handleUpdate}
          >
            <Icon aria-hidden="true" type="update" size={18} />
          </Button>
        </div>
      </div>
      <ul className="mt-5 mb-10 grid list-none grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4 p-0 max-md:grid-cols-1">
        {proxies
          .filter(
            (p) =>
              !props.search ||
              p.name.toLowerCase().includes(props.search.toLowerCase()),
          )
          .map((p: IProxy) => (
            <li key={p.name}>
              <Proxy config={p} />
            </li>
          ))}
      </ul>
    </Card>
  );
}
