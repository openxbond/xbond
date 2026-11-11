import { useTranslation } from "react-i18next";

import { errorKind } from "@/hooks/use-action";
import { useAPIInfo } from "@/state/controller-target";

import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

export function RequestStatus({
  error,
  retry,
  isLocal,
}: {
  error: unknown;
  retry: () => unknown;
  isLocal?: boolean;
}) {
  const { t } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const { targetKind } = useAPIInfo();
  if (!error) return null;
  const local = isLocal ?? targetKind === "daemon";
  return (
    <Alert variant="destructive" className="my-3">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t(errorKind(error, local))}</span>
        <Button size="sm" variant="outline" onClick={() => void retry()}>
          {tc("retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
