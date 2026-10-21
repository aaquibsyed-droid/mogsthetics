"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side = "center",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "center" | "bottom";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden border border-rule bg-paper shadow-2xl focus:outline-none",
          side === "center"
            ? "left-1/2 top-1/2 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[20px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            : "inset-x-0 bottom-0 rounded-t-[24px] sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            <D.Title className="label-head text-lg">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-ink-soft">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{String(title)}</D.Description>
            )}
          </div>
          <D.Close className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-surface-2" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
