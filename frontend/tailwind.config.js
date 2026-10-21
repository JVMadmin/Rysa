/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        // Marca medida sobre el isotipo oficial (rojo + carbón).
        brand: {
          50: '#FEF2F2', 100: '#FDE3E3', 200: '#FBC8C8', 300: '#F79A9B', 400: '#EF5A5C',
          500: '#E3191C', 600: '#CF090B', 700: '#A8070A', 800: '#860609', 900: '#5E0406',
          DEFAULT: '#CF090B',
        },
        carbon: {
          700: '#3C3E44', 800: '#2A2B30', 900: '#1F2023', 950: '#141517', DEFAULT: '#1F2023',
        },
        // Neutros derivados del carbón. Reemplazan la escala `slate` de
        // Tailwind para armonizar los ~2,000 usos del ERP sin reescribirlos.
        slate: {
          50: '#F7F7F8', 100: '#EFEFF1', 200: '#E2E3E6', 300: '#CBCDD2', 400: '#9A9DA5',
          500: '#6E717A', 600: '#52555D', 700: '#3C3E44', 800: '#2A2B30', 900: '#1F2023', 950: '#141517',
        },
        ink: '#1F2023',
        canvas: '#F6F6F7',
        // Alias heredado: el ERP usaba "terracota"; ahora apunta a la marca.
        terracota: {
          DEFAULT: '#CF090B',
          dark: '#A8070A',
        },
        chart: {
          '1': '#CF090B',
          '2': '#1F2023',
          '3': '#B45309',
          '4': '#15803D',
          '5': '#6E717A'
        }
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Archivo Variable"', 'Archivo', '"IBM Plex Sans"', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        'display': ['2.75rem', { lineHeight: '1.04', letterSpacing: '-0.012em' }],
        'display-lg': ['3.5rem', { lineHeight: '1.02', letterSpacing: '-0.015em' }],
        'display-xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.018em' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,32,35,0.04), 0 6px 18px rgba(31,32,35,0.05)',
        'card-lg': '0 12px 36px -12px rgba(31,32,35,0.18)',
        raised: '0 18px 50px -18px rgba(20,21,23,0.35)',
      },
      transitionTimingFunction: {
        'out-rysa': 'cubic-bezier(.2,.7,.2,1)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};