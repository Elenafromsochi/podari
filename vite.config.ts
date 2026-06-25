// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// По умолчанию сборка идёт под Cloudflare (как было). Чтобы собрать приложение
// под обычный Node-сервер (для self-hosted на российском сервере Timeweb),
// задаём переменную окружения при сборке:
//   NITRO_PRESET=node-server npm run build
// Тогда Nitro кладёт серверную часть в dist/server/index.mjs, статику — в
// dist/client. Запуск на сервере: `node dist/server/index.mjs` (порт 3000).
const nitroPreset = process.env.NITRO_PRESET;

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  ...(nitroPreset
    ? {
        nitro: {
          preset: nitroPreset,
          output: {
            dir: "dist",
            serverDir: "dist/server",
            publicDir: "dist/client",
          },
        },
      }
    : {}),
});
