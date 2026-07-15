import { Button } from "@kantai/ui";
import {
  InstagramIcon,
  PlusIcon,
  TwitterXIcon,
  YoutubeIcon,
} from "./icons";

const FOOTER_COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Produto",
    links: [
      { label: "Como funciona", href: "#como-funciona" },
      { label: "Recursos", href: "#recursos" },
      { label: "Demonstração", href: "#demo" },
      { label: "Planos", href: "#planos" },
    ],
  },
  {
    title: "Suporte",
    links: [
      { label: "Perguntas frequentes", href: "#faq" },
      { label: "Fale conosco", href: "mailto:contato@kantai.online" },
      { label: "Para empresas e eventos", href: "#planos" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Termos de uso", href: "#" },
      { label: "Privacidade", href: "#" },
      { label: "Licenciamento musical", href: "#" },
    ],
  },
];

const SOCIALS = [
  { label: "Instagram", href: "#", icon: InstagramIcon },
  { label: "YouTube", href: "#", icon: YoutubeIcon },
  { label: "X (Twitter)", href: "#", icon: TwitterXIcon },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background-secondary">
      {/* CTA final antes do rodapé */}
      <div className="px-6 py-20 sm:px-8 lg:px-16">
        <div className="mx-auto max-w-[1440px]">
          <div
            className="relative overflow-hidden rounded-lg border border-border px-8 py-14 text-center shadow-soft sm:px-16"
            style={{
              background:
                "radial-gradient(80% 120% at 50% 0%, rgba(124,58,237,0.25), transparent 60%), #18181B",
            }}
          >
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-foreground sm:text-title">
              Pronto para transformar sua próxima festa?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-body leading-relaxed text-foreground-muted">
              Crie sua primeira Jam em menos de um minuto. Sem instalação, sem
              assinatura.
            </p>
            <Button variant="primary" className="mt-8 gap-2.5 px-6 py-3.5">
              <PlusIcon className="h-5 w-5" />
              Criar Jam agora
            </Button>
          </div>
        </div>
      </div>

      {/* colunas do rodapé */}
      <div className="px-6 pb-12 sm:px-8 lg:px-16">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid grid-cols-1 gap-12 border-t border-border pt-12 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <p className="text-lg font-extrabold tracking-tight text-foreground">
                KAN<span className="text-primary">TAÍ</span>
              </p>
              <p className="mt-1 text-caption text-foreground-muted">
                Aumenta o som e Kantaí.
              </p>
              <p className="mt-4 max-w-xs text-caption leading-relaxed text-foreground-muted">
                Karaokê colaborativo com pontuação por voz real, direto na sua
                TV e no celular de todo mundo.
              </p>
              <div className="mt-6 flex items-center gap-3">
                {SOCIALS.map(({ label, href, icon: Icon }) => (
                  <a
                    key={label}
                    href={href}
                    aria-label={label}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </a>
                ))}
              </div>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="text-caption font-semibold uppercase tracking-wider text-foreground">
                  {column.title}
                </h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-caption text-foreground-muted transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
            <p className="text-caption text-foreground-muted">
              © {new Date().getFullYear()} Kantaí. Todos os direitos
              reservados.
            </p>
            <p className="text-caption text-foreground-muted">
              Feito no Brasil 🇧🇷
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
