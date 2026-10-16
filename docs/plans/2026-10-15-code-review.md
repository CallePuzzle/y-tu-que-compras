# Code review completo — 2026-10-15

Revisión de `main` en `66b1663` (scaffold SvelteKit 2 + Svelte 5 + better-auth + Prisma 7 + Paraglide).
Foco principal: **seguridad**. Después, calidad y mantenimiento.

## Estado verificado

| Comprobación              | Resultado                                              |
| ------------------------- | ------------------------------------------------------ |
| `bun run lint`            | OK                                                     |
| `bun run check`           | OK (0 errores, 0 warnings)                             |
| `bun run test:unit --run` | OK (2/2, solo ejemplos de plantilla)                   |
| `bun run test:e2e`        | No ejecutado (ni en local ni en CI)                    |
| `bun audit`               | 4 vulnerabilidades (2 high, 1 moderate, 1 low), ver S4 |
| Escaneo de secretos (git) | 1 secreto en el historial, ver S1                      |

La aplicación todavía no tiene lógica de dominio, ni métodos de login, ni rutas protegidas, así que la
superficie de ataque real es pequeña. La mayoría de los hallazgos son **cosas que hay que dejar bien
antes** de añadir login y datos de usuario.

---

## 1. Seguridad

Severidad: 🔴 alta · 🟠 media · 🟡 baja · ⚪ informativa.

### S1 🟠 Secreto de better-auth en el historial de git

El valor de `BETTER_AUTH_SECRET` (redactado aquí; ver commit `04c8955`) se añadió en `.env.example`
en el commit `04c8955` (2025-07-10) y se borró en `0d99e88`, pero **sigue en el historial** de
`github.com/CallePuzzle/y-tu-que-compras`.

- Si ese valor se usó en algún entorno real (staging/prod de la versión anterior con Turso), hay que
  **rotarlo**: con él se pueden firmar cookies de sesión válidas.
- Si solo fue un valor de ejemplo, no hace falta reescribir el historial, pero conviene confirmarlo.
- Recomendación: añadir un escáner de secretos al CI (`gitleaks` o el _secret scanning / push
  protection_ de GitHub) para que no vuelva a pasar.

### S2 🟠 Módulos de inlang cargados en remoto sin fijar versión ni integridad

`project.inlang/settings.json` descarga y **ejecuta código JavaScript** desde jsDelivr:

```json
"https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js",
"https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2/dist/index.js"
```

Se ejecuta en cada `bun install` (postinstall → `paraglide-js compile`), en cada `vite dev/build` y
en el CI. El rango `@4` / `@2` es flotante y no pasa por `bun.lock`, así que:

- el código que se ejecuta no es reproducible ni está auditado por el lockfile;
- un compromiso del paquete en npm o del CDN se ejecutaría en las máquinas de desarrollo y en el CI
  (con acceso a `NPM_TOKEN` y `.env`).

Recomendación: fijar versión exacta (`@4.x.y`) como mínimo; idealmente instalar los plugins como
`devDependencies` y referenciarlos localmente si la versión de inlang lo permite.

### S3 🟠 Rate limiting de better-auth: en memoria y con IP falsificable

Valores por defecto de better-auth 1.7 (comprobado en `node_modules`):

- `rateLimit.enabled` = `isProduction` y almacenamiento **en memoria**: no se comparte entre
  instancias ni sobrevive a reinicios. En serverless (y `adapter-auto` apunta a eso) es prácticamente
  inexistente.
- La IP del cliente se toma de `x-forwarded-for` (`DEFAULT_IP_HEADERS`). Si la app no está detrás
  de un proxy que **sobrescriba** esa cabecera, cualquier cliente puede rotar IPs falsas y saltarse
  el límite.

Esto es especialmente importante cuando entren los presets `emailOtpPreset` / `magicLinkPreset` de
`@callepuzzle/auth` (fuerza bruta de OTP, envío masivo de emails).

Recomendación, al configurar el login en `src/lib/server/auth.ts`:

- `rateLimit: { enabled: true, storage: 'database' }` (o `secondary-storage` con Redis) y
  `customRules: emailOtpRateLimitRules()`;
- `advanced.ipAddress.ipAddressHeaders` acorde al proxy real del despliegue (p. ej.
  `cf-connecting-ip`, `x-real-ip`), nunca `x-forwarded-for` a pelo sin proxy de confianza.

### S4 🟠 Dependencias con vulnerabilidades conocidas (`bun audit`)

| Paquete          | Vía                       | Severidad | Advisory                                        |
| ---------------- | ------------------------- | --------- | ----------------------------------------------- |
| `mysql2@3.15.3`  | `better-auth`, `prisma`   | high      | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 (mod.) |
| `deepmerge-ts@7` | `prisma > @prisma/config` | high      | GHSA-ggr8-5vv4-36mx                             |
| `cookie@0.6.0`   | `@sveltejs/kit`           | low       | GHSA-pxg6-pf52-xh8x                             |

Impacto real bajo: la app usa PostgreSQL (`mysql2` no se carga) y `deepmerge-ts` solo corre en la
CLI de Prisma. Aun así:

- ejecutar `bun audit fix` y actualizar `better-auth` 1.7.9 → 1.7.10;
- añadir `bun audit` (o Dependabot/Renovate con alertas) al CI para enterarse a tiempo.
- `bun audit` **no puede auditar** `@callepuzzle/*` (GitHub Packages devuelve 404). Esos paquetes
  deben tener su propio escaneo en su repo (`CallePuzzle/storybook-svelte`).

### S5 🟠 Sin cabeceras de seguridad ni CSP

`svelte.config.js` no define `kit.csp` y no hay ningún hook que añada cabeceras. Faltan:

- `Content-Security-Policy` (SvelteKit la genera con nonces/hashes vía `kit.csp`, `mode: 'auto'`);
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy` y `frame-ancestors 'none'` (anti-clickjacking, relevante en pantallas de login).

Recomendación: activar `kit.csp` y añadir un `handle` pequeño en `hooks.server.ts` (dentro del
`sequence`) que fije el resto con `response.headers.set(...)`.

### S6 🟡 La validación de configuración acepta `http://` en producción

`assertSecureAuthConfig` de `@callepuzzle/auth` admite `baseURL` con `http:`. better-auth decide
`useSecureCookies` a partir del protocolo de `baseURL`, así que un `BETTER_AUTH_URL=http://…` mal
puesto en producción emitiría cookies de sesión **sin `Secure`**.

Recomendación (en la librería o en la app): si `!dev`, exigir `https:`; o fijar
`advanced.useSecureCookies: !dev` explícitamente en `src/lib/server/auth.ts`.

### S7 🟡 `getSession` en cada petición, incluidos assets

`src/hooks.server.ts` llama a `betterAuthHandle(auth, building)` sin `{ skipAssets: true }`. Cada
petición (incluidos `/_app/*`, imágenes, fuentes cuando no los sirve un CDN) resuelve sesión, y con
cookie presente eso es una consulta a BD. Es un amplificador barato de carga/DoS y, si la BD cae,
**todas** las peticiones devuelven 500, también las estáticas.

Recomendación: `betterAuthHandle(auth, building, { skipAssets: true })`.

### S8 🟡 Tokens de sesión y OAuth en claro en la base de datos

`prisma/schema.prisma` guarda `Session.token`, `Account.accessToken`, `refreshToken` e `idToken` en
texto plano (esquema por defecto de better-auth). Una fuga de la BD (backup, réplica, `db:studio`
expuesto) permite secuestrar sesiones y cuentas de proveedores externos.

Recomendación cuando haya login social: `account: { encryptOAuthTokens: true }`. Para sesiones,
valorar `secondaryStorage` o tiempos de expiración cortos (`session.expiresIn`, `updateAge`).

### S9 ⚪ Otros puntos revisados (correctos)

- **CI** (`.github/workflows/ci.yml`): `permissions` mínimos (`contents: read`, `packages: read`),
  actions fijadas por SHA, `persist-credentials: false`, `--frozen-lockfile`. Bien.
  - Mejora: el job hereda el `GITHUB_TOKEN` como `NPM_TOKEN` en **todos** los pasos (lint, tests,
    build). Moverlo a `env:` solo del paso `bun install` reduce la exposición a código de terceros.
- **Scripts de instalación**: bun solo ejecuta lifecycle scripts de `trustedDependencies`
  (`prisma`, `@prisma/engines`). Bien.
- **Dependency confusion**: `@callepuzzle` y `@zytera` están mapeados a GitHub Packages en
  `.npmrc` y el lockfile confirma que se resuelven desde `npm.pkg.github.com`. Bien.
- **`.gitignore`**: `.env` y `.env.*` ignorados. Bien.
- **Paraglide** `transformPageChunk`: el locale viene validado por el runtime, no hay inyección en
  `%paraglide.lang%`.
- **CSRF**: `kit.csrf.checkOrigin` está activo por defecto y better-auth valida `Origin` contra
  `baseURL`. Cuando haya varios dominios, declarar `trustedOrigins` explícitamente.
- **Errores**: `prisma.ts` lanza `Falta DATABASE_URL` sin filtrar valores sensibles.

---

## 2. Calidad y mantenimiento

### Q1 Despliegue indefinido

`svelte.config.js` usa `@sveltejs/adapter-auto` y el README conserva el texto de plantilla
("you may need to install an adapter"). El destino afecta a S3 (rate limit), S5 (cabeceras) y al
pool de conexiones de Prisma. Decidir plataforma y fijar el adapter concreto.

### Q2 E2E no se ejecutan

- El CI no corre `test:e2e`.
- `playwright.config.ts` hace `bun run build && bun run preview`, pero el handle de auth **aborta**
  sin `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` (y sin BD), así que el e2e falla en un entorno limpio.
  Añadir un `.env.test` (ya está des-ignorado en `.gitignore`) o `webServer.env`.
- `test:e2e` ejecuta `playwright install` en cada ejecución: lento e innecesario en local.

### Q3 Código de plantilla

`src/lib/vitest-examples/` (Welcome, greet) son ejemplos del `sv create`. Borrarlos cuando haya tests
reales. Detalle: en `Welcome.svelte` las props tienen default pero el tipo las marca obligatorias
(`host: string` → `host?: string`).

### Q4 Alias de importación mezclados

Conviven `$lib/...` (`+layout.svelte`, `prisma.ts`) y `#lib/...` (resto). Además `package.json`
mapea `"#lib": "./src/lib/index.js"` cuando el fichero es `index.ts`. Elegir uno (recomendado
`$lib`, el nativo de SvelteKit) y, si se mantiene `#lib`, añadir una regla de ESLint
(`no-restricted-imports`) para no mezclarlos.

### Q5 Proxy perezoso de Prisma

`src/lib/server/prisma.ts` resuelve bien el problema de `vite build` sin `DATABASE_URL`, pero:

- cualquier acceso accidental (p. ej. `await prisma` comprueba `then`) instancia el cliente;
- `instanceof PrismaClient` y la inspección de tipos en depuración no funcionan sobre el proxy.

Es aceptable; dejarlo documentado y cubierto con un test unitario mínimo.

### Q6 Comentarios y README

- `src/lib/auth-client.ts`: erratas ("anadelos", "sincria" → "sincronía"); varios comentarios
  sin tildes ("sesion", "conexion", "Factoria") mientras el resto del código las lleva.
- README mezcla español con secciones en inglés de la plantilla (`Developing`, `Building`).
- `src/routes/+layout.svelte`: `$derived(getRoutes())` no tiene dependencias reactivas (el cambio
  de locale en Paraglide recarga la página), así que se calcula una vez; el comentario sugiere otra
  cosa. Funciona, pero un `const` bastaría o el comentario debería aclararlo.

### Q7 Versiones y entorno

- `engines.node >= 22` vs `.tool-versions` node 26 vs `@types/node ^24`: alinear.
- Actualizaciones mayores disponibles (no urgentes, evaluar por separado): `@sveltejs/kit` 3,
  `adapter-auto` 8, `vitest` 5, `typescript` 7.
- `overrides.formsnap.svelte-toolbelt` sin explicación: documentar por qué existe y cuándo
  quitarlo.
- Prisma: no hay carpeta `prisma/migrations`. Antes de producción, usar `db:migrate` y no
  `db:push`.

---

## 3. Plan de acción propuesto

Prioridad por orden:

1. **S1** Confirmar si el secreto del historial se usó en algún entorno; rotarlo si es así.
2. **S2** Fijar versiones exactas de los módulos de inlang.
3. **S4** `bun audit fix` + actualizar `better-auth` a 1.7.10; añadir `bun audit` y escaneo de
   secretos al CI.
4. **S7** `skipAssets: true` en `betterAuthHandle` (cambio de una línea).
5. **Q1** Elegir plataforma de despliegue y adapter → condiciona S3 y S5.
6. **S5** CSP + cabeceras de seguridad.
7. **S3 / S6 / S8** Configuración endurecida de better-auth al añadir el primer método de login
   (rate limit persistente, cabecera de IP del proxy, `useSecureCookies`, cifrado de tokens OAuth).
8. **Q2** Arreglar y activar e2e en CI.
9. **Q3–Q7** Limpieza de calidad.
