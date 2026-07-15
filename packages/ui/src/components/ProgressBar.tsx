import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Barra de progresso fina com o gradiente primário do Kantaí.
 * Usada no player da TV e na tela de canto do participante.
 */
export interface ProgressBarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Progresso de 0 a 1 (valores fora do intervalo são grampeados). */
  value: number;
}

export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ className, value, ...props }, ref) => {
    const clamped = Math.min(1, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        className={cn(
          "h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated",
          className
        )}
        {...props}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    );
  }
);

ProgressBar.displayName = "ProgressBar";
