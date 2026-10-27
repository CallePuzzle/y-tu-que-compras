import { describe, expect, it } from 'vitest';

import { isInternalPath, sanitizeInvitedEmail, sanitizeRedirectTo } from './redirect.js';

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

describe('sanitizeInvitedEmail', () => {
	it('devuelve el email del enlace de invitación si tiene forma de email', () => {
		expect(sanitizeInvitedEmail('invitada@example.com')).toBe('invitada@example.com');
		// Suficiente para un prefill: no se pretende validar identidad.
		expect(sanitizeInvitedEmail('a@b.c')).toBe('a@b.c');
	});

	it('ignora lo vacío y lo que no sea un email', () => {
		expect(sanitizeInvitedEmail(undefined)).toBeUndefined();
		expect(sanitizeInvitedEmail(null)).toBeUndefined();
		expect(sanitizeInvitedEmail('')).toBeUndefined();
		expect(sanitizeInvitedEmail('javascript:alert(1)')).toBeUndefined();
		expect(sanitizeInvitedEmail('no-es-un-email')).toBeUndefined();
		// Con espacios no hay email que valga (y un `Location` limpio no los lleva).
		expect(sanitizeInvitedEmail(' con espacios@example.com')).toBeUndefined();
	});
});
