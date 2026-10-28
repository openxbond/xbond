import { Button } from "@components/Button";
import { errorKind } from "@lib/actions";
import { useI18n } from "@stores/jotai";

export function RequestStatus({
  error,
  retry,
}: {
  error: unknown;
  retry: () => unknown;
}) {
  const { translation } = useI18n();
  const { t } = translation("Runtime");
  if (!error) return null;
  return (
    <div
      role="alert"
      className="my-3 flex flex-wrap items-center gap-3 text-sm text-destructive"
    >
      <span>{t(errorKind(error))}</span>
      <Button
        onClick={() => {
          void retry();
        }}
      >
        {t("retry")}
      </Button>
    </div>
  );
}
