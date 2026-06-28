import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette extracted from onusclub.com. Semantic names so we
        // can swap shades later without touching every component.
        brand: {
          // Dark forest green — sidebar, primary text, primary CTAs.
          green: "#14271C",
          "green-deep": "#0d1c13",
          "green-deepest": "#0a1f12",
          // Warm gold — accents, links, active states, secondary CTAs.
          gold: "#B0894F",
          "gold-light": "#d4a96a",
          // Muted olive — secondary text, dividers.
          olive: "#6e7860",
          // Warm cream — page background.
          cream: "#F4F1E9",
        },
      },
      fontFamily: {
        // next/font sets --font-lato and --font-fraunces in app/layout.tsx.
        sans: ["var(--font-lato)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
      },
      borderRadius: {
        // Matches the mock's softer card radius.
        card: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
