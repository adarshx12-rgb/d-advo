import * as React from "react";
import { Dialog as D } from "radix-ui";
import { cn } from "./cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: React.ComponentPropsWithoutRef<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-stage-deep/70 backdrop-blur-sm data-[state=open]:animate-[fade-in_300ms_var(--ease-base)]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-48px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 focus:outline-none data-[state=open]:animate-[pop-in_500ms_var(--ease-base)]",
          className,
        )}
        {...props}
      >
        <D.Title className="heading-5 text-ink">{title}</D.Title>
        {description ? <D.Description className="body-6 mt-2 text-ink-soft">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-6">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
