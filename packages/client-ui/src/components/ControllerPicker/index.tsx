import {
  DAEMON_CONTROLLER_ID,
  selectedControllerAtom,
  useControllers,
  useSelectController,
} from "@stores";
import { cn } from "cn";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

export function ControllerPicker({ className }: { className?: string }) {
  const [controllers] = useControllers();
  const selected = useAtomValue(selectedControllerAtom);
  const select = useSelectController();
  const { t } = useTranslation("common");
  return (
    <label
      className={cn(
        "flex min-w-0 flex-col gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>{t("controller")}</span>
      <select
        className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm text-foreground max-md:min-h-11"
        value={selected}
        onChange={(event) => select(event.target.value)}
      >
        {controllers.map((controller) => (
          <option key={controller.id} value={controller.id}>
            {controller.id === DAEMON_CONTROLLER_ID
              ? "XBond"
              : controller.name
                ? controller.name + " · " + new URL(controller.url).host
                : controller.url}
          </option>
        ))}
      </select>
    </label>
  );
}
