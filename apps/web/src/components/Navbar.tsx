import Link from "next/link";
import { Button } from "@jamroom/ui";

const NAV_LINKS = [
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Recursos", href: "#recursos" },
  { label: "Demonstração", href: "#demo" },
  { label: "Planos", href: "#planos" },
  { label: "FAQ", href: "#faq" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-glass">
      <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-6 sm:px-8 lg:px-16">
        <Link href="#top" className="flex flex-col leading-none">
          <span className="text-lg font-extrabold tracking-tight text-foreground">
            JAM<span className="text-primary">ROOM</span>
          </span>
          <span className="mt-0.5 text-[11px] font-medium tracking-wide text-foreground-muted">
            Everybody sings.
          </span>
        </Link>

        <nav className="hidden items-center gap-10 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-body text-foreground-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="#login"
            className="hidden text-body font-medium text-foreground-muted transition-colors hover:text-foreground sm:inline-block"
          >
            Entrar
          </a>
          <Button variant="primary" className="px-5 py-2.5">
            Criar conta
          </Button>
        </div>
      </div>
    </header>
  );
}
