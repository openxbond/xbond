import { type RuleProvider } from "@xbond/client/request";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/icon-font";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { fromNow } from "@/i18n/relative-time";
import { useClient } from "@/state/controller-target";
import { useLanguage } from "@/state/user-preferences";

import { useRuleProviders } from "./rule-data";

interface ProvidersProps {
  provider: RuleProvider;
}

export function Provider(props: ProvidersProps) {
  const { update } = useRuleProviders();
  const { lang } = useLanguage();
  const client = useClient();

  const { provider } = props;
  const { t } = useTranslation("rules");

  const { pending: visible, run } = useAction();

  function handleUpdate() {
    void run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      await client.updateRuleProvider(provider.name);
      await update();
    });
  }

  return (
    <div className="rule-provider relative flex flex-col px-5 py-4 text-subtitle text-foreground">
      <div className="rule-provider-header flex items-center justify-between max-md:flex-col max-md:items-start">
        <div className="rule-provider-header-part flex items-center max-md:my-1.5">
          <span className="rule-provider-name mr-1.5 w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
            {provider.name}
          </span>
          <Badge variant="secondary">{provider.vehicleType}</Badge>
          <Badge variant="secondary">{provider.behavior}</Badge>
          <span className="rule-provider-update text-body leading-[14px] text-muted-foreground tabular-nums">{`${t("ruleCount")}: ${provider.ruleCount}`}</span>
        </div>
        <div className="rule-provider-header-part flex items-center max-md:my-1.5">
          {provider.updatedAt && (
            <span className="rule-provider-update text-body leading-[14px] text-muted-foreground tabular-nums">{`${t("providerUpdateTime")}: ${fromNow(new Date(provider.updatedAt), lang)}`}</span>
          )}
          {visible ? (
            <Spinner className="ml-5 size-[18px] motion-reduce:animate-none" />
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("providerUpdate")}
              className="ml-4 text-muted-foreground hover:text-foreground"
              onClick={handleUpdate}
            >
              <Icon aria-hidden="true" type="update" size={18} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
