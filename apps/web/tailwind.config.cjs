/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,css}", "./index.html"],
  // Lit shadow roots: full preflight resets Concorde/native controls in every host.
  corePlugins: {
    preflight: false,
  },
  theme: {
    borderRadius: {
      none: "0",
      sm: "var(--sc-rounded-sm, 0.15rem)",
      DEFAULT: "var(--sc-rounded, 0.2rem)",
      md: "var(--sc-rounded-md, 0.3rem)",
      lg: "var(--sc-rounded-lg, 0.4rem)",
      xl: "var(--sc-rounded-xl, 0.5rem)",
      full: "9999px",
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      content: "var(--sc-base-content)",
      neutral: {
        0: "var(--sc-base)",
        50: "var(--sc-base-50)",
        100: "var(--sc-base-100)",
        200: "var(--sc-base-200)",
        300: "var(--sc-base-300)",
        400: "var(--sc-base-400)",
        500: "var(--sc-base-500)",
        600: "var(--sc-base-600)",
        700: "var(--sc-base-700)",
        800: "var(--sc-base-800)",
        900: "var(--sc-base-900)",
        content: "var(--sc-base-content)",
      },
      primary: {
        DEFAULT: "var(--sc-primary)",
        content: "var(--sc-primary-content)",
      },
      success: {
        DEFAULT: "var(--sc-success)",
        content: "var(--sc-success-content)",
      },
      danger: {
        DEFAULT: "var(--sc-danger)",
        content: "var(--sc-danger-content)",
      },
      warning: {
        DEFAULT: "var(--sc-warning)",
        content: "var(--sc-warning-content)",
      },
      info: {
        DEFAULT: "var(--sc-info)",
        content: "var(--sc-info-content)",
      },
    },
    extend: {
      fontFamily: {
        ui: ["var(--gl-font-ui)"],
        mono: ["var(--gl-font-mono)"],
        display: ["var(--gl-font-display)"],
        body: ["var(--sc-font-family-base)"],
        headings: ["var(--sc-headings-font-family)"],
      },
      spacing: {
        touch: "var(--gl-touch, 44px)",
      },
    },
  },
  plugins: [require("@tailwindcss/container-queries")],
};
