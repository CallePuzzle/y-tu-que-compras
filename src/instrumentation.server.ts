// Punto de arranque de OpenTelemetry en el servidor: la opción experimental
// `instrumentation.server` (svelte.config.js) hace que SvelteKit cargue este
// módulo ANTES del código de la app, requisito para poder instrumentar imports
// (p. ej. pg). El warning de "experimental" al compilar es esperado.
//
// Sin `OTEL_EXPORTER_OTLP_ENDPOINT` definido (fase 3, export a Grafana Cloud,
// pendiente de hacer más adelante) el SDK no exporta a ningún sitio: las
// trazas quedan en spans internos sin destino. En local no definir las env
// vars OTEL_* para no exportar trazas ni depender de la red al desarrollar.
import { registerOTel } from '@vercel/otel';

registerOTel({ serviceName: 'y-tu-que-compras' });
