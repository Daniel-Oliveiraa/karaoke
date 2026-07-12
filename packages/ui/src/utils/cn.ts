/**
 * Helper minimalista para mesclar class names condicionalmente,
 * sem depender de `clsx`/`tailwind-merge` (não instalados no monorepo).
 *
 * Uso: cn("base-classes", condition && "conditional-class", props.className)
 */
export type ClassValue = string | number | null | undefined | false;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
