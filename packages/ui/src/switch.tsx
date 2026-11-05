import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "./cn";

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { tone?: "violet" | "chaos" | "teal" }
>(({ className, tone = "violet", ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-line bg-surface-hover p-0.5 transition-colors duration-300 ease-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-stage disabled:cursor-not-allowed disabled:opacity-40",
      tone === "violet" && "data-[state=checked]:border-violet data-[state=checked]:bg-violet",
      tone === "chaos" && "data-[state=checked]:border-chaos data-[state=checked]:bg-chaos",
      tone === "teal" && "data-[state=checked]:border-teal data-[state=checked]:bg-teal",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-ink transition-transform duration-500 ease-base data-[state=checked]:translate-x-4 data-[state=checked]:bg-ink-dark" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
