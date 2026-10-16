# Plan de observabilidad — 2026-10-16

Añadir logs estructurados (pino) y trazas distribuidas (OpenTelemetry) a la app desplegada en
Vercel, con export a Grafana Cloud.

## Estado

- **Fase 1 (pino)**: implementada (2026-10-16).
- **Fase 2 (OTel en Vercel)**: implementada (2026-10-16). Falta verificar trazas en Vercel tras deploy.
- **Fase 3 (export a Grafana Cloud)**: **pendiente — se hará más adelante**. No bloquea nada: sin
  las env vars `OTEL_*`, las trazas solo se ven en el dashboard de Vercel.

## Decisiones tomadas

| Decisión               | Valor                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Plan de Vercel         | **Hobby** → sin Drains (requieren Pro). Export OTLP directo vía env vars de `@vercel/otel`                                    |
| Destino de las trazas  | Stack de Grafana Cloud ya existente (Tempo), vía endpoint OTLP del tile "OpenTelemetry"                                       |
| `userId` en trazas     | **Solo hash** (SHA-256 + salt, truncado). Sin PII directa                                                                     |
| Logs en Grafana (Loki) | **Fuera de alcance**: los Log Drains son Pro y el gateway OTLP de Grafana no acepta el NDJSON de Vercel sin un Alloy en medio |
| Biblioteca de logs     | **pino** (JSON a stdout), sin transports en producción                                                                        |

## Investigación (fuentes oficiales, 2026-10)

- **Vercel soporta OTel nativamente** con `@vercel/otel` + `instrumentation.ts`. Para SvelteKit hay
  soporte directo de sus spans de servidor
  ([changelog](https://vercel.com/changelog/native-support-for-sveltekits-new-opentelemetry-spans)).
- SvelteKit 2.31+ emite spans de `handle`/`load`/form actions/`+server`/remote functions y expone
  `src/instrumentation.server.ts` como punto de arranque
  ([docs observability](https://svelte.dev/docs/kit/observability)).
- `@vercel/otel` acepta `traceExporter`/`spanProcessors` y, si no se configuran, usa un **exportador
  OTLP a partir de las env vars estándar** `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`
  → camino directo a Grafana Cloud sin Drains ni código extra
  ([README](https://github.com/vercel/otel/blob/main/packages/otel/README.md)).
- Vercel captura todo lo que la función escribe a stdout como Runtime Logs; con JSON estructurado los
  campos son filtrables en el dashboard y correlacionados con la traza (`traceId`/`spanId`
  automáticamente al activar tracing).
- Endpoint OTLP de Grafana Cloud: `https://otlp-gw-<region>.grafana.net/otlp` (+ `/v1/traces`), auth
  Basic con `instanceId:token` del tile
  ([docs](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/)).
- Estado actual del repo: **cero `console.*` en `src/`** — no hay nada que migrar; la fase pino
  _introduce_ el logging. SvelteKit 2.70 y `adapter-vercel` 6.3 ya soportan instrumentation server.

---

## Fase 1 — Logging con pino

Objetivo: JSON estructurado en stdout (Runtime Logs de Vercel), seguro por defecto y con logger por
request disponible en todo el código de servidor.

### Cambios

1. **`package.json`**
   - `pino` → `dependencies` (debe estar disponible en runtime de la función serverless).
   - `pino-pretty` → `devDependencies`.

2. **`src/lib/server/logger.ts`** (nuevo) — instancia única de pino:
   - **Producción: sin `transport`**. Los transports de pino (`pino-pretty`, etc.) usan worker
     threads (`thread-stream`) y rompen en serverless/bundling; es la trampa clásica de pino en
     Vercel. JSON a stdout es exactamente lo que Vercel espera.
   - **Dev**: `transport: { target: 'pino-pretty' }` solo si `dev`. En desarrollo Vite no bundlea
     `node_modules`, así que el worker resuelve sin configuración extra.
   - `redact` de campos sensibles: `req.headers.cookie`, `req.headers.authorization`, `password`,
     `email`, `token`, `secret`. Crítico: Vercel envía el stdout tal cual a cualquier drain futuro.
   - `base`: `{ service: 'y-tu-que-compras' }` + entorno (`dev` / `preview` / `production` según
     `VERCEL_ENV`).
   - Nivel desde `LOG_LEVEL` (`$env/dynamic/private`), **acceso perezoso** como en `prisma.ts`:
     durante `vite build` no hay env y el módulo no debe lanzar. Default `info`.
   - Mixin que inyecta `trace_id`/`span_id` desde `trace.getSpan(context.active())` de
     `@opentelemetry/api` cuando exista span activo (fase 2). Degradación graceful: si no hay span,
     no añade nada. Da correlación logs↔trazas en Grafana.

3. **`src/hooks.server.ts`** — nuevo `handleLogging` **primero** en la `sequence`:
   - Log por request al terminar: `method`, `path`, `status`, `durationMs`.
   - `requestId` desde la cabecera `x-vercel-id` (id de correlación de Vercel; servirá también para
     darlo al cliente en errores).
   - Child logger por request: `event.locals.log = logger.child({ requestId, ... })`.

4. **`src/hooks.server.ts`** — exportar `handleError`:
   - Producción: `errorId` (uuid), tipo y mensaje. Stack **solo** en dev/preview (guía OWASP/Vercel).
   - Es el punto donde SvelteKit entrega errores no manejados de `load`/actions/`+server`.

5. **`src/app.d.ts`** — añadir `log` a `App.Locals`.

6. **`src/lib/server/logger.spec.ts`** (opcional, al estilo de `prisma.spec.ts`): asertar JSON de
   salida, nivel por defecto y que `redact` elimina campos sensibles.

### Convenciones

- Comentarios en español con tildes, como el resto del repo.
- El logger se usa vía `event.locals.log` en handlers, o importando el singleton en código no-HTTP
  (p. ej. `prisma.ts`).

---

## Fase 2 — OpenTelemetry (trazas en Vercel)

Objetivo: trazas de request en el dashboard de Vercel y spans de SvelteKit, base para el export a
Grafana de la fase 3.

### Cambios

1. **`package.json`** — `@opentelemetry/api` y `@vercel/otel` en `dependencies`.

2. **`src/instrumentation.server.ts`** (nuevo, raíz de `src/`):

   ```ts
   import { registerOTel } from '@vercel/otel';

   registerOTel({ serviceName: 'y-tu-que-compras' });
   ```

3. **`vite.config.js`** — activar las opciones experimentales del plugin SvelteKit:

   ```js
   sveltekit({
   	tracing: { server: true },
   	instrumentation: { server: true }
   });
   ```

   > **Corrección al implementar (kit 2.70.3 + vite-plugin-svelte 7.2.0):** esas opciones van en
   > `svelte.config.js` bajo `kit.experimental` — `sveltekit()` con opciones inline hace que se
   > ignore `svelte.config.js`, perdiendo la CSP y el adapter. Es lo que hace el repo.

   El warning de "experimental" al compilar es esperado. `tracing.server` activa la emisión de spans
   de SvelteKit; `instrumentation.server` hace que se cargue `instrumentation.server.ts` antes del
   código de la app (requisito para instrumentar imports, p. ej. pg).

4. **Hash de usuario en la traza** — pequeño `handle` tras `betterAuthHandle` (dentro de la
   `sequence`): si `event.locals.user` existe,
   `event.tracing.root.setAttribute('user.hash', sha256(userId + OBSERVABILITY_SALT).slice(0, 16))`.
   - `OBSERVABILITY_SALT`: env var aleatoria dedicada (no reutilizar `BETTER_AUTH_SECRET`).
   - `crypto.createHash('sha256')` de `node:crypto` (runtime Node 24, permitido).

### Qué se obtiene gratis

- Spans de `handle` (y cada handle de la `sequence` como hijo), `load`, form actions y `+server`.
- Spans de `fetch` salientes (instrumentación incluida en `@vercel/otel`) con propagación de
  contexto configurable (`propagateContextUrls`).
- Visualización en Vercel: request traces y Session Tracing desde el dashboard.

### Limitación conocida

- **Prisma/pg no genera spans automáticamente**: pg va por TCP, no por `fetch`, y la instrumentación
  automática de `@vercel/otel` no lo cubre. Si más adelante hace falta medir queries concretas, se
  añaden spans custom con `trace.getTracer(...)` alrededor de las operaciones pesadas. No bloquea.

---

## Fase 3 — Export a Grafana Cloud (solo configuración) — **pendiente: se hará más adelante**

Objetivo: que las trazas aterricen en Tempo del stack de Grafana ya existente. Sin Drains (Hobby) y
sin código adicional: `@vercel/otel` usa el exportador OTLP estándar si detecta las env vars.

### Env vars en Vercel (solo entorno Production)

| Variable                      | Valor                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gw-<region>.grafana.net/otlp` (del tile OpenTelemetry del stack)                                                      |
| `OTEL_EXPORTER_OTLP_HEADERS`  | `Authorization=Basic <base64(instanceId:token)>` — **ojo: el espacio va URL-encodeado (`Basic%20...`), fallo típico de este setup** |
| `OBSERVABILITY_SALT`          | cadena aleatoria (para el hash de userId)                                                                                           |
| `LOG_LEVEL`                   | `info` en prod; `debug` solo en desarrollo local                                                                                    |

- No poner las `OTEL_*` en dev local: evita ruido en Tempo y dependencia de red al desarrollar.
  Si se quieren trazas locales, la vía limpia es Jaeger en local siguiendo el quickstart de la doc
  de SvelteKit (opcional, no bloquea).

### Muestreo

`@vercel/otel` traza el 100% de las requests por defecto. Con el tráfico actual es asumible para el
free tier de Grafana (50 GB). Cuando crezca, bajar con `traceSampler` en `registerOTel` (p. ej. 10%)
o head-sampling por reglas si algún día se pasa a Pro y se usan Drains.

### Correlación logs ↔ trazas

- **En Vercel**: automática al activar tracing — cada línea de log durante una request trazada se
  enriquece con `traceId`/`spanId`.
- **En Grafana**: garantizada por el mixin de pino de la fase 1 (`trace_id`/`span_id` como campos
  del JSON), lo que permite saltar de un log en Loki/Explore a la traza en Tempo.

---

## Verificación

1. Tras cada fase: `bun run lint`, `bun run check`, `bun run test:unit -- --run`, `bun run build`.
2. **Fase 1**: deploy preview → hacer peticiones → comprobar en Runtime Logs el JSON estructurado,
   filtros por nivel y campos (`status`, `durationMs`, `requestId`).
3. **Fase 2**: comprobar que `instrumentation.server` entra en el bundle de la función
   (`.vercel/output/functions/...` tras `vite build`) y que aparecen trazas al inspeccionar una
   request (Vercel CLI `vercel curl --trace --json /`).
4. **Fase 3**: con las env vars puestas en Production, generar tráfico y verificar en Grafana
   (Explore → Tempo) el servicio `y-tu-que-compras` con sus spans; comprobar en un log que
   `trace_id` está presente.

## Riesgos y plan B

- **Pérdida de spans en serverless**: el exportador OTLP usa batching; si la función se congela
  antes del flush, Tempo mostraría menos trazas de las esperadas. Plan B: pasar en `registerOTel`
  un `spanProcessor` explícito (`BatchSpanProcessor` con `scheduledDelayMillis` corto) o exportar
  síncrono si el volumen lo permite.
- **Bundling de pino en prod**: sin transports, pino bundlea sin problemas; si Vite diera guerra,
  `ssr.external: ['pino']` en `vite.config.js`.
- **Regresión de CSP**: nada de esto inyecta scripts de cliente; el mixin OTel es server-side. No
  debería tocar `kit.csp`.

## Orden de implementación

1. Fase 1 (pino) → commit y deploy → verificar logs. ✅ hecha
2. Fase 2 (OTel en Vercel) → commit y deploy → verificar trazas en Vercel. ✅ hecha
3. Fase 3 (env vars Grafana) → verificar Tempo. ⏳ pendiente, se hará más adelante.
4. Opcional posterior: `logger.spec.ts`, spans custom para queries Prisma lentas, revisar muestreo
   cuando el tráfico lo justifique.
