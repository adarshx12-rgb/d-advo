import type { NextConfig } from "next";

const server = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@hps/shared", "@hps/ui"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const csp = [
      "default-src 'self'",
      `connect-src 'self' ${server} ${server.replace(/^http/, "ws")} https://api.razorpay.com https://lumberjack.razorpay.com`,
      `img-src 'self' data: blob: ${server}`,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // The broadcast overlay must be embeddable (OBS browser source); everything else is not.
      { source: "/((?!room/[^/]+/broadcast).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
};

export default config;
