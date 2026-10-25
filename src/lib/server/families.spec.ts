import { describe, expect, it, vi } from 'vitest';

// `families.ts` importa `auth` ($lib/server/auth.js), que instancia better-auth
// (y con él el PrismaClient) al importar el módulo. Este spec sólo prueba
// `familySlug`, así que `auth` se sustituye por un stub: sin BD ni better-auth
// (en CI no hay `.env` y el init del adaptador Prisma reventaría).
vi.mock('$lib/server/auth.js', () => ({ auth: {} }));

import { familySlug } from './families.js';

// El formato que el plugin de tenancy impone al slug de una organización.
const PLUGIN_SLUG = /^[a-z0-9-]{1,50}$/;

describe('familySlug', () => {
	it('normaliza el nombre: minúsculas, sin diacríticos y no alfanuméricos a guion', () => {
		expect(familySlug('Familia García-López', 'abc123')).toBe('familia-garcia-lopez-abc123');
		expect(familySlug('Cañón y más Ñ', 'abc123')).toBe('canon-y-mas-n-abc123');
	});

	it('colapsa espacios y símbolos en un solo guion, sin guiones en los extremos', () => {
		expect(familySlug('  Los   Pérez!!  ', 'abc123')).toBe('los-perez-abc123');
	});

	it('cumple el formato del plugin incluso con nombres larguísimos', () => {
		const slug = familySlug('Familia '.repeat(30));
		expect(slug.length).toBeLessThanOrEqual(50);
		expect(slug).toMatch(PLUGIN_SLUG);
	});

	it('un nombre sin material slugueable cae en el stem «familia»', () => {
		const slug = familySlug('¿?¡! ★');
		expect(slug).toMatch(/^familia-[0-9a-f]{6}$/);
	});

	it('el sufijo por defecto es aleatorio: dos llamadas no colisionan', () => {
		const [a, b] = [familySlug('Casa'), familySlug('Casa')];
		expect(a).toMatch(/^casa-[0-9a-f]{6}$/);
		expect(a).not.toBe(b);
	});
});
