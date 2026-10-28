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
bun run test:integration     # vitest proyecto `integration` (necesita DATABASE_URL con migraciones aplicadas)
bun run test:e2e    # playwright (necesita la BD de e2e: bun run db:test:up antes)
bun run test        # unit + integration + e2e
```

Orden en CI (`lint → check → test:unit → test:integration → build → e2e`; `test:integration` aplica
las migraciones al service de postgres y el paso e2e levanta su propio PostgreSQL con compose
antes). Un test suelto:
`bun run test:unit -- --run src/lib/server/emails.spec.ts`; e2e suelto: `bunx playwright test <fichero>`.

## Tests

- Tres proyectos de vitest (`vite.config.ts`): **client** corre `.svelte.{test,spec}.*` en Chromium
  real (vitest browser mode; requiere `bunx playwright install --with-deps chromium` la primera vez),
  **server** corre el resto en node (sin base de datos) y **integration** corre `*.int.spec.ts`
  contra Postgres real (en local: postgres en :5432 + `bun run db:migrate`; en CI hay un service).
  Los tests de `src/lib/server/**` son siempre de servidor.
- **e2e (Playwright)**: los specs viven junto a su ruta como `*.e2e.ts` y los helpers compartidos en
  `e2e/` (`helpers/` con `auth` — sesión sembrada + login OTP real leyendo la tabla `verification` —,
  `seed` — familias con roles sembrados como los siembra el plugin —, `db` y `env`). Van full-stack:
  el webServer es `vite dev` en :4174 contra el PostgreSQL de `docker-compose.yml` (:55433,
  `bun run db:test:up`; migraciones las aplica `e2e/global-setup.ts`). Sin paralelismo (workers 1):
  cada spec trunca la BD (`resetDb`). En dev no sale ningún email real y better-auth no activa el
  rate limit, así que el flujo OTP es repetible. En CI el compose se levanta en su paso del
  workflow.
- `requireAssertions: true`: un test sin assertions falla.
- **En dev/test no sale ningún email real**: `sendEmail` lo imprime en el log y lo deja capturado en
  `capturedEmailsForTests` (ver `src/lib/server/emails.ts`) para asertarlo.

## Gotchas

- **Las rutas (URLs) van en inglés**, igual que el código: `/families`, `/login`… aunque el dominio
  del producto sea español («familias», no «families»). Los textos visibles van en i18n
  (`messages/{es,en}.json`); las claves de mensaje también en inglés (`routes_families`,
  `families_create`). No crear rutas ni claves en español.
- El typo **`SMPT_`** en las variables de email (`SMPT_AUTH_USER`, etc.) es intencionado: así están
  nombradas en producción. No "corregirlo".
- Usar **`$env/dynamic/private`**, no `process.env`, para env en código de servidor (bun no inyecta
  el `.env` en los scripts; es Vite/SvelteKit quien lo carga — ver `src/lib/server/auth.ts`).
- Tampoco el CLI de Prisma ve el `.env`: lo carga `dotenv` en `prisma.config.ts`. Ni `bunx` ni
  `bun run` lo inyectan (los flags `--env-file` de bun solo valen para scripts del propio bun).
- El cliente Prisma (`src/lib/server/prisma.ts`) se instancia perezosamente vía Proxy para que
  `vite build` no necesite `DATABASE_URL`. Mantener ese patrón si se toca.
- **Permisos de familia**: los roles (`admin`/`member`, `src/lib/server/tenancy.ts`) solo guardan
  la gestión de la familia (renombrar, borrar, invitar, roles). Listas, compras y despensa son
  intencionadamente de escritura total para cualquier miembro: las acciones solo comprueban la
  pertenencia (`requireActiveFamily`). No añadir checks de rol ahí sin decidirlo antes (issue #111).
- `ssr.noExternal` en `vite.config.ts`: los paquetes `@callepuzzle/*`, formsnap y
  sveltekit-superforms deben bundlarse en SSR porque importan los módulos virtuales `$app/*`.
- Imports dentro del código de servidor: alias **`$lib/*`** (el nativo de SvelteKit; eslint lo
  impone: `#lib/*` está prohibido). Imports relativos con extensión `.js`
  (`import { sendEmail } from './sender.js'`).

## Despliegue (clúster k0s, fase 3 de la issue #30 de villajilguero-oci-services)

- La app corre en el clúster k0s de `jilguedev` (instancia OCI aarch64) gestionado por Terraform en
  `villajilguero-oci-services/jilguedev/`, con GitOps (Argo CD + plugin `tanka-sops`). Publica en
  `https://ytqc.callepuzzle.com` (Cloudflare proxied → LB OCI passthrough → Traefik).
- **Este es el entorno de PRODUCCIÓN de la app**: el clúster se llama «dev» porque acoge
  aplicaciones desarrolladas por nosotros, no por su ciclo de vida. El entorno Tanka se llama
  `pro` (en `deploy/pro/`) porque es lo que es: la Application de Argo CD del repo de infra
  (`y-tu-que-compras-pro`) renderiza `deploy/` con
  `ENVIRONMENT=pro`, así que el CMP tanka-sops ejecuta `tk show pro`.
- **`deploy/`** es un proyecto Tanka (patrón `Zytera/auth/deploy`): `lib/app.libsonnet` genera
  Deployment/Service/Ingress + Secrets + el Cluster CNPG `ytqc-db` (Postgres en el clúster, con
  backups barman a OCI Object Storage) y el `ScheduledBackup` diario. El init container
  `db-migrate` ejecuta `prisma migrate deploy` antes de arrancar el servidor. El entorno `pro/`
  lleva `spec.json`, `main.jsonnet` (host público), `version.jsonnet` (tag de imagen) y
  `secrets.enc` (SOPS/age, misma clave age que el repo de infra; ver `~/projects/age-key.txt`).
- **Release**: push a `main` → `.github/workflows/release.yml` construye la imagen `linux/arm64`
  en el runner `ubuntu-24.04-arm` (`ghcr.io/callepuzzle/y-tu-que-compras:vX.Y.Z`; `NPM_TOKEN` de
  GitHub Packages entra como secret de BuildKit, no como ARG), corta la release/tag y commitea
  `deploy/pro/version.jsonnet`; Argo CD (autoSync) despliega el nuevo tag. El push del bump va
  por SSH con la deploy key de escritura `bump-pro release (CI)` (secret `BUMP_DEPLOY_KEY`): el
  ruleset de `main` exige los checks de CI a los pushes humanos y la key es bypass actor
  (el `GITHUB_TOKEN` del workflow no puede pushear — lo rechazó en la v0.0.1). El job `docker` de
  `ci.yml` construye la misma imagen (mismo runner ARM) en cada PR para que lo que construye la
  release no se estrene en main. El workflow se salta
  los cambios de `deploy/**` (`paths-ignore` + `[skip ci]`).
- **Runtime**: la imagen es todo bun, como `Zytera/auth`: build con `oven/bun:1.4.4` (exporta
  `ADAPTER=node`, que hace que `svelte.config.js` elija adapter-node) y runtime
  `oven/bun:1.4.4-distroless` ejecutando `bun run /app/build/index.js` (el output de adapter-node
  es JS puro y el cliente de Prisma va con el driver adapter, sin binario Rust; solo el CLI usa el
  schema-engine de `@prisma/engines`, para cuyas libs el Dockerfile copia `libssl3`/`libcrypto`/
  brotli/zstd de bookworm al runtime — la imagen distroless de bun es estática y sin ellas
  `prisma migrate deploy` muere con un «Schema engine error» vacío). `bun install --production`
  NO poda devDeps (bug de bun 1.4.x), así que el stage `prune` los quita con `bun remove`,
  excluyendo `svelte` y `@sveltejs/kit`: quedan como imports externos del servidor y aunque están
  en devDependencies son necesarios en runtime. `prisma` y `dotenv` están en `dependencies` (no
  dev) porque la imagen runtime necesita el CLI de Prisma y `prisma.config.ts` importa dotenv. El
  servidor fija `ORIGIN`/`BETTER_AUTH_URL` al host público (ver `deploy/lib/app.libsonnet`):
  detrás del proxy no se usan `PROTOCOL_HEADER`/`HOST_HEADER`.
- **Dos adapters, uno por build**: SvelteKit solo admite uno y se elige al compilar. Con
  `ADAPTER=node` (lo exporta el Dockerfile) → `@sveltejs/adapter-node` (`build/`, el clúster k0s).
  Sin esa variable → `@sveltejs/adapter-vercel` (`.vercel/output`), que es como sigue compilando
  el despliegue de staging de Vercel, conectado a un origen GitLab propio: su proyecto no necesita
  ningún cambio. `vite preview` (e2e) no usa el output del adapter, así que da igual el que toque.
- Render local del deploy (mismo flujo que el CMP tanka-sops):
  `cd deploy && jb install && sops -d --input-type json --output-type json --output pro/secrets.json pro/secrets.enc && tk show pro --dangerous-allow-redirect`
  (con `SOPS_AGE_KEY_FILE` apuntando a la clave age; borrar `pro/secrets.json` al acabar).
- Desarrollo local: nada de esto aplica — `bun run dev` + Postgres local (`DATABASE_URL` de
  `.env.example`).
