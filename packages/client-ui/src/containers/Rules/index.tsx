import { Header, Card, Input } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { useRule, useRuleProviders, useCapabilities } from "@stores";
import type * as API from "@xbond/client/request";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { List, type RowComponentProps } from "react-window";

import { Provider } from "./Provider";

import "./style.scss";

function RuleProviders() {
  const { providers, error, update } = useRuleProviders();
  const { t } = useTranslation("rules");

  return (
    <>
      <RequestStatus error={error} retry={update} />
      {providers.length !== 0 && (
        <div className="flex flex-col">
          <Header title={t("providerTitle")} />
          <Card className="mt-4 p-0 divide-y divide-border">
            {providers.map((p) => (
              <Provider key={p.name} provider={p} />
            ))}
          </Card>
        </div>
      )}
    </>
  );
}

function RuleRow({
  index,
  style,
  rules,
}: RowComponentProps<{ rules: API.Rule[] }>) {
  const rule = rules[index];
  return (
    <div className="rule-item" style={style}>
      <div className="rule-row">
        <div className="rule-type w-44">{rule.type}</div>
        <div className="payload flex-1" title={rule.payload}>
          {rule.payload}
        </div>
        <div className="rule-proxy w-56" title={rule.proxy}>
          {rule.proxy}
        </div>
      </div>
    </div>
  );
}

export default function Rules() {
  const { rules: allRules, error, update } = useRule();
  const [search, setSearch] = useState("");
  const rules = allRules.filter(
    (rule) =>
      !search ||
      [rule.type, rule.payload, rule.proxy].some((value) =>
        value.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const capabilities = useCapabilities();
  const { t } = useTranslation("rules");
  return (
    <div className="page">
      <RequestStatus error={error} retry={update} />
      <Header title={t("title")} />
      {!capabilities.ruleProviders && capabilities.kind === "sing-box" && (
        <ProviderNote />
      )}
      <div className="page-toolbar">
        <RuleSearch value={search} onChange={setSearch} />
      </div>
      <RuleProviders />
      <Card className="flex flex-1 flex-col overflow-hidden p-0 focus:outline-none">
        <div className="table-header rule-header">
          <div className="w-44">{t("columns.type")}</div>
          <div className="flex-1">{t("columns.payload")}</div>
          <div className="w-56 text-right">{t("columns.proxy")}</div>
        </div>
        {/* CSS-only bounds: flex basis 0 sizes the box from the card's
            remaining space after the header, never from row content. */}
        <div className="rule-list-box">
          <List
            style={{ height: "100%", width: "100%" }}
            rowCount={rules.length}
            rowHeight={50}
            rowComponent={RuleRow}
            rowProps={{ rules }}
          />
        </div>
      </Card>
    </div>
  );
}

function ProviderNote() {
  const { t } = useTranslation("runtime");
  return (
    <p className="my-3 text-sm text-muted-foreground">
      {t("providerUnavailable")}
    </p>
  );
}
function RuleSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t: tc } = useTranslation("common");
  return (
    <Input
      aria-label={tc("search")}
      placeholder={tc("search")}
      align="left"
      className="flex-1"
      value={value}
      onChange={onChange}
    />
  );
}
