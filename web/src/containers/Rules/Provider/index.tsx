import { Tag, Icon } from "@components";
import { useAction } from "@lib/actions";
import { fromNow } from "@lib/date";
import { type RuleProvider } from "@lib/request";
import { useClient, useLanguage, useRuleProviders } from "@stores";
import classnames from "classnames";
import { useTranslation } from "react-i18next";

import "./style.scss";

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

  const updateClassnames = classnames("rule-provider-icon", {
    "rule-provider-loading": visible,
  });

  return (
    <div className="rule-provider">
      <div className="rule-provider-header">
        <div className="rule-provider-header-part">
          <span className="rule-provider-name">{provider.name}</span>
          <Tag>{provider.vehicleType}</Tag>
          <Tag className="rule-provider-behavior">{provider.behavior}</Tag>
          <span className="rule-provider-update">{`${t("ruleCount")}: ${provider.ruleCount}`}</span>
        </div>
        <div className="rule-provider-header-part">
          {provider.updatedAt && (
            <span className="rule-provider-update">{`${t("providerUpdateTime")}: ${fromNow(new Date(provider.updatedAt), lang)}`}</span>
          )}
          <Icon
            className={updateClassnames}
            type="update"
            size={18}
            onClick={handleUpdate}
          />
        </div>
      </div>
    </div>
  );
}
