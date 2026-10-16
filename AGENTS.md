# AGENTS.md

Guía para agentes de IA. App **y-tu-que-compras**: SvelteKit 2 + Svelte 5 (runes), TypeScript, Tailwind CSS 4 + daisyUI 5, Prisma 7 + PostgreSQL, better-auth (login OTP por email), Paraglide JS (i18n `es`/`en`). README y comentarios del código en español.

## Repos relacionados (fuera de este repo)

- **Librería `@callepuzzle/*`** (`auth`, `core`, `svelte-ui`): el código fuente está en
  `/home/cesar/projects/frontend-library` (monorepo bun + turbo que publica en GitHub Packages).
  Aquí se consume la versión publicada, no es un workspace: para tocar la librería, editar allí y publicar.
- **Referencia de implementación**: `/home/cesar/projects/donde-esta-tu-local` — app hermana en
  producción con el mismo stack y las mismas librerías; útil como ejemplo de cómo se integra todo.

## Setup

- Gestor: **bun** (`bun.lock`); node >= 24. Versiones fijadas en `.tool-versions` (asdf): `asdf install`.
- `bun install` **exige `NPM_TOKEN` en `.env`** (PAT clásico con `read:packages`): `@callepuzzle/*` y
  `@zytera/*` vienen de GitHub Packages vía `.npmrc`; sin token falla con 401. En CI basta `GITHUB_TOKEN`.
- El `postinstall` genera código (`svelte-kit sync && prisma generate && paraglide compile`): si algo
  se queja de imports inexistentes tras cambiar de rama, re-ejecutar `bun install`.
- BD local: `DATABASE_URL` de `.env.example` (`postgresql://postgres:postgres@localhost:5432/y_tu_que_compras`).
  Esquema: `bun run db:push` (dev) o `db:migrate` (migraciones).

## Código generado — no editar a mano

- `src/lib/generated/prisma` — cliente Prisma (output custom de `prisma generate`; importar desde
  `$lib/generated/prisma/client`, no de `@prisma/client`).
- `src/lib/paraglide` — mensajes i18n compilados. Los textos viven en `messages/{es,en}.json`.

## Comandos

```sh
bun run lint        # prettier --check + eslint (formato: bun run format)
bun run check       # svelte-check (typecheck)
bun run test:unit -- --run   # vitest en modo run (sin --run queda en watch)
bun run test:e2e    # playwright (hace build + preview en :4173 antes)
bun run test        # unit + e2e
```

Orden en CI (`lint → check → test:unit → build → e2e`; los e2e re-hacen el build dentro del
webServer de Playwright). Un test suelto:
`bun run test:unit -- --run src/lib/server/emails.spec.ts`; e2e suelto: `bunx playwright test <fichero>`.

## Tests

- Dos proyectos de vitest (`vite.config.ts`): **client** corre `.svelte.{test,spec}.*` en Chromium
  real (vitest browser mode; requiere `bunx playwright install --with-deps chromium` la primera vez)
  y **server** corre el resto en node. Los tests de `src/lib/server/**` son siempre de servidor.
- `requireAssertions: true`: un test sin assertions falla.
- **En dev/test no sale ningún email real**: `sendEmail` lo imprime en el log y lo deja capturado en
  `capturedEmailsForTests` (ver `src/lib/server/emails.ts`) para asertarlo.

## Gotchas

- El typo **`SMPT_`** en las variables de email (`SMPT_AUTH_USER`, etc.) es intencionado: así están
  nombradas en producción. No "corregirlo".
- Usar **`$env/dynamic/private`**, no `process.env`, para env en código de servidor (bun no inyecta
  el `.env` en los scripts; es Vite/SvelteKit quien lo carga — ver `src/lib/server/auth.ts`).
- El cliente Prisma (`src/lib/server/prisma.ts`) se instancia perezosamente vía Proxy para que
  `vite build` no necesite `DATABASE_URL`. Mantener ese patrón si se toca.
- `ssr.noExternal` en `vite.config.ts`: los paquetes `@callepuzzle/*`, formsnap y
  sveltekit-superforms deben bundlarse en SSR porque importan los módulos virtuales `$app/*`.
- Imports dentro del código de servidor: alias **`$lib/*`** (el nativo de SvelteKit; eslint lo
  impone: `#lib/*` está prohibido). Imports relativos con extensión `.js`
  (`import { sendEmail } from './sender.js'`).
