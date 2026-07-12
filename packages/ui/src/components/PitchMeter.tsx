"use client";

import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Barra de afinação ao vivo, compartilhada entre a tela host (TV) e o app
 * do participante: um trilho com marca central (tom certo) e um marcador
 * que desliza conforme a distância em semitons detectada.
 */
export interface PitchMeterProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Distância em semitons até a nota de referência (null = sem voz/nota). */
  centsOff: number | null;
  /** Se o frame atual conta como acerto. */
  hit: boolean;
  /** Texto exibido enquanto não há voz detectada. */
  idleLabel?: string;
  hitLabel?: string;
  adjustLabel?: string;
}

/** Quantos semitons de desvio deslocam o marcador até a borda. */
const RANGE_SEMITONES = 3;

export const PitchMeter = React.forwardRef<HTMLDivElement, PitchMeterProps>(
  (
    {
      className,
      centsOff,
      hit,
      idleLabel = "aguardando voz...",
      hitLabel = "afinado!",
      adjustLabel = "ajuste o tom",
      ...props
    },
    ref
  ) => {
    const markerPos =
      centsOff === null
        ? null
        : Math.max(-1, Math.min(1, centsOff / RANGE_SEMITONES));

    return (
      <div ref={ref} className={cn("w-full", className)} {...props}>
        <div className="relative h-3 rounded-full bg-surface-elevated">
          <div className="absolute left-1/2 top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-border" />
          {markerPos !== null && (
            <div
              className={cn(
                "absolute top-1/2 h-8 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
                hit ? "bg-success" : "bg-warning"
              )}
              style={{ left: `${50 + markerPos * 45}%` }}
            />
          )}
        </div>
        <p className="mt-2 text-caption font-semibold uppercase tracking-wider text-foreground-muted">
          {markerPos === null ? idleLabel : hit ? hitLabel : adjustLabel}
        </p>
      </div>
    );
  }
);

PitchMeter.displayName = "PitchMeter";
