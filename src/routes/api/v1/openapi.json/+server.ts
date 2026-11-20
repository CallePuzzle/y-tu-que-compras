import type { RequestHandler } from './$types';
import { getOpenApiSpec } from '#lib/server/openapi.js';
import { apiJson } from '#lib/server/api-response.js';

// GET /api/v1/openapi.json (épica #260, tarea #267): la spec OpenAPI 3.1 de
// toda la API pública. PÚBLICA a propósito: sin `requireApiUser` (ni cuenta
// para el límite de peticiones de ninguna clave), para que cualquiera —y la
// página de documentación— pueda descargarla. El guard de sesión ya deja pasar
// todo `/api/v1/` (`isPublicPathname`). La spec se construye en
// `#lib/server/openapi.ts`, derivada de los schemas con los que validan los
// endpoints.
export const GET: RequestHandler = () => apiJson(getOpenApiSpec());
