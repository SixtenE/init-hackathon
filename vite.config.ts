import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// @dimforge/rapier3d-compat 0.19.x still calls wasm-bindgen init with the
// embedded bytes as a positional argument. Recent wasm-bindgen expects
// { module_or_path } and warns otherwise. Fixed upstream in 0.20.0, but
// @react-three/rapier 2.2.0 still pins 0.19.2.
function rapierCompatInitPlugin(): Plugin {
  const rewrite = (code: string) => {
    if (!code.includes('using deprecated parameters for the initialization function')) {
      return null
    }

    const next = code
      .replace(
        /yield (\w+)\(lg\.toByteArray\(/,
        'yield $1({module_or_path:lg.toByteArray(',
      )
      .replace('.buffer)}))}', '.buffer})}))}')

    return next === code ? null : next
  }

  return {
    name: 'rapier-compat-init',
    transform(code, id) {
      if (!id.includes('rapier3d-compat')) {
        return null
      }

      const next = rewrite(code)
      return next ? { code: next, map: null } : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    rapierCompatInitPlugin(),
  ],
  optimizeDeps: {
    rolldownOptions: {
      plugins: [rapierCompatInitPlugin()],
    },
  },
  // Production assets are copied to dist/ and served by the C++ game server.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
})
