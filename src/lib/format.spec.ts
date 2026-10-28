import { describe, expect, it } from 'vitest';
import { formatDateTime, formatPrice, formatQuantity } from './format.js';

// Formato localizado del historial (issue #76). Los resultados concretos son
// los de `Intl` con las locales de Paraglide (es/en) y la zona Europe/Madrid
// fijada en `format.ts`: deterministas en cualquier máquina, porque ni la
// locale ni la zona dependen del entorno que ejecuta el spec.

/**
 * El espacio entre número y símbolo de la moneda es de NO SEPARACIÓN, y su
 * ancho exacto cambia con el runtime (V8 usa el fino U+202F, JSC el U+00A0):
 * se normaliza para poder comparar con un espacio normal.
 */
function plano(texto: string): string {
	return texto.replaceAll(/[\u{00a0}\u{202f}]/gu, ' ');
}

describe('formatPrice', () => {
	it('formatea el precio con la convención española: coma decimal, punto de millar y símbolo al final', () => {
		// Seis cifras para que se vea el agrupado (el español no agrupa a 4
		// dígitos: `minimumGroupingDigits: 2` del CLDR).
		expect(plano(formatPrice(123456.78, 'es'))).toBe('123.456,78 €');
	});

	it('formatea el precio con la convención inglesa: punto decimal, coma de millar y símbolo delante', () => {
		expect(plano(formatPrice(123456.78, 'en'))).toBe('€123,456.78');
	});

	it('siempre en euros: la divisa es del producto, solo la presentación es local', () => {
		expect(plano(formatPrice(7.5, 'es'))).toBe('7,50 €');
		expect(plano(formatPrice(7.5, 'en'))).toBe('€7.50');
	});
});

describe('formatQuantity', () => {
	it('usa la coma decimal en español y el punto en inglés', () => {
		expect(formatQuantity(0.25, 'es')).toBe('0,25');
		expect(formatQuantity(0.25, 'en')).toBe('0.25');
	});

	it('agrupa los millares con la convención de cada idioma', () => {
		expect(formatQuantity(12500, 'es')).toBe('12.500');
		expect(formatQuantity(12500, 'en')).toBe('12,500');
	});

	it('hasta 3 decimales y sin ceros de relleno', () => {
		expect(formatQuantity(2, 'es')).toBe('2');
		expect(formatQuantity(1.125, 'es')).toBe('1,125');
		expect(formatQuantity(1.0004, 'es')).toBe('1');
	});
});

describe('formatDateTime', () => {
	// Instante fijo en UTC (28 oct 2026, 18:45 UTC): en Madrid ya acaba el
	// horario de verano (CET, UTC+1), así que son las 19:45 locales — sea cual
	// sea la zona del sistema que ejecute el spec.
	const INSTANTE = new Date('2026-10-28T18:45:00Z');

	it('formatea la fecha con la convención española: día antes que mes, hora 24h', () => {
		expect(formatDateTime(INSTANTE, 'es')).toBe('28 oct 2026, 19:45');
	});

	it('formatea la fecha con la convención inglesa: mes antes que día, hora 12h', () => {
		expect(formatDateTime(INSTANTE, 'en')).toBe('Oct 28, 2026, 7:45 PM');
	});
});
