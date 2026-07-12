/**
 * @jamroom/config — Tailwind preset com os design tokens do JAMROOM.
 *
 * Fonte: docs/layoutDesc_extracted.txt (Design System e Guia de Interface) + docs/layout.png.
 *
 * Uso em outros pacotes/apps (tailwind.config.js):
 *   module.exports = {
 *     presets: [require('@jamroom/config/tailwind-preset')],
 *     content: [...],
 *   }
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Fundo da aplicação (dark, "deve respirar")
        background: {
          DEFAULT: "#09090B", // Background principal
          secondary: "#121216", // Background secundário
        },
        // Cards e superfícies elevadas
        surface: {
          DEFAULT: "#18181B", // Cards
          elevated: "#202024", // Superfície elevada (modais, popovers, dropdowns)
        },
        // Bordas discretas usadas em cards/inputs/divisores
        border: {
          DEFAULT: "#2A2A32",
        },
        // Texto
        foreground: {
          DEFAULT: "#FFFFFF", // Texto principal
          muted: "#B3B3BC", // Texto secundário
        },
        // Cor primária (roxo moderno) — botões principais, links, foco, indicadores ativos
        primary: {
          DEFAULT: "#7C3AED",
          hover: "#8B5CF6", // levemente mais claro, usado no hover
          foreground: "#FFFFFF",
        },
        // Cor secundária (azul) — usar apenas em detalhes
        secondary: {
          DEFAULT: "#3B82F6",
          foreground: "#FFFFFF",
        },
        // Estados semânticos
        success: {
          DEFAULT: "#22C55E",
          foreground: "#09090B",
        },
        warning: {
          DEFAULT: "#FACC15",
          foreground: "#09090B",
        },
        error: {
          DEFAULT: "#EF4444",
          foreground: "#FFFFFF",
        },
        // Alias para ações destrutivas (botão "Danger")
        danger: {
          DEFAULT: "#EF4444",
          foreground: "#FFFFFF",
        },
      },
      borderRadius: {
        // Radius nunca reto — escala documentada: inputs 14 / base-botões 16 / cards grandes 20
        sm: "14px", // inputs
        md: "16px", // botões, radius padrão dos componentes
        lg: "20px", // cards grandes
      },
      spacing: {
        // Grid de 8px — espaçamentos comuns documentados, como aliases nomeados
        "2": "8px",
        "4": "16px",
        "6": "24px",
        "8": "32px",
        "12": "48px",
        "16": "64px",
        "24": "96px",
      },
      fontFamily: {
        // Fonte única do sistema. Inter como principal, com fallbacks documentados.
        sans: [
          "Inter",
          "Manrope",
          "Plus Jakarta Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        // Hierarquia tipográfica documentada
        hero: ["76px", { lineHeight: "1.05", fontWeight: "700" }], // Hero: 72~80px
        title: ["40px", { lineHeight: "1.15", fontWeight: "700" }], // Título: 40px
        subtitle: ["24px", { lineHeight: "1.3", fontWeight: "600" }], // Subtítulo: 24px
        body: ["16px", { lineHeight: "1.5", fontWeight: "400" }], // Texto: 16px
        caption: ["14px", { lineHeight: "1.4", fontWeight: "400" }], // Legenda: 14px
      },
      boxShadow: {
        // Sombras suaves, nunca pesadas
        soft: "0 10px 30px rgba(0, 0, 0, 0.25)",
      },
      transitionDuration: {
        DEFAULT: "250ms", // microinterações: 200ms a 300ms
      },
      transitionTimingFunction: {
        DEFAULT: "ease-out",
      },
      minHeight: {
        input: "48px", // altura mínima dos inputs
      },
      backdropBlur: {
        glass: "8px", // glassmorphism: blur pequeno, nunca exagerado
      },
    },
  },
  plugins: [],
};
