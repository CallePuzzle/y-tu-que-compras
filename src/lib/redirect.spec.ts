import { describe, expect, it } from 'vitest';

import { isInternalPath, sanitizeRedirectTo } from './redirect.js';

describe('isInternalPath', () => {
	it('acepta rutas relativas al origen, con o sin query', () => {
		expect(isInternalPath('/')).toBe(true);
		expect(isInternalPath('/families/123')).toBe(true);
		expect(isInternalPath('/families/123?orden=asc')).toBe(true);
	});

	it('rechaza lo vacío y lo externo', () => {
		expect(isInternalPath(undefined)).toBe(false);
		expect(isInternalPath(null)).toBe(false);
		expect(isInternalPath('')).toBe(false);
		// URLs absolutas y protocol-relative (`//host`): open redirects clásicos.
		expect(isInternalPath('https://malicioso.example')).toBe(false);
		expect(isInternalPath('//malicioso.example')).toBe(false);
		// El navegador trata `\` como `/` en URLs especiales: mismo truco.
		expect(isInternalPath('/\\malicioso.example')).toBe(false);
		// Sin barra inicial no es ruta absoluta.
		expect(isInternalPath('families')).toBe(false);
		// Caracteres de control: no pueden aparecer en un `Location` limpio.
		expect(isInternalPath('/families\r\nSet-Cookie: x')).toBe(false);
	});
});

describe('sanitizeRedirectTo', () => {
	it('devuelve la ruta tal cual si es interna', () => {
		expect(sanitizeRedirectTo('/families?orden=asc')).toBe('/families?orden=asc');
	});

	it('devuelve undefined si no lo es, para caer al destino por defecto', () => {
		expect(sanitizeRedirectTo('//malicioso.example')).toBeUndefined();
		expect(sanitizeRedirectTo(null)).toBeUndefined();
	});
});
