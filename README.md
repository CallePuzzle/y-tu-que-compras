# y-tu-que-compras

Aplicación SvelteKit 2 + Svelte 5, desplegada en el clúster k0s de `villajilguero-oci-services`
(https://ytqc.callepuzzle.com). Gestor de paquetes: [bun](https://bun.sh).

## Requisitos

Versiones fijadas en `.tool-versions` (asdf): node y bun. Node va alineado con el runtime de
Vercel (`nodejs24.x` en `svelte.config.js`) y con `engines.node`; si cambias uno, cambia los tres.

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
bun run build     # build de @sveltejs/adapter-vercel (default; .vercel/output)
ADAPTER=node bun run build   # build de @sveltejs/adapter-node: servidor en build/ (el del clúster)
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

## Email

El envío de email (código OTP del login y invitaciones a la familia) va por el
SMTP de **Oracle Cloud Email Delivery** (región Madrid), el mismo proveedor y
credenciales que ya usa «Dónde está tu local» en producción. Se descartaron
servicios como Resend para no añadir otro tercero: el volumen de la app no lo
justifica y el SMTP ya está operativo.

- Módulo de envío: `src/lib/server/sender.ts` (nodemailer, transporter
  cacheado a nivel de módulo).
- Plantillas: `src/lib/server/emails.ts`, con los textos en
  `messages/es.json` y `messages/en.json`.
- **En desarrollo/test no sale ningún correo real**: `sendEmail` imprime el
  mensaje en el log (vía pino, solo en desarrollo) y lo deja capturado
  (`capturedEmailsForTests`) para asertarlo en los tests.

Variables del `.env` (ver `.env.example`): `SMTP_HOST`, `SMPT_AUTH_USER`,
`SMPT_AUTH_PASS` y `SMPT_SENDER`. El typo `SMPT_` es intencionado: así están
nombradas las variables desplegadas en producción (misma convención que
«Dónde está tu local»).

### Dominio remitente en producción

El remitente es `@callepuzzle.com` y el dominio ya está listo para producción
(comprobado contra el DNS en octubre de 2026):

- **DKIM**: `oracle._domainkey.callepuzzle.com` (CNAME a
  `oracle.callepuzzle.com.dkim.mad1.oracleemaildelivery.com`) publica la clave
  con la que Oracle firma cada envío.
- **SPF**: `v=spf1 include:_spf.protonmail.ch mx ~all`. No lista los servidores
  de Oracle, pero no hace falta: DMARC se satisface con uno de los dos
  mecanismos alineados, y el que firma es DKIM del propio dominio.
- **DMARC**: `v=DMARC1; p=quarantine; rua=…` (informes a Cloudflare).

Con el From firmado por DKIM de `callepuzzle.com`, el alineamiento DMARC pasa
y los correos llegan sin caer en spam por políticas de autenticación.

## Despliegue (clúster k0s)

GitOps con Argo CD: el app-of-apps de `villajilguero-oci-services/jilguedev/app-of-apps/` apunta
al directorio `deploy/` de este repo (proyecto Tanka) y sincroniza en el namespace
`callepuzzle-dev` del clúster de `jilguedev` — que es la producción de la app, pese al nombre
«dev» (ver `AGENTS.md`). Detalles de la arquitectura y de los secretos en el `AGENTS.md`
y en la issue [#30](https://github.com/CallePuzzle/villajilguero-oci-services/issues/30).

El release (`.github/workflows/release.yml`) se dispara al mergear a `main`: construye la imagen
`linux/arm64` (`ghcr.io/callepuzzle/y-tu-que-compras:vX.Y.Z`, con `NPM_TOKEN` como secret de
BuildKit), corta la release con tag y commitea el nuevo tag en `deploy/pro/version.jsonnet`, lo
que dispara el sync de Argo CD. Las migraciones las aplica el init container `db-migrate`
(`prisma migrate deploy`) en cada despliegue; no hace falta ejecutarlas a mano.

Secretos del despliegue: `deploy/pro/secrets.enc` (cifrado con SOPS, clave age del repo de
infra). Sin `SMTP_HOST`/`SMPT_*` la app arranca, pero el login OTP falla al enviar el correo.

## Seguridad

- **CSP** generada por SvelteKit (`kit.csp` en `svelte.config.js`) y resto de cabeceras
  (`HSTS`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) en
  `src/hooks.server.ts`. Si añades orígenes externos (imágenes, analítica, APIs), declara el
  origen en la directiva correspondiente.
- **better-auth** (`src/lib/server/auth.ts`): rate limit persistido en base de datos, IP del
  cliente leída de `cf-connecting-ip` (la fija Cloudflare; `x-real-ip` queda como candidato
  heredado de Vercel), cookies `Secure` fuera de desarrollo y tokens OAuth cifrados.
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
