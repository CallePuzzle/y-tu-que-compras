import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';

import { auth } from '$lib/server/auth.js';
import { MAX_FAMILIES_PER_USER, isFamilyLimitReached } from '$lib/server/tenancy.js';

/** Familia con los campos que la UI necesita (el plugin devuelve más). */
export interface Family {
	id: string;
	name: string;
}

/** El usuario ya pertenece a `FAMILIES_MAX` familias: no puede crear otra. */
export class FamilyLimitReachedError extends Error {
	constructor() {
		super(`Max ${MAX_FAMILIES_PER_USER} families per user`);
		this.name = 'FamilyLimitReachedError';
	}
}

/** Tope de familias por usuario, para los mensajes de la UI. */
export const FAMILIES_MAX = MAX_FAMILIES_PER_USER;

/**
 * Las familias del usuario, vía el endpoint del plugin: su hook de filtrado
 * (ver `$lib/server/tenancy.ts`) deja sólo aquellas donde el usuario es miembro,
 * que es justo la «lista de familias» del criterio de aceptación.
 *
 * Las cabeceras de la petición llevan la cookie de sesión (identidad) y el
 * Accept-Language (los mensajes de error del plugin salen ya en el idioma del
 * usuario), que es todo lo que el endpoint necesita.
 */
export async function listFamilies(event: RequestEvent): Promise<Family[]> {
	// `query: {}` es solo tipado (el plugin declara el objeto query como
	// requerido aunque todos sus campos sean opcionales; ver
	// Zytera/better-auth-tenancy#26): sin orden explícito vale lo que dé el plugin.
	const { items } = await auth.api.listOrganizations({
		headers: event.request.headers,
		query: {}
	});
	return items.map(({ id, name }) => ({ id, name }));
}

/**
 * Crea la familia vía el plugin. Además de la organización, su
 * `onEntityCreated` (en `$lib/server/tenancy.ts`) siembra los roles y da de
 * alta al creador como admin; si eso falla, el plugin deshace la creación y
 * aquí llega el error: no hay familia a medias.
 *
 * Si el usuario ya alcanza el tope (`MAX_FAMILIES_PER_USER`, guardado en el
 * hook `organization/create` del plugin), lanza `FamilyLimitReachedError` para
 * que el formulario pueda dar un mensaje concreto y no el genérico.
 *
 * `metadata: undefined` es solo tipado, no semántica: el zod del endpoint lo
 * tiene opcional, pero el tipo de entrada del plugin (3.2.2) lo declara
 * requerido (ver Zytera/better-auth-tenancy#26).
 */
export async function createFamily(
	event: RequestEvent,
	family: { name: string; slug: string }
): Promise<void> {
	try {
		await auth.api.createOrganization({
			body: { ...family, metadata: undefined },
			headers: event.request.headers
		});
	} catch (error) {
		if (isFamilyLimitReached(error)) {
			throw new FamilyLimitReachedError();
		}
		throw error;
	}
}

/**
 * Deriva el `slug` de una familia a partir de su nombre.
 *
 * El plugin de tenancy exige un `slug` único con formato `^[a-z0-9-]+$` y
 * máximo 50 caracteres, pero la UI (issue #58) sólo pide el nombre: el slug es
 * un identificador técnico que el usuario nunca ve, así que se fabrica aquí.
 *
 * Se añade siempre un sufijo aleatorio en vez de intentar el slug limpio y
 * reintentar si existe: «colisión imposible en la práctica» sin bucles ni
 * errores de slug que traducir. Es el mismo trato que dan Notion o Linear a sus
 * ids cortos.
 *
 * @param name   Nombre de la familia, ya validado (no vacío).
 * @param suffix Sufijo aleatorio inyectable para los tests (6 hex por defecto).
 * @returns Slug normalizado, siempre válido para el plugin.
 */
export function familySlug(name: string, suffix: string = newSlugSuffix()): string {
	// Hueco para el sufijo y su guion: el techo de 50 lo pone el plugin.
	const base = slugify(name)
		.slice(0, 50 - suffix.length - 1)
		.replace(/-+$/, '');

	// Un nombre sin material slugueable («¿?¡!») no puede dejar el slug vacío.
	const stem = base.length > 0 ? base : 'familia';
	return `${stem}-${suffix}`;
}

/** Minúsculas, sin diacríticos y todo lo no alfanumérico a guion. */
function slugify(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function newSlugSuffix(): string {
	// Hex minúsculas: cumple el formato del slug sin normalizar nada más.
	return randomUUID().replaceAll('-', '').slice(0, 6);
}
