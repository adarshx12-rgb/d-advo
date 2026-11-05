import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "./cn";

export const Tabs = T.Root;
/* Outer rounded-xl (12px) with 4px padding gives the inner tab 12 - 4 = 8px (rounded-lg), per the nested radius formula. */
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.List>) {
  return <T.List className={cn("inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "button-sm rounded-lg px-3 py-1 text-ink-soft transition-colors duration-300 ease-base hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan active:scale-[0.98] data-[state=active]:bg-surface-raised data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = T.Content;
