import {
  selectedControllerAtom,
  useControllers,
  useI18n,
  useSelectController,
} from "@stores";
import { useAtomValue } from "jotai";

import "./style.scss";

export function ControllerPicker() {
  const [controllers] = useControllers();
  const selected = useAtomValue(selectedControllerAtom);
  const select = useSelectController();
  const { translation } = useI18n();
  const { t } = translation("ClientUI");
  return (
    <label className="controller-picker">
      <span>{t("controller")}</span>
      <select value={selected} onChange={(event) => select(event.target.value)}>
        {controllers.map((controller) => (
          <option key={controller.id} value={controller.id}>
            {controller.name
              ? controller.name + " · " + new URL(controller.url).host
              : controller.url}
          </option>
        ))}
      </select>
    </label>
  );
}
