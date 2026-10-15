# y-tu-que-compras

Aplicación SvelteKit 2 + Svelte 5. Gestor de paquetes: [bun](https://bun.sh).

## Requisitos

Versiones fijadas en `.tool-versions` (asdf): node y bun.

```sh
asdf install
```

La autenticación contra GitHub Packages (`@callepuzzle/*`, `@zytera/*`) se resuelve con un
[Personal Access Token](https://github.com/settings/tokens) clásico con permiso `read:packages`.
Defínelo como `NPM_TOKEN` en el `.env` (ver `.env.example`): el `.npmrc` lo inyecta
(`//npm.pkg.github.com/:_authToken=${NPM_TOKEN}`). Sin token, `bun install` falla con 401.

## Instalación

```sh
bun install
```

## Developing

Once you've created a project and installed dependencies, start a development server:

```sh
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Building

To create a production version of your app:

```sh
bun run build
```

You can preview the production build with `bun run preview`.

## Comprobaciones

```sh
bun run lint   # prettier + eslint
bun run check  # svelte-check
bun run test   # unit + e2e
```

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

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
  mensaje en el log y lo deja capturado (`capturedEmailsForTests`) para
  asertarlo en los tests.

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
