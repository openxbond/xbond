import { FileText, FileUp, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

/**
 * 文件选择原語：整卡可點的觸發器，取代原生 file input 的裸用——
 * 原生控件在移動端渲染成不可辨認的系統文案框，實際熱區也不足 44px。
 * 底層仍是原生 input（sr-only），鍵盤與讀屏照常可用；桌面另支持拖放。
 * 未選用中性底與動作引導，已選用柔桃底細橙環（DESIGN segment-selected 語彙）。
 */
function FileField({
  id,
  value,
  onChange,
  accept,
  labelAction,
  removeLabel,
  disabled = false,
  required = false,
  className,
  ...props
}: Omit<React.ComponentProps<"label">, "htmlFor" | "onChange"> & {
  id: string;
  value: File | null;
  onChange: (file: File | null) => void;
  /** 逗號分隔的副檔名列表；同時渲染成卡內格式說明，不另設文案 */
  accept?: string;
  /** 未選時的主文案（動作引導），如「點按選擇文件」 */
  labelAction: string;
  /** 移除按鈕的可讀名稱 */
  removeLabel: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const extensions = React.useMemo(
    () =>
      accept
        ?.split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    [accept],
  );
  const selected = !!value;

  function clear(event: React.MouseEvent) {
    // 卡片本身是 <label>，阻止默認行為以免重開選擇器
    event.preventDefault();
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
  }

  function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onChange(file);
  }

  return (
    <label
      data-slot="file-field"
      data-selected={selected}
      htmlFor={id}
      className={cn(
        "field-glass group/file relative flex w-full cursor-pointer items-center gap-3 rounded-control px-3.5 py-2.5 max-md:gap-3.5 max-md:min-h-14 max-md:px-4 max-md:py-3 min-h-11 transition-colors",
        "hover:border-muted-foreground active:bg-inset",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-ring",
        "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50",
        selected && "border-brand/40 bg-card ring-1 ring-brand/35",
        dragging && "border-brand/60 bg-inset/60 ring-1 ring-brand/45",
        className,
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={disabled ? undefined : drop}
      {...props}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        required={required}
        disabled={disabled}
        aria-label={labelAction}
        className="sr-only"
        onChange={(event) => {
          // 取消選擇器時不回調，保留原值
          const file = event.target.files?.[0];
          if (file) onChange(file);
        }}
      />
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-control bg-inset text-muted-foreground [&_svg]:size-5",
          selected && "bg-card text-brand-text",
        )}
      >
        {selected ? <FileText /> : <FileUp />}
      </span>
      <span className="min-w-0 flex-1">
        {selected ? (
          <>
            <span className="block truncate text-sm leading-snug font-medium text-foreground max-md:text-base">
              {value?.name}
            </span>
            <span className="block text-caption leading-normal text-muted-foreground">
              {value ? formatBytes(value.size) : null}
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm leading-snug text-foreground max-md:text-base">
              {labelAction}
            </span>
            {extensions?.length ? (
              <span className="block truncate text-caption leading-normal text-muted-foreground">
                {extensions.join(" · ")}
              </span>
            ) : null}
          </>
        )}
      </span>
      {selected && (
        <button
          type="button"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={clear}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-inset hover:text-foreground active:scale-95 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:size-11 [&_svg]:size-4"
        >
          <X />
        </button>
      )}
    </label>
  );
}

export { FileField };
