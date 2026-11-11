import { type RuleProvider } from "@xbond/client/request";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-foreground max-md:flex-col max-md:items-start">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" title={provider.name}>
          {provider.name}
        </span>
        <Badge variant="secondary">{provider.vehicleType}</Badge>
        <Badge variant="secondary">{provider.behavior}</Badge>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-caption text-muted-foreground tabular-nums max-md:w-full max-md:justify-between">
        <span>
          {t("ruleCount")}: {provider.ruleCount}
        </span>
        {provider.updatedAt && (
          <span>
            {t("providerUpdateTime")}:{" "}
            {fromNow(new Date(provider.updatedAt), lang)}
          </span>
        )}
        {visible ? (
          <Spinner className="size-4 motion-reduce:animate-none" />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("providerUpdate")}
            className="text-muted-foreground hover:text-foreground"
            onClick={handleUpdate}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
