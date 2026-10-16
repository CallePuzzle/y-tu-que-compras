import { context, trace } from '@opentelemetry/api';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import pino, { type Logger } from 'pino';

// Campos sensibles que no deben salir en los logs: Vercel envía el stdout tal
// cual a los Runtime Logs (y a cualquier drain futuro). Las variantes con
// comodín cubren un nivel de anidamiento (`*.password` en un objeto anidado).
const REDACT_PATHS = [
	'req.headers.cookie',
	'req.headers.authorization',
	'password',
	'*.password',
	'email',
	'*.email',
	'token',
	'*.token',
	'secret',
	'*.secret'
];

// Inyecta `trace_id`/`span_id` del span activo de OpenTelemetry (fase 2), si lo
// hay: permite saltar en Grafana de un log a su traza en Tempo. Sin span activo
// no añade nada.
function mixin(): Record<string, string> {
	const span = trace.getSpan(context.active());
	if (!span) {
		return {};
	}
	const { traceId, spanId } = span.spanContext();
	return traceId && spanId ? { trace_id: traceId, span_id: spanId } : {};
}

function createLogger(): Logger {
	return pino({
		// `LOG_LEVEL` con `info` por defecto; `debug` solo tiene sentido en local.
		level: env.LOG_LEVEL ?? 'info',
		base: {
			service: 'y-tu-que-compras',
			// development | preview | production (VERCEL_ENV); fuera de Vercel cae a
			// `development`/`production` según cómo se esté ejecutando.
			env: env.VERCEL_ENV ?? (dev ? 'development' : 'production')
		},
		redact: { paths: REDACT_PATHS, censor: '[redacted]' },
		mixin,
		// En desarrollo, salida legible. En producción NUNCA `transport`: los
		// transports de pino usan worker threads (thread-stream) y rompen en
		// serverless; JSON a stdout es justo lo que Vercel espera.
		...(dev ? { transport: { target: 'pino-pretty' } } : {})
	});
}

let instance: Logger | undefined;

function getLogger(): Logger {
	if (!instance) {
		instance = createLogger();
	}
	return instance;
}

// Como en prisma.ts: el logger se crea en el primer acceso y no al importar el
// módulo. `vite build` evalúa el código de servidor sin entorno y así el módulo
// no hace trabajo (ni arranca el transport de desarrollo) al compilar.
const logger = new Proxy({} as Logger, {
	get(_target, property) {
		const instance = getLogger();
		const value = Reflect.get(instance, property);
		return typeof value === 'function' ? value.bind(instance) : value;
	},
	has(_target, property) {
		return Reflect.has(getLogger(), property);
	}
});

export default logger;
