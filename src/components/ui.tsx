import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A small set of hand-rolled primitives.
 *
 * Deliberately not a component library: the app needs six shapes, and owning
 * them keeps the dependency surface (and the bundle) small while still giving
 * one consistent visual language across the dashboard, viewer, and share page.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

/**
 * Exported separately so anchors and Links can wear the same styles without
 * nesting interactive elements inside a <button>.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-accent text-accent-foreground hover:opacity-90",
    variant === "secondary" &&
      "border border-border bg-surface text-foreground hover:bg-surface-muted",
    variant === "ghost" && "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
    variant === "danger" && "bg-danger text-white hover:opacity-90",
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-surface", className)}
      {...props}
    />
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-muted text-muted-foreground",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "accent" && "bg-accent-soft text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "danger",
  children,
  className,
}: {
  tone?: "danger" | "warning" | "success";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
        tone === "warning" && "border-warning/30 bg-warning-soft text-warning",
        tone === "success" && "border-success/30 bg-success-soft text-success",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
      {initials || "?"}
    </span>
  );
}
