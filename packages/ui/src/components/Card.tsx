import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Superfície elevada padrão do Design System
 * (docs/layoutDesc_extracted.txt — seção "Cards"):
 * background surface, radius grande (20px / `rounded-lg` no preset),
 * padding de 24px (`p-6`, alinhado ao grid de 8) e borda discreta.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border border-border bg-surface p-6 shadow-soft",
          className
        )}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";
