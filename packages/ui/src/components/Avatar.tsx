"use client";

import * as React from "react";
import { cn } from "../utils/cn";

/**
 * Avatar circular com fallback de iniciais quando não há `src` (ou quando
 * a imagem falha ao carregar). Usa `<img>` simples em vez de next/image
 * para manter o pacote agnóstico de framework.
 */
export interface AvatarProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  src?: string | null;
  alt?: string;
  /** Nome usado para derivar as iniciais de fallback (ex: "Daniel Luciano" -> "DL"). */
  name?: string;
  /** Tamanho do avatar em pixels. Padrão: 40. */
  size?: number;
}

function getInitials(name?: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, src, alt = "", name, size = 40, style, ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false);
    const showImage = Boolean(src) && !imgError;
    const initials = getInitials(name);

    return (
      <span
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-surface-elevated font-medium text-foreground-muted",
          className
        )}
        style={{ width: size, height: size, fontSize: size * 0.4, ...style }}
        {...props}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src as string}
            alt={alt}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span aria-hidden={alt ? undefined : true}>{initials || "?"}</span>
        )}
      </span>
    );
  }
);

Avatar.displayName = "Avatar";
