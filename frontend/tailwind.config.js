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
        // Guía de diseño (DIRECCION_VISUAL §5): sm 4 px, md 8 px, lg 12 px.
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)'
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
        // Rojo RYSA medido sobre el degradado de la "R" del logotipo:
        // 500 = brillo, 600 = rojo RYSA, 800 = sombra.
        brand: {
          50: '#FDECEC', 100: '#FBD3D3', 200: '#F7B2B3', 300: '#F27A7C', 400: '#EE4A4C',
          500: '#EB0F11', 600: '#CD0708', 700: '#A3060A', 800: '#7A0A0E', 900: '#520709',
          DEFAULT: '#CD0708',
        },
        // Grafito metálico de la "G" del isotipo (no negro): 900 para
        // superficies oscuras grandes (hero, pie), 950 para el menú del ERP.
        carbon: {
          600: '#5A5B60', 700: '#4A4B50', 800: '#3D3E43', 900: '#2E2F34', 950: '#232428', DEFAULT: '#2E2F34',
        },
        // Neutros derivados del carbón. Reemplazan la escala `slate` de
        // Tailwind para armonizar los ~2,000 usos del ERP sin reescribirlos.
        slate: {
          50: '#F5F5F6', 100: '#ECECEE', 200: '#D9DADD', 300: '#BFC0C4', 400: '#8A8C92',
          500: '#6B6D73', 600: '#52545A', 700: '#3D3E43', 800: '#2E2F34', 900: '#18191D', 950: '#101115',
        },
        ink: '#18191D',
        canvas: '#F5F5F6',
        // Alias heredado: el ERP usaba "terracota"; ahora apunta a la marca.
        terracota: {
          DEFAULT: '#CD0708',
          dark: '#A3060A',
        },
        chart: {
          '1': '#CD0708',
          '2': '#2E2F34',
          '3': '#B45309',
          '4': '#15803D',
          '5': '#6B6D73'
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