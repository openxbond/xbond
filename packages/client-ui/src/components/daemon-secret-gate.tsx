import { AlertCircle, ArrowRight, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { XBondIcon } from "@/components/xbond-icon";
import { useLocalAPI } from "@/state/local-runtime";

/**
 * Unlock gate shown when the daemon serves the web UI with `XBOND_SECRET`
 * configured: no token is embedded in HTML, so the browser collects the
 * Secret, verifies it against `/localapi/v0/status`, and stores it locally.
 */
export function DaemonSecretGate() {
  const { t } = useTranslation("onboarding");
  const { t: s } = useTranslation("settings");
  const { authenticateSecret } = useLocalAPI();
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !secret.trim()) return;
    setError("");
    setPending(true);
    try {
      await authenticateSecret(secret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "unauthorized" || msg.includes("401")) {
        setError(t("unauthorizedTip"));
      } else {
        setError(msg);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-4 py-8">
      <Card className="w-full max-w-md p-6 shadow-elevation-raised sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="relative grid size-11 shrink-0 place-items-center rounded-xl border border-border/80 bg-inset">
            <XBondIcon className="size-6 text-foreground" />
            <span
              aria-hidden="true"
              className="absolute -end-1 -bottom-1 grid size-5 place-items-center rounded-full border border-border bg-card text-brand-text shadow-2xs"
            >
              <LockKeyhole className="size-3" />
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              {t("daemonSecretTitle")}
            </h1>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("daemonSecretDesc")}
            </p>
          </div>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4"
        >
          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="daemon-secret-input"
              className="text-caption font-semibold text-foreground"
            >
              {s("external.secret")}
            </FieldLabel>
            <Input
              id="daemon-secret-input"
              type="password"
              autoFocus
              autoComplete="current-password"
              spellCheck={false}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(error)}
              className="font-mono"
              required
            />
          </Field>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4 shrink-0" />
              <AlertDescription className="text-xs leading-relaxed">
                {error}
              </AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            variant="brand"
            size="lg"
            disabled={pending || !secret.trim()}
            className="w-full"
          >
            {pending ? (
              <>
                <Spinner className="size-4" />
                <span>{s("external.connecting")}</span>
              </>
            ) : (
              <>
                <ArrowRight aria-hidden="true" className="size-4" />
                <span>{t("daemonSecretSubmit")}</span>
              </>
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
