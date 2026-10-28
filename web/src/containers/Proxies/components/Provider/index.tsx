import { Card, Tag, Icon, Loading } from "@components";
import { compareDesc } from "@containers/Proxies";
import { Proxy } from "@containers/Proxies/components/Proxy";
import { useAction } from "@lib/actions";
import { fromNow } from "@lib/date";
import { type Provider as IProvider, type Proxy as IProxy } from "@lib/request";
import { useClient, useLanguage, useProxyProviders } from "@stores";
import { useLatency } from "@stores/latency";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import "./style.scss";

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

  function handleHealthChech() {
    void run(async () => {
      await client.healthCheckProvider(provider.name);
      await update();
      invalidate(provider.proxies.map((p) => p.name));
    });
  }
  function handleUpdate() {
    void run(async () => {
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
    <Card className="proxy-provider">
      <Loading visible={visible} />
      <div className="flex flex-col justify-between md:flex-row md:items-center">
        <div className="flex items-center">
          <span className="mr-6">{provider.name}</span>
          <Tag>{provider.vehicleType}</Tag>
        </div>
        <div className="flex items-center pt-3 md:pt-0">
          {provider.updatedAt && (
            <span className="text-sm">{`${t("providerUpdateTime")}: ${fromNow(new Date(provider.updatedAt), lang)}`}</span>
          )}
          <Icon
            className="cursor-pointer pl-5 text-destructive"
            type="healthcheck"
            size={18}
            onClick={handleHealthChech}
          />
          <Icon
            className="cursor-pointer pl-5"
            type="update"
            size={18}
            onClick={handleUpdate}
          />
        </div>
      </div>
      <ul className="proxies-list">
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
