# y-tu-que-compras

Aplicación SvelteKit 2 + Svelte 5, desplegada en [Vercel](https://vercel.com). Gestor de paquetes:
[bun](https://bun.sh).

## Requisitos

Versiones fijadas en `.tool-versions` (asdf): node y bun. Node va alineado con el runtime de Vercel
(`nodejs24.x` en `svelte.config.js`) y con `engines.node`; si cambias uno, cambia los tres.

```sh
asdf install
```

La autenticación contra GitHub Packages (`@callepuzzle/*`, `@zytera/*`) se resuelve con un
[Personal Access Token](https://github.com/settings/tokens) clásico con permiso `read:packages`.
Defínelo como `NPM_TOKEN` en el `.env` (ver `.env.example`): el `.npmrc` lo inyecta
(`//npm.pkg.github.com/:_authToken=${NPM_TOKEN}`). Sin token, `bun install` falla con 401.

## Instalación

```sh
cp .env.example .env   # y rellena los valores
bun install
bun run db:migrate     # aplica prisma/migrations a la base de datos local
```

`BETTER_AUTH_SECRET` debe tener al menos 32 caracteres: `openssl rand -base64 32`.

### Bases de datos creadas antes de las migraciones

Si tu base de datos local se creó con `db:push`, ya tiene las tablas de la migración inicial.
Márcala como aplicada y añade lo que falte (la tabla `rateLimit`):

```sh
bunx prisma migrate resolve --applied 0_init
bun run db:push
```

O, si no hay datos que conservar, `bunx prisma migrate reset`.

## Desarrollo

```sh
bun run dev

# o arrancar el servidor y abrir la app en el navegador
bun run dev -- --open
```

## Build

```sh
bun run build     # genera la salida de Vercel en .vercel/output
bun run preview   # sirve el build en http://localhost:4173
```

## Comprobaciones

```sh
bun run lint      # prettier + eslint
bun run check     # svelte-check
bun run test      # unit + e2e
bun run audit     # vulnerabilidades conocidas en dependencias
```

Los e2e usan Chromium de Playwright; la primera vez instálalo con `bun run test:e2e:install`.
Levantan el build con `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` de prueba (ver
`playwright.config.ts`) y no necesitan base de datos.

El CI (`.github/workflows/ci.yml`) ejecuta todo lo anterior y además
[gitleaks](https://github.com/gitleaks/gitleaks) sobre el historial completo.

## Despliegue (Vercel)

Variables de entorno del proyecto en Vercel:

| Variable             | Valor                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`       | PostgreSQL (con pooler si el proveedor lo ofrece)                  |
| `BETTER_AUTH_URL`    | URL pública **https** de la app                                    |
| `BETTER_AUTH_SECRET` | Secreto propio por entorno (`openssl rand -base64 32`)             |
| `NPM_TOKEN`          | PAT con `read:packages` para instalar `@callepuzzle/*` en el build |

Las migraciones no se aplican en el build: ejecuta `bun run db:deploy` contra la base de datos de
cada entorno antes de desplegar código que dependa de ellas. No uses `db:push` fuera de local.

## Seguridad

- **CSP** generada por SvelteKit (`kit.csp` en `svelte.config.js`) y resto de cabeceras
  (`HSTS`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) en
  `src/hooks.server.ts`. Si añades orígenes externos (imágenes, analítica, APIs), declara el
  origen en la directiva correspondiente.
- **better-auth** (`src/lib/server/auth.ts`): rate limit persistido en base de datos, IP del
  cliente leída de `x-real-ip` (la reescribe Vercel), cookies `Secure` fuera de desarrollo y tokens
  OAuth cifrados.
- **Módulos de inlang** (`project.inlang/settings.json`): se descargan de jsDelivr y se ejecutan
  en cada build; van con versión exacta. Actualízalos a mano revisando el changelog.

### Excepciones de dependencias

`bun audit` (script `audit`) falla con vulnerabilidades `moderate` o superiores, salvo:

- `GHSA-ggr8-5vv4-36mx` (`deepmerge-ts` < 8): solo lo usa la CLI de Prisma (`@prisma/config`
  fija `7.1.5`) para combinar su configuración, nunca en runtime. Quitar al subir a Prisma 8.
- `cookie@0.6.0` (low, `GHSA-pxg6-pf52-xh8x`): lo fija `@sveltejs/kit` 2; queda bajo el umbral.

`overrides` de `package.json`:

- `mysql2`: lo arrastran `better-auth` y `prisma` en versiones vulnerables, aunque la app usa
  PostgreSQL y nunca lo carga. Quitar cuando ambos dependan de `mysql2` ≥ 3.23.1.
- `formsnap > svelte-toolbelt`: `formsnap@2.0.1` (requerido por `@callepuzzle/svelte-ui`) pide
  `svelte-toolbelt@^0.5`, mientras que `bits-ui` usa la `0.10`; el override deja una sola versión
  (la `0.10`) para los dos. Quitar cuando `formsnap` publique una versión que dependa de `svelte-toolbelt` ≥ 0.10.
