import type { SVGProps } from "react";

/**
 * Ícones inline no estilo Lucide (traço fino, sem preenchimento, sem cor
 * própria — herdam `currentColor`), conforme docs/layoutDesc_extracted.txt
 * ("Ícones" — traço fino, nunca coloridos). Não há dependência de pacote de
 * ícones instalada no monorepo, então os poucos SVGs usados na landing page
 * são reproduzidos aqui manualmente.
 */
export type IconProps = SVGProps<SVGSVGElement>;

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

export function MusicNoteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function SmartphoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function PlayCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <path d="M12 2.5l2.9 6.06 6.6.83-4.86 4.5 1.28 6.53L12 17.14l-5.92 3.28 1.28-6.53-4.86-4.5 6.6-.83L12 2.5Z" />
    </svg>
  );
}

export function QrCodeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
    </svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a3 3 0 0 0 3 5" />
      <path d="M17 5h3a3 3 0 0 1-3 5" />
    </svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <path d="M3 8.5 7 11l5-6.5L17 11l4-2.5L19.5 18h-15L3 8.5Z" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 8.5a16 16 0 0 1 20 0" />
      <path d="M5.5 12a11 11 0 0 1 13 0" />
      <path d="M9 15.5a6 6 0 0 1 6 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BatteryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="7" width="18" height="10" rx="2" />
      <path d="M22 10v4" />
      <rect x="4" y="9" width="12" height="6" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function YoutubeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="3.5" />
      <path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TwitterXIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l16 16M20 4L4 20" />
    </svg>
  );
}
