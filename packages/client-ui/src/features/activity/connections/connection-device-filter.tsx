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
      // 移動端單行橫向滾動：來源地址（含完整 IPv6）flex-wrap 堆疊時能把
      // 連接列表壓到折疊線以下；漸隱提示還有更多芯片。
      className="max-md:w-full max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-0.5 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]"
      // 軌道 nowrap 後段必須禁 shrink，否則段被壓扁互相疊字
      itemClassName="max-md:shrink-0"
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
