import type {
	OpenAPIObject,
	ReferenceObject,
	ResponseObject,
	SchemaObject
} from 'openapi3-ts/oas31';
import { z } from 'zod/v4';

import { LIST_COLORS, LIST_ICONS, listSchema } from '#lib/schemas/list.js';
import { UNITS } from '#lib/schemas/item.js';
import { API_ERROR_STATUS, type ApiErrorCode } from './api-error.js';
import { apiItemCreateSchema, apiItemPatchSchema } from './api-items.js';
import { apiListPatchSchema } from './api-lists.js';
import { API_KEY_RATE_LIMIT } from './api-rate-limit.js';

// Spec OpenAPI 3.1 de la API pública /api/v1 (épica #260, US6 #266, tarea
// #267), servida sin sesión en `GET /api/v1/openapi.json`.
//
// Qué se deriva y qué se escribe a mano:
//
// - Los BODIES de las peticiones salen de los MISMOS schemas zod con los que
//   validan los endpoints (`listSchema`, `apiListPatchSchema`,
//   `apiItemCreateSchema`, `apiItemPatchSchema`) vía `z.toJSONSchema`, que
//   emite JSON Schema 2020-12 — el dialecto de OpenAPI 3.1. Cambiar un límite
//   o un enum en el schema cambia la spec sin tocar este fichero. Lo que zod no
//   sabe expresar (los `.refine`: «al menos un campo», «categoryId o category,
//   no ambos») se añade aquí (`minProperties`, descripciones).
// - Los catálogos (colores, iconos, unidades, códigos de error) y el límite de
//   peticiones se importan de su única fuente (`LIST_COLORS`, `UNITS`,
//   `API_ERROR_STATUS`, `API_KEY_RATE_LIMIT`).
// - Las RESPUESTAS (`ListView`, `ApiItemView`) son interfaces de TypeScript,
//   sin schema en runtime: se describen a mano y un spec
//   (`openapi.spec.ts`) comprueba que sus propiedades no se separan de las de
//   las interfaces. Automatizar del todo esa sincronización queda como mejora
//   futura.

/** JSON Schema (2020-12) del INPUT de un schema zod, sin el `$schema` de documento suelto. */
function bodySchema(schema: z.ZodType, extra: SchemaObject = {}): SchemaObject {
	const json: Record<string, unknown> = z.toJSONSchema(schema, { io: 'input' });
	delete json.$schema;
	return { ...(json as SchemaObject), ...extra };
}

/** Referencia a un componente de `components.<section>`. */
function ref(section: 'schemas' | 'responses' | 'parameters', name: string) {
	return { $ref: `#/components/${section}/${name}` };
}

/** Cuerpo JSON (petición o respuesta) con un schema. */
function json(schema: SchemaObject | ReferenceObject) {
	return { 'application/json': { schema } };
}

const RATE_LIMIT_SECONDS = API_KEY_RATE_LIMIT.timeWindowMs / 1000;

const DESCRIPTION = `API pública de **y-tu-que-compras**: listas de la compra y sus items de las familias a las que pertenece el usuario del token.

## Autenticación

Todas las operaciones (salvo esta spec) exigen \`Authorization: Bearer <clave>\`, con una clave de API creada en **Ajustes → Tokens de API** (\`/settings/api-tokens\`). La API no usa la cookie de sesión: un navegador con sesión abierta no tiene acceso sin token. Sin clave válida (ausente, revocada o caducada): \`401 unauthenticated\`.

La familia sale siempre de la URL (\`familyId\`): si el usuario del token no es miembro, \`403 forbidden\` (exista o no la familia). Un recurso que no existe o es de otra familia es \`404 not_found\`.

## Límite de peticiones

Cada clave admite **${API_KEY_RATE_LIMIT.maxRequests} peticiones por ${RATE_LIMIT_SECONDS} segundos**. La ventana se reinicia cuando pasan ${RATE_LIMIT_SECONDS} segundos desde la última petición aceptada. Al superarlo, la respuesta es \`429 rate_limited\` con la cabecera \`Retry-After\` (segundos) y los mismos segundos en \`error.details.retryAfter\`.

## Errores

Todos los errores comparten el envelope \`{ "error": { "code", "message", "details"? } }\`. El \`code\` es estable (el \`message\` puede cambiar) y fija el status HTTP: ${Object.entries(
	API_ERROR_STATUS
)
	.map(([code, status]) => `\`${code}\` (${status})`)
	.join(
		', '
	)}. Un método sin handler en una ruta responde \`405 method_not_allowed\` con la cabecera \`Allow\`.`;

/** Una respuesta de error con el envelope y un ejemplo. */
function errorResponse(
	description: string,
	example: { code: ApiErrorCode; message: string; details?: Record<string, unknown> },
	headers?: ResponseObject['headers']
): ResponseObject {
	return {
		description,
		...(headers ? { headers } : {}),
		content: {
			'application/json': { schema: ref('schemas', 'Error'), example: { error: example } }
		}
	};
}

/** Respuestas de error comunes a TODAS las operaciones autenticadas de una familia. */
const COMMON_ERRORS = {
	'401': ref('responses', 'Unauthenticated'),
	'403': ref('responses', 'Forbidden'),
	'429': ref('responses', 'RateLimited'),
	'500': ref('responses', 'InternalError')
} as const;

/** Las de una mutación con body JSON. */
const BODY_ERRORS = {
	'400': ref('responses', 'InvalidJson'),
	'422': ref('responses', 'ValidationFailed')
} as const;

const NOT_FOUND = { '404': ref('responses', 'NotFound') } as const;

/** Respuesta 204 de los DELETE. */
const NO_CONTENT: ResponseObject = { description: 'Borrado. Sin body.' };

/** Construye la spec. Pura: mismos schemas → misma spec. */
export function buildOpenApiSpec(): OpenAPIObject {
	return {
		openapi: '3.1.0',
		info: {
			title: 'y-tu-que-compras API',
			version: '1.0.0',
			description: DESCRIPTION
		},
		servers: [{ url: '/api/v1' }],
		security: [{ bearerAuth: [] }],
		tags: [
			{ name: 'Lists', description: 'Listas de la compra de una familia.' },
			{ name: 'Items', description: 'Items de una lista.' },
			{ name: 'Meta', description: 'Documentación de la propia API.' }
		],
		paths: {
			'/openapi.json': {
				get: {
					tags: ['Meta'],
					operationId: 'getOpenApiSpec',
					summary: 'Esta spec OpenAPI',
					description: 'Pública: no exige token ni cuenta para el límite de peticiones.',
					security: [],
					responses: {
						'200': {
							description: 'La spec OpenAPI 3.1 de /api/v1.',
							content: json({ type: 'object' })
						}
					}
				}
			},
			'/families/{familyId}/lists': {
				parameters: [ref('parameters', 'familyId')],
				get: {
					tags: ['Lists'],
					operationId: 'listLists',
					summary: 'Listas de la familia',
					description: 'Las listas de la familia, por orden de creación, con sus contadores.',
					responses: {
						'200': {
							description: 'Las listas de la familia.',
							content: json({ type: 'array', items: ref('schemas', 'List') })
						},
						...COMMON_ERRORS
					}
				},
				post: {
					tags: ['Lists'],
					operationId: 'createList',
					summary: 'Crear una lista',
					requestBody: { required: true, content: json(ref('schemas', 'ListCreate')) },
					responses: {
						'201': {
							description: 'La lista creada (contadores a 0).',
							content: json(ref('schemas', 'List'))
						},
						...BODY_ERRORS,
						...COMMON_ERRORS
					}
				}
			},
			'/families/{familyId}/lists/{listId}': {
				parameters: [ref('parameters', 'familyId'), ref('parameters', 'listId')],
				get: {
					tags: ['Lists'],
					operationId: 'getList',
					summary: 'Una lista con sus items',
					description:
						'La lista con sus items en el orden de la app: pendientes primero, luego comprados; dentro de cada grupo, por `order` y antigüedad.',
					responses: {
						'200': {
							description: 'La lista con sus items.',
							content: json(ref('schemas', 'ListWithItems'))
						},
						...NOT_FOUND,
						...COMMON_ERRORS
					}
				},
				patch: {
					tags: ['Lists'],
					operationId: 'updateList',
					summary: 'Modificar una lista',
					description:
						'Actualización parcial de nombre, color y/o icono: los campos ausentes conservan su valor.',
					requestBody: { required: true, content: json(ref('schemas', 'ListPatch')) },
					responses: {
						'200': {
							description: 'La lista actualizada.',
							content: json(ref('schemas', 'List'))
						},
						...BODY_ERRORS,
						...NOT_FOUND,
						...COMMON_ERRORS
					}
				},
				delete: {
					tags: ['Lists'],
					operationId: 'deleteList',
					summary: 'Borrar una lista',
					description: 'Borra la lista y todos sus items. Repetir el borrado da 404.',
					responses: { '204': NO_CONTENT, ...NOT_FOUND, ...COMMON_ERRORS }
				}
			},
			'/families/{familyId}/lists/{listId}/items': {
				parameters: [ref('parameters', 'familyId'), ref('parameters', 'listId')],
				post: {
					tags: ['Items'],
					operationId: 'createItem',
					summary: 'Añadir un item a una lista',
					description:
						'Añade un item pendiente al final de la lista (el `order` lo asigna el servidor).',
					requestBody: { required: true, content: json(ref('schemas', 'ItemCreate')) },
					responses: {
						'201': {
							description: 'El item creado.',
							content: json(ref('schemas', 'Item'))
						},
						...BODY_ERRORS,
						...NOT_FOUND,
						...COMMON_ERRORS
					}
				}
			},
			'/families/{familyId}/lists/{listId}/items/{itemId}': {
				parameters: [
					ref('parameters', 'familyId'),
					ref('parameters', 'listId'),
					ref('parameters', 'itemId')
				],
				patch: {
					tags: ['Items'],
					operationId: 'updateItem',
					summary: 'Modificar un item',
					description:
						'Actualización parcial: nombre, cantidad, unidad, categoría, marca de comprado (`purchased`) y/o posición (`order`). Los campos ausentes conservan su valor.',
					requestBody: { required: true, content: json(ref('schemas', 'ItemPatch')) },
					responses: {
						'200': {
							description: 'El item actualizado.',
							content: json(ref('schemas', 'Item'))
						},
						...BODY_ERRORS,
						...NOT_FOUND,
						...COMMON_ERRORS
					}
				},
				delete: {
					tags: ['Items'],
					operationId: 'deleteItem',
					summary: 'Borrar un item',
					description: 'Repetir el borrado da 404.',
					responses: { '204': NO_CONTENT, ...NOT_FOUND, ...COMMON_ERRORS }
				}
			}
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description:
						'Clave de API creada en /settings/api-tokens, en `Authorization: Bearer <clave>`.'
				}
			},
			parameters: {
				familyId: {
					name: 'familyId',
					in: 'path',
					required: true,
					description: 'Id de la familia. El usuario del token debe ser miembro (si no, 403).',
					schema: { type: 'string' }
				},
				listId: {
					name: 'listId',
					in: 'path',
					required: true,
					description: 'Id de una lista de esa familia.',
					schema: { type: 'string' }
				},
				itemId: {
					name: 'itemId',
					in: 'path',
					required: true,
					description: 'Id de un item de esa lista.',
					schema: { type: 'string' }
				}
			},
			schemas: {
				List: {
					type: 'object',
					description: 'Una lista de la compra con sus contadores.',
					required: ['id', 'name', 'color', 'icon', 'itemCount', 'pendingCount'],
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						color: {
							type: 'string',
							enum: [...LIST_COLORS],
							description: 'Tono de la paleta de la app.'
						},
						icon: {
							type: 'string',
							enum: [...LIST_ICONS],
							description: 'Nombre del icono (set lucide).'
						},
						itemCount: { type: 'integer', minimum: 0, description: 'Items de la lista.' },
						pendingCount: {
							type: 'integer',
							minimum: 0,
							description: 'Items pendientes de comprar.'
						}
					}
				},
				ListWithItems: {
					description: 'Una lista con sus items embebidos.',
					allOf: [
						ref('schemas', 'List'),
						{
							type: 'object',
							required: ['items'],
							properties: { items: { type: 'array', items: ref('schemas', 'Item') } }
						}
					]
				},
				Item: {
					type: 'object',
					description: 'Un item de una lista.',
					required: [
						'id',
						'name',
						'quantity',
						'unit',
						'categoryId',
						'categoryName',
						'purchased',
						'order'
					],
					properties: {
						id: { type: 'string' },
						name: { type: 'string' },
						quantity: { type: 'number', description: 'Cantidad (hasta 3 decimales).' },
						unit: { type: 'string', enum: [...UNITS] },
						categoryId: {
							type: ['string', 'null'],
							description: 'Id de la categoría, o `null` sin categoría.'
						},
						categoryName: {
							type: ['string', 'null'],
							description: 'Nombre de esa categoría, o `null` sin categoría.'
						},
						purchased: { type: 'boolean', description: 'Marca de comprado.' },
						order: {
							type: 'integer',
							minimum: 0,
							description: 'Posición dentro de su grupo (pendientes/comprados) de la lista.'
						}
					}
				},
				ListCreate: bodySchema(listSchema(), { description: 'Datos de una lista nueva.' }),
				ListPatch: bodySchema(apiListPatchSchema(), {
					minProperties: 1,
					description: 'Campos a cambiar de la lista: al menos uno.'
				}),
				ItemCreate: bodySchema(apiItemCreateSchema(), {
					description:
						'Datos de un item nuevo. La categoría es opcional y va por id (`categoryId`) o por nombre (`category`, sin distinguir mayúsculas ni acentos), no ambas. Una categoría que no es de la familia se guarda como «sin categoría».'
				}),
				ItemPatch: bodySchema(apiItemPatchSchema(), {
					minProperties: 1,
					description:
						'Campos a cambiar del item: al menos uno. La categoría va por id (`categoryId`) o por nombre (`category`), no ambas; `null` o `""` la quita y su ausencia la conserva.'
				}),
				Error: {
					type: 'object',
					description: 'Envelope de TODOS los errores de la API.',
					required: ['error'],
					properties: {
						error: {
							type: 'object',
							required: ['code', 'message'],
							properties: {
								code: {
									type: 'string',
									enum: Object.keys(API_ERROR_STATUS),
									description: 'Identificador estable del error; fija el status HTTP.'
								},
								message: {
									type: 'string',
									description: 'Texto legible (en inglés); puede cambiar.'
								},
								details: {
									type: 'object',
									additionalProperties: true,
									description:
										'Detalle legible por máquina: errores por campo en `validation_failed`, `retryAfter` en `rate_limited`, `errorId` en `internal_error`.'
								}
							}
						}
					}
				}
			},
			responses: {
				InvalidJson: errorResponse('El body no es JSON (o la petición está mal formada).', {
					code: 'invalid_json',
					message: 'Request body must be JSON'
				}),
				Unauthenticated: errorResponse(
					'Sin `Authorization: Bearer`, o clave inválida, revocada o caducada.',
					{
						code: 'unauthenticated',
						message: 'Missing or invalid API key'
					}
				),
				Forbidden: errorResponse(
					'El usuario del token no es miembro de la familia de la URL (o la familia no existe).',
					{ code: 'forbidden', message: 'Not a member of this family' }
				),
				NotFound: errorResponse('El recurso no existe o es de otra familia.', {
					code: 'not_found',
					message: 'List not found'
				}),
				ValidationFailed: errorResponse(
					'El body JSON no cumple el schema. `details` trae los errores por campo (`{ campo: [mensajes] }`; los que no son de un campo, en `_errors`).',
					{
						code: 'validation_failed',
						message: 'Invalid request body',
						details: { name: ['Too small: expected string to have >=1 characters'] }
					}
				),
				RateLimited: errorResponse(
					`La clave superó su límite de ${API_KEY_RATE_LIMIT.maxRequests} peticiones por ${RATE_LIMIT_SECONDS} segundos.`,
					{
						code: 'rate_limited',
						message: 'Rate limit exceeded for this API key',
						details: { retryAfter: 42 }
					},
					{
						'Retry-After': {
							description: 'Segundos que esperar antes de reintentar.',
							schema: { type: 'integer', minimum: 1 }
						}
					}
				),
				InternalError: errorResponse(
					'Error no controlado del servidor. `details.errorId` identifica el error en los logs.',
					{
						code: 'internal_error',
						message: 'Internal server error',
						details: { errorId: '00000000-0000-0000-0000-000000000000' }
					}
				)
			}
		}
	};
}

let cached: OpenAPIObject | undefined;

/** La spec, construida una vez por proceso (los schemas no cambian en runtime). */
export function getOpenApiSpec(): OpenAPIObject {
	cached ??= buildOpenApiSpec();
	return cached;
}
