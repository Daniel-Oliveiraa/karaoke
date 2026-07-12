import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Badge pequeno para status/tags. Variantes semânticas baseadas nas
 * cores de estado do preset (`success`, `warning`, `error`) mais um
 * `neutral` para tags sem carga semântica.
 */
export type BadgeVariant = "success" | "warning" | "error" | "neutral";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success/10 text-success border border-success/20",
  warning: "bg-warning/10 text-warning border border-warning/20",
  error: "bg-error/10 text-error border border-error/20",
  neutral: "bg-surface-elevated text-foreground-muted border border-border",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "neutral", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium leading-none",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";
