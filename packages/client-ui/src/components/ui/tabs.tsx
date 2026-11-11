import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const TabsContext = React.createContext<{
  variant?: "default" | "pills" | "line" | "solid";
  size?: "sm" | "default" | "lg";
}>({
  variant: "default",
  size: "default",
});

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-3 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "inline-flex w-fit max-w-full items-center select-none group/tabs-list group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "gap-1 rounded-xl bg-inset/70 dark:bg-muted/40 p-1 border border-border/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] backdrop-blur-xs",
        pills:
          "gap-1 rounded-xl bg-inset/70 dark:bg-muted/40 p-1 border border-border/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] backdrop-blur-xs",
        line: "w-full gap-6 rounded-none border-b border-border/50 bg-transparent p-0",
        solid:
          "gap-1 rounded-xl bg-inset/70 dark:bg-muted/40 p-1 border border-border/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] backdrop-blur-xs",
      },
      size: {
        sm: "text-xs",
        default: "text-xs xl:text-sm",
        lg: "text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsContext.Provider
      value={{ variant: variant ?? "default", size: size ?? "default" }}
    >
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        data-size={size}
        className={cn(tabsListVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </TabsContext.Provider>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { variant, size } = React.useContext(TabsContext);

  const isLine = variant === "line";
  const isSolid = variant === "solid";

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-auto items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-150 ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-40 optical-center [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        // Line variant
        isLine && [
          "rounded-none bg-transparent px-1 pb-2.5 pt-1.5 max-md:min-h-11 text-muted-foreground hover:text-foreground",
          "data-[state=active]:font-semibold data-[state=active]:text-foreground",
          "after:absolute after:bottom-0 after:inset-x-0 after:h-[2px] after:rounded-full after:bg-brand after:transition-transform after:duration-200 after:ease-out after:scale-x-0 data-[state=active]:after:scale-x-100",
        ],
        // Pills / Default variant (Brand accent)
        !isLine &&
          !isSolid && [
            "rounded-lg text-muted-foreground hover:text-foreground hover:bg-card/40 active:scale-[0.98]",
            size === "sm"
              ? "min-h-[24px] px-2.5 py-0.5 text-xs max-md:min-h-10 max-md:px-3.5"
              : size === "lg"
                ? "min-h-9 px-4 py-1.5 text-sm rounded-xl"
                : "min-h-7 px-3 py-1 text-xs xl:text-sm max-md:min-h-10 max-md:px-4",
            "data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-brand-text data-[state=active]:shadow-2xs data-[state=active]:shadow-brand/10 data-[state=active]:ring-1 data-[state=active]:ring-brand/35",
            "dark:data-[state=active]:bg-brand-soft dark:data-[state=active]:text-brand-text dark:data-[state=active]:ring-brand/40",
          ],
        // Solid variant (Clean monochrome card)
        isSolid && [
          "rounded-lg text-muted-foreground hover:text-foreground hover:bg-card/40 active:scale-[0.98]",
          size === "sm"
            ? "min-h-[24px] px-2.5 py-0.5 text-xs max-md:min-h-10 max-md:px-3.5"
            : size === "lg"
              ? "min-h-9 px-4 py-1.5 text-sm rounded-xl"
              : "min-h-7 px-3 py-1 text-xs xl:text-sm max-md:min-h-10 max-md:px-4",
          "data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-2xs data-[state=active]:ring-1 data-[state=active]:ring-black/5 dark:data-[state=active]:ring-white/10 dark:data-[state=active]:shadow-black/25",
        ],
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-w-0 flex-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:duration-150",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
