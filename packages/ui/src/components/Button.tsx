"use client";

import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Existem apenas quatro variantes de botão no Design System do JAMROOM
 * (docs/layoutDesc_extracted.txt — seção "Botões"):
 * - primary: fundo roxo, texto branco, hover levemente mais claro.
 * - secondary: transparente, borda cinza, hover com background sutil.
 * - ghost: sem borda, sem fundo, apenas texto.
 * - danger: vermelho, usado somente para ações destrutivas.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const baseStyles = cn(
  "inline-flex items-center justify-center gap-2",
  "rounded-md px-6 py-3 text-body font-medium",
  "transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:opacity-50 disabled:pointer-events-none"
);

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "bg-transparent border border-border text-foreground hover:bg-surface/60",
  ghost: "bg-transparent text-foreground hover:bg-surface/40",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(baseStyles, variantStyles[variant], className)}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
