import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        radar: {
          purple: "#6B4FBB",
          plum: "#4F378D",
          cloud: "#F4F1FB",
          ink: "#1F1833",
        },
      },
      boxShadow: {
        glow: "0 24px 80px rgba(76, 48, 143, 0.24)",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["IBM Plex Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
