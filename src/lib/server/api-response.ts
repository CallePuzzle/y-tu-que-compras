// Respuestas de la API pública /api/v1 (épica #260, tarea #269).
//
// `json()` de kit pone `content-type: application/json` sin charset y no toca
// la caché; la API fija ambas cosas en un único sitio: charset explícito para
// clientes que no asumen UTF-8, y `no-store` porque los datos son privados de
// la familia y cambian con cada compra (ni el navegador ni un proxy deben
// guardarlos). Los errores (`apiError`, `api-error.ts`) llevan las mismas cabeceras.

/** Content-Type de todas las respuestas JSON de la API. */
export const API_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Cabeceras comunes de las respuestas de datos de la API. */
export const API_HEADERS = {
	'content-type': API_CONTENT_TYPE,
	'cache-control': 'no-store'
} as const;

/** Respuesta JSON de éxito de la API (200 por defecto), sin caché. */
export function apiJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: API_HEADERS });
}
