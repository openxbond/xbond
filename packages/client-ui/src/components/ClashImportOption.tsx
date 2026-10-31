import { Checkbox } from "@components/Checkbox";
import { useTranslation } from "react-i18next";

export function ClashImportOption({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation("subscriptions");
  return (
    <Checkbox
      className="py-2 text-sm"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    >
      <span>
        <span className="block">{t("clashNodesOnly")}</span>
        <span className="block" style={{ color: "var(--muted-foreground)" }}>
          {t("clashNodesOnlyHint")}
        </span>
      </span>
    </Checkbox>
  );
}
