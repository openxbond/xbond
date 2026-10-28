import { Button } from "@components/Button";
import { errorKind } from "@lib/actions";
import { useTranslation } from "react-i18next";

export function RequestStatus({
  error,
  retry,
}: {
  error: unknown;
  retry: () => unknown;
}) {
  const { t } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
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
        {tc("retry")}
      </Button>
    </div>
  );
}
