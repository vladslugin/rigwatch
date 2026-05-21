/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', "class"],
  theme: {
  	extend: {
  		screens: {
  			xs: '480px'
  		},
  		colors: {
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent)',
  				foreground: 'var(--accent-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			success: {
  				DEFAULT: 'var(--success)',
  				foreground: 'var(--success-foreground)'
  			},
  			warning: {
  				DEFAULT: 'var(--warning)',
  				foreground: 'var(--warning-foreground)'
  			},
  			info: {
  				DEFAULT: 'var(--info)',
  				foreground: 'var(--info-foreground)'
  			},
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			chart: {
  				'1': 'var(--chart-1)',
  				'2': 'var(--chart-2)',
  				'3': 'var(--chart-3)',
  				'4': 'var(--chart-4)',
  				'5': 'var(--chart-5)'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			'section-header': {
  				DEFAULT: 'var(--section-header)',
  				foreground: 'var(--section-header-foreground)'
  			},
  			terminal: {
  				DEFAULT: 'var(--terminal)',
  				foreground: 'var(--terminal-foreground)',
  				header: 'var(--terminal-header)',
  				border: 'var(--terminal-border)',
  				prompt: 'var(--terminal-prompt)',
  				command: 'var(--terminal-command)',
  				error: 'var(--terminal-error)',
  				success: 'var(--terminal-success)',
  				warning: 'var(--terminal-warning)'
  			},
  			status: {
  				online: 'var(--status-online)',
  				offline: 'var(--status-offline)',
  				connecting: 'var(--status-connecting)'
  			},
  			alarm: {
  				high: 'var(--alarm-high)',
  				low: 'var(--alarm-low)',
  				pulse: 'var(--alarm-pulse)'
  			},
  			'custom-gray': '#7f8c8d',
  			'app-bg': 'var(--background)',
  			'card-bg': 'var(--card)',
  			'app-text': 'var(--foreground)',
  			'app-border': 'var(--border)',
  			'input-border': 'var(--input)'
  		},
  		borderRadius: {
  			'theme-sm': 'var(--radius-sm)',
  			'theme-md': 'var(--radius-md)',
  			theme: 'var(--radius)',
  			'theme-lg': 'var(--radius-lg)',
  			'theme-xl': 'var(--radius-xl)',
  			'theme-full': 'var(--radius-full)',
  			'legacy-sm': '3px',
  			'legacy-md': '5px',
  			'legacy-lg': '7px'
  		},
  		boxShadow: {
  			'theme-2xs': 'var(--shadow-2xs)',
  			'theme-xs': 'var(--shadow-xs)',
  			'theme-sm': 'var(--shadow-sm)',
  			theme: 'var(--shadow)',
  			'theme-md': 'var(--shadow-md)',
  			'theme-lg': 'var(--shadow-lg)',
  			'theme-xl': 'var(--shadow-xl)',
  			'theme-2xl': 'var(--shadow-2xl)',
  			'legacy-sm': '0 1px 2px rgba(0,0,0,0.07)',
  			'legacy-md': '0 2px 4px rgba(0,0,0,0.08)',
  			'legacy-lg': '0 5px 10px rgba(0,0,0,0.1)',
  			'glow-primary': '0 0 0 1px rgba(59,130,246,0.4), 0 0 24px -4px rgba(59,130,246,0.45)',
  			'glow-success': '0 0 0 1px rgba(34,197,94,0.35), 0 0 20px -4px rgba(34,197,94,0.4)',
  			'glow-destructive': '0 0 0 1px rgba(244,63,94,0.4), 0 0 20px -4px rgba(244,63,94,0.45)',
  			'glow-info': '0 0 0 1px rgba(56,189,248,0.35), 0 0 20px -4px rgba(56,189,248,0.4)'
  		},
  		fontFamily: {
  			sans: [
  				'var(--font-sans)'
  			],
  			mono: [
  				'var(--font-mono)'
  			],
  			serif: [
  				'var(--font-serif)'
  			]
  		},
  		spacing: {
  			'theme-xs': 'var(--spacing-xs)',
  			'theme-sm': 'var(--spacing-sm)',
  			'theme-md': 'var(--spacing-md)',
  			'theme-lg': 'var(--spacing-lg)',
  			'theme-xl': 'var(--spacing-xl)',
  			'theme-2xl': 'var(--spacing-2xl)',
  			'legacy-xs': '4px',
  			'legacy-sm': '8px',
  			'legacy-md': '12px',
  			'legacy-lg': '18px',
  			'legacy-xl': '24px'
  		},
  		transitionDuration: {
  			'theme-fast': '150ms',
  			'theme-normal': '250ms',
  			'theme-slow': '350ms'
  		},
  		fontSize: {
  			'legacy-base': '14px'
  		},
  		animation: {
  			'slide-up': 'slide-up 0.3s ease-out',
  			'fade-in': 'fade-in 0.2s ease-out',
  			'bounce-in': 'bounce-in 0.4s ease-out'
  		},
  		keyframes: {
  			'slide-up': {
  				'0%': {
  					transform: 'translateY(100%)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'translateY(0)',
  					opacity: '1'
  				}
  			},
  			'fade-in': {
  				'0%': {
  					opacity: '0'
  				},
  				'100%': {
  					opacity: '1'
  				}
  			},
  			'bounce-in': {
  				'0%': {
  					transform: 'scale(0.9)',
  					opacity: '0'
  				},
  				'50%': {
  					transform: 'scale(1.05)',
  					opacity: '0.7'
  				},
  				'100%': {
  					transform: 'scale(1)',
  					opacity: '1'
  				}
  			}
  		}
  	}
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};
