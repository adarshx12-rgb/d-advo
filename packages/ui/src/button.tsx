import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/* Printed buttons: square-ish corners; primary lifts onto a stamp red offset shadow on hover. */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md transition-[background-color,color,border-color,opacity,transform,box-shadow] duration-300 ease-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-stage active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-ink-dark shadow-[0_0_0_0_var(--color-chaos)] hover:-translate-y-0.5 hover:shadow-[0_4px_0_0_var(--color-chaos)]",
        accent: "bg-violet text-ink-dark hover:bg-violet-bright",
        secondary: "border border-ink/80 bg-surface text-ink hover:bg-surface-raised",
        ghost: "text-ink-soft hover:bg-surface-raised hover:text-ink",
        danger: "border border-chaos/50 text-chaos hover:bg-chaos/10",
        evidence: "bg-amber text-ink-dark hover:opacity-90",
        chaos: "bg-chaos text-ink-dark hover:opacity-90",
        live: "bg-cyan text-ink-dark hover:opacity-90",
      },
      size: {
        sm: "button-sm px-3 py-1",
        md: "button-md px-3 py-2",
        lg: "button-lg px-4 py-3 [&_svg]:size-5",
        icon: "size-10 p-2 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
