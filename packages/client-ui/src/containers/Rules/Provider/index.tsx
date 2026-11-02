import { Tag, Icon } from "@components";
import { Spinner } from "@components/ui/spinner";
import { useAction } from "@lib/actions";
import { fromNow } from "@lib/date";
import { useClient, useLanguage, useRuleProviders } from "@stores";
import { type RuleProvider } from "@xbond/client/request";
import { useTranslation } from "react-i18next";

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
      await client.updateRuleProvider(provider.name);
      await update();
    });
  }

  return (
    <div className="rule-provider relative flex flex-col px-5 py-4 text-[15px] text-foreground">
      <div className="rule-provider-header flex items-center justify-between max-md:flex-col max-md:items-start">
        <div className="rule-provider-header-part flex items-center max-md:my-1.5">
          <span className="rule-provider-name mr-1.5 w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
            {provider.name}
          </span>
          <Tag>{provider.vehicleType}</Tag>
          <Tag>{provider.behavior}</Tag>
          <span className="rule-provider-update text-[13px] leading-[14px] text-muted-foreground tabular-nums">{`${t("ruleCount")}: ${provider.ruleCount}`}</span>
        </div>
        <div className="rule-provider-header-part flex items-center max-md:my-1.5">
          {provider.updatedAt && (
            <span className="rule-provider-update text-[13px] leading-[14px] text-muted-foreground tabular-nums">{`${t("providerUpdateTime")}: ${fromNow(new Date(provider.updatedAt), lang)}`}</span>
          )}
          {visible ? (
            <Spinner className="ml-5 size-[18px] motion-reduce:animate-none" />
          ) : (
            <Icon
              type="update"
              size={18}
              className="ml-5 block cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={handleUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
