// Límite de peticiones por clave de API (T5.1, #271). Vive en su propio
// módulo, sin dependencias, para que la spec OpenAPI (T6.1, #267) documente el
// MISMO número que aplica el plugin sin arrastrar la configuración de
// better-auth; `auth.ts` lo usa y lo reexporta.

/** `maxRequests` por `timeWindowMs` (ver la semántica de la ventana en `auth.ts`). */
export const API_KEY_RATE_LIMIT = { maxRequests: 60, timeWindowMs: 60 * 1000 } as const;
