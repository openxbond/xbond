import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@/components/segmented-control";
import { Badge } from "@/components/ui/badge";

interface DevicesProps {
  devices: Array<{ label: string; number: number }>;
  selected: string;
  onChange: (label: string) => void;
}

export function Devices({ devices, selected, onChange }: DevicesProps) {
  const { t } = useTranslation("connections");

  return (
    <SegmentedControl
      ariaLabel={t("columns.sourceIP")}
      value={selected ? "device:" + selected : "all"}
      onChange={(value) =>
        onChange(value === "all" ? "" : value.slice("device:".length))
      }
      options={[
        { value: "all", label: t("filterAll") },
        ...devices.map((device) => ({
          value: "device:" + device.label,
          label: (
            <>
              {device.label}
              <Badge variant="secondary" className="tabular-nums">
                {device.number}
              </Badge>
            </>
          ),
        })),
      ]}
    />
  );
}
