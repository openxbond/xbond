import { Header, Card, Input } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import type * as API from "@lib/request";
import { useI18n, useRule, useRuleProviders, useCapabilities } from "@stores";
import { useState } from "react";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { List, type RowComponentProps } from "react-window";

import { Provider } from "./Provider";

import "./style.scss";

function RuleProviders() {
  const { providers, error, update } = useRuleProviders();
  const { translation } = useI18n();
  const { t } = translation("Rules");

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
      <div className="flex py-1">
        <div className="rule-type w-40 text-center">{rule.type}</div>
        <div className="payload flex-1 text-center">{rule.payload}</div>
        <div className="rule-proxy w-40 text-center">{rule.proxy}</div>
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
  const { translation } = useI18n();
  const { t } = translation("Rules");
  return (
    <div className="page">
      <RequestStatus error={error} retry={update} />
      {!capabilities.ruleProviders && capabilities.kind === "sing-box" && (
        <ProviderNote />
      )}
      <RuleProviders />
      <RuleSearch value={search} onChange={setSearch} />
      <Header className="not-first:mt-7.5" title={t("title")} />
      <Card className="mt-2.5 flex flex-1 flex-col p-0 md:mt-4 focus:outline-none">
        <AutoSizer
          className="min-h-120"
          renderProp={({ height, width }) => (
            <List
              style={{ height: height ?? 0, width: width ?? 0 }}
              rowCount={rules.length}
              rowHeight={50}
              rowComponent={RuleRow}
              rowProps={{ rules }}
            />
          )}
        />
      </Card>
    </div>
  );
}

function ProviderNote() {
  const { translation } = useI18n();
  const { t } = translation("Runtime");
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
  const { translation } = useI18n();
  const { t } = translation("Runtime");
  return (
    <Input
      aria-label={t("search")}
      placeholder={t("search")}
      align="left"
      className="my-3"
      value={value}
      onChange={onChange}
    />
  );
}
