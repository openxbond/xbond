import { useTranslation } from "react-i18next";

import { errorKind } from "@/hooks/use-action";

import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

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
    <Alert variant="destructive" className="my-3">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t(errorKind(error))}</span>
        <Button size="sm" variant="outline" onClick={() => void retry()}>
          {tc("retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
