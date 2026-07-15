import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kantai/ui", "@kantai/shared-types"],
  // Next 16 bloqueia assets de dev acessados por outra origem (ex: abrir a
  // tela da TV pelo IP da máquina). Se o IP mudar (DHCP), atualizar aqui.
  allowedDevOrigins: ["192.168.15.14"],
};

export default nextConfig;
