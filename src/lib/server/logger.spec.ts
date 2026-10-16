import {
	ROOT_CONTEXT,
	TraceFlags,
	context,
	trace,
	type Context,
	type ContextManager,
	type Span
} from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	logLines: [] as string[],
	loggerOptions: [] as Array<Record<string, unknown>>
}));

const env: Record<string, string | undefined> = {};

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: false }));

// Pino real escribiendo a un stream en memoria en lugar de stdout (y sin
// `transport`, para no arrancar worker threads en los tests): así se puede
// asertar el JSON de salida y, a la vez, las opciones pedidas al módulo.
vi.mock('pino', async (importOriginal) => {
	const { Writable } = await import('node:stream');
	const real = await importOriginal<typeof import('pino')>();
	return {
		default: (options: Record<string, unknown> = {}) => {
			state.loggerOptions.push(options);
			const withoutTransport = { ...options };
			delete withoutTransport.transport;
			return real.default(
				withoutTransport,
				new Writable({
					write(chunk, _encoding, callback) {
						state.logLines.push(chunk.toString());
						callback();
					}
				})
			);
		}
	};
});

// Sin un SDK de OpenTelemetry registrado, `context.with` es un no-op y el span
// nunca queda "activo". Este gestor síncrono basta para el test: el mixin de
// pino se ejecuta dentro de la llamada al log, nunca de forma asíncrona.
class SyncContextManager implements ContextManager {
	#current: Context = ROOT_CONTEXT;

	active(): Context {
		return this.#current;
	}

	with<A extends unknown[], F extends (...args: A) => unknown>(
		context: Context,
		fn: F,
		thisArg?: ThisParameterType<F>,
		...args: A
	): ReturnType<F> {
		const previous = this.#current;
		this.#current = context;
		try {
			return fn.apply(thisArg, args) as ReturnType<F>;
		} finally {
			this.#current = previous;
		}
	}

	bind<T>(context: Context, target: T): T {
		return target;
	}

	enable(): this {
		return this;
	}

	disable(): this {
		this.#current = ROOT_CONTEXT;
		return this;
	}
}

context.setGlobalContextManager(new SyncContextManager());

// El módulo guarda el logger en una variable: cada test parte de uno nuevo.
async function importLogger() {
	vi.resetModules();
	return import('./logger');
}

describe('logger (pino)', () => {
	beforeEach(() => {
		state.logLines.length = 0;
		state.loggerOptions.length = 0;
		delete env.LOG_LEVEL;
	});

	function lastLine(): Record<string, unknown> {
		expect(state.logLines.length).toBeGreaterThan(0);
		return JSON.parse(state.logLines.at(-1)!);
	}

	it('escribe JSON con service y env en la base', async () => {
		const { default: logger } = await importLogger();
		logger.info({ hello: 'world' }, 'test message');

		const line = lastLine();
		expect(line.msg).toBe('test message');
		expect(line.hello).toBe('world');
		expect(line.service).toBe('y-tu-que-compras');
		// `dev` es false en el mock y no hay VERCEL_ENV: producción.
		expect(line.env).toBe('production');
	});

	it('usa `info` como nivel por defecto', async () => {
		const { default: logger } = await importLogger();
		logger.info('default level');
		expect(lastLine().level).toBe(30); // info
	});

	it('respeta LOG_LEVEL', async () => {
		env.LOG_LEVEL = 'warn';
		const { default: logger } = await importLogger();
		logger.info('filtered');
		expect(state.logLines).toHaveLength(0);
		logger.warn('visible');
		expect(lastLine().level).toBe(40); // warn
	});

	it('redacta los campos sensibles', async () => {
		const { default: logger } = await importLogger();
		logger.error({ password: 'secret', email: 'a@b.c', token: 't', secret: 's', ok: 1 }, 'failed');

		const line = lastLine();
		expect(line.password).toBe('[redacted]');
		expect(line.email).toBe('[redacted]');
		expect(line.token).toBe('[redacted]');
		expect(line.secret).toBe('[redacted]');
		expect(line.ok).toBe(1);
	});

	it('en producción no configura transport (rompe en serverless)', async () => {
		const { default: logger } = await importLogger();
		logger.info('x');
		expect(state.loggerOptions[0].transport).toBeUndefined();
	});

	it('el mixin inyecta trace_id/span_id con span activo y nada sin él', async () => {
		const { default: logger } = await importLogger();
		logger.info('without span');
		expect(lastLine().trace_id).toBeUndefined();

		// Basta con `spanContext()`: es lo único que lee el mixin.
		const fakeSpan = {
			spanContext: () => ({
				traceId: 'a'.repeat(32),
				spanId: 'b'.repeat(16),
				traceFlags: TraceFlags.SAMPLED,
				isRemote: false
			}),
			isRecording: () => true
		} as unknown as Span;

		context.with(trace.setSpan(context.active(), fakeSpan), () => {
			logger.info('with span');
		});

		const line = lastLine();
		expect(line.trace_id).toBe('a'.repeat(32));
		expect(line.span_id).toBe('b'.repeat(16));
	});
});
