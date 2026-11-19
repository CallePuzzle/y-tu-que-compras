import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { compileErrors, validate } from '@readme/openapi-parser';
import type { ResponseObject, SchemaObject } from 'openapi3-ts/oas31';
import { describe, expect, it } from 'vitest';

import { API_ERROR_STATUS } from './api-error.js';
import { API_KEY_RATE_LIMIT } from './api-rate-limit.js';
import type { ApiItemView } from './items.js';
import type { ListView } from './lists.js';
import { buildOpenApiSpec } from './openapi.js';

// Spec de SERVIDOR sin base de datos (tarea #267): la spec OpenAPI valida como
// 3.1 y no se separa de la superficie real de /api/v1 — cada `+server.ts`
// tiene su path y sus métodos, y las respuestas describen las propiedades de
// las interfaces que devuelven los endpoints. El e2e
// (`src/routes/api/v1/openapi.json/server.e2e.ts`) la descarga sin sesión.

const API_ROOT = join(process.cwd(), 'src/routes/api/v1');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Los `+server.ts` bajo `dir`, recursivamente. */
function serverFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return serverFiles(path);
		return entry.name === '+server.ts' ? [path] : [];
	});
}

/** `{ '/families/{familyId}/lists': ['get', 'post'], ... }` a partir de las rutas de kit. */
function routedOperations(): Record<string, string[]> {
	return Object.fromEntries(
		serverFiles(API_ROOT).map((file) => {
			const route = relative(API_ROOT, join(file, '..'))
				.split(sep)
				.map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}'))
				.join('/');
			const source = readFileSync(file, 'utf8');
			const methods = HTTP_METHODS.filter((method) =>
				new RegExp(`export const ${method}\\b`).test(source)
			).map((method) => method.toLowerCase());
			return [`/${route}`, methods];
		})
	);
}

/** Propiedades de un schema de componente (sin resolver `allOf`). */
function propertiesOf(name: string): string[] {
	const schema = buildOpenApiSpec().components?.schemas?.[name] as SchemaObject;
	return Object.keys(schema.properties ?? {}).sort();
}

// Las claves de las interfaces de respuesta, comprobadas por el compilador:
// `satisfies Record<keyof X, true>` falla en `bun run check` si a la interfaz
// le sobra o le falta una propiedad respecto a esta lista.
const LIST_VIEW_KEYS = {
	id: true,
	name: true,
	color: true,
	icon: true,
	itemCount: true,
	pendingCount: true
} satisfies Record<keyof ListView, true>;

const API_ITEM_VIEW_KEYS = {
	id: true,
	name: true,
	quantity: true,
	unit: true,
	categoryId: true,
	categoryName: true,
	purchased: true,
	order: true
} satisfies Record<keyof ApiItemView, true>;

describe('buildOpenApiSpec', () => {
	it('valida como OpenAPI 3.1', async () => {
		const spec = buildOpenApiSpec();
		expect(spec.openapi).toMatch(/^3\.1\./);

		// `validate` desreferencia sobre el objeto: se le pasa una copia.
		const result = await validate(structuredClone(spec) as Parameters<typeof validate>[0]);
		expect(result.valid, result.valid ? '' : compileErrors(result)).toBe(true);
		expect(result.specification).toBe('OpenAPI');
	});

	it('documenta exactamente los paths y métodos de los +server.ts de /api/v1', () => {
		const documented = Object.fromEntries(
			Object.entries(buildOpenApiSpec().paths ?? {}).map(([path, item]) => [
				path,
				HTTP_METHODS.map((method) => method.toLowerCase()).filter(
					(method) => method in (item as object)
				)
			])
		);

		expect(documented).toEqual(routedOperations());
	});

	it('exige Bearer en todo salvo la propia spec', () => {
		const spec = buildOpenApiSpec();
		expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
			type: 'http',
			scheme: 'bearer'
		});
		expect(spec.security).toEqual([{ bearerAuth: [] }]);

		for (const [path, item] of Object.entries(spec.paths ?? {})) {
			for (const method of ['get', 'post', 'patch', 'delete'] as const) {
				const operation = item?.[method];
				if (!operation) continue;
				if (path === '/openapi.json') {
					expect(operation.security).toEqual([]);
				} else {
					expect(operation.security, `${method} ${path}`).toBeUndefined();
					expect(Object.keys(operation.responses ?? {}), `${method} ${path}`).toEqual(
						expect.arrayContaining(['401', '403', '429', '500'])
					);
				}
			}
		}
	});

	it('describe el envelope de error con el catálogo de códigos', () => {
		const error = buildOpenApiSpec().components?.schemas?.Error as SchemaObject;
		const inner = error.properties?.error as SchemaObject;
		expect(inner.required).toEqual(['code', 'message']);
		expect((inner.properties?.code as SchemaObject).enum).toEqual(Object.keys(API_ERROR_STATUS));
	});

	it('documenta el rate limit: 429 con Retry-After y el límite real', () => {
		const spec = buildOpenApiSpec();
		const rateLimited = spec.components?.responses?.RateLimited as ResponseObject;
		expect(rateLimited?.headers).toHaveProperty('Retry-After');
		expect(rateLimited?.description).toContain(String(API_KEY_RATE_LIMIT.maxRequests));
		expect(spec.info.description).toContain('Retry-After');
	});

	it('documenta el WWW-Authenticate del 401', () => {
		const unauthenticated = buildOpenApiSpec().components?.responses
			?.Unauthenticated as ResponseObject;
		expect(unauthenticated?.headers).toHaveProperty('WWW-Authenticate');
	});

	it('las respuestas describen las propiedades de ListView y ApiItemView', () => {
		expect(propertiesOf('List')).toEqual(Object.keys(LIST_VIEW_KEYS).sort());
		expect(propertiesOf('Item')).toEqual(Object.keys(API_ITEM_VIEW_KEYS).sort());
	});

	it('deriva los bodies de los schemas zod de los endpoints', () => {
		const schemas = buildOpenApiSpec().components?.schemas ?? {};
		const itemCreate = schemas.ItemCreate as SchemaObject;
		expect(itemCreate.required).toEqual(['name', 'quantity', 'unit']);
		expect(Object.keys(itemCreate.properties ?? {})).toEqual(
			expect.arrayContaining(['categoryId', 'category'])
		);
		const itemPatch = schemas.ItemPatch as SchemaObject;
		expect(itemPatch.required).toBeUndefined();
		expect(Object.keys(itemPatch.properties ?? {})).toEqual(
			expect.arrayContaining(['purchased', 'order'])
		);
		expect((schemas.ListCreate as SchemaObject).required).toEqual(['name', 'color', 'icon']);
	});
});
