// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Cairo', 'system-ui', 'sans-serif'] },
      minHeight: { touch: '56px' },
      minWidth: { touch: '56px' },
    },
  },
  // Tailwind logical utilities (ms-*, me-*, ps-*, pe-*, start-*, end-*)
  // are direction-aware out of the box. Physical utilities are banned by lint.
  plugins: [],
} satisfies Config;
