import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El tour navega con `goto` ($app/navigation): fuera del runtime de SvelteKit
// no hace nada, así que se simula (los tests de este fichero no arrancan el
// cliente real; sólo construyen pasos y estado). Se conservan el resto de
// exports del módulo real.
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	goto
}));

// El runtime de Paraglide lee la locale de la petición/cookie: fuera de la app
// se fija a mano (igual que en LanguageSwitcher.svelte.test.ts).
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
const setLocale = vi.hoisted(() => vi.fn());
vi.mock('$lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale,
	setLocale
}));

import {
	buildTourContext,
	buildTourSteps,
	continueOnboardingTour,
	getTourState,
	setTourState,
	stepRouteMatches,
	TOUR_STORAGE_KEY,
	type MinimalListRow
} from './tour.js';
import { m } from '$lib/paraglide/messages.js';

beforeEach(() => {
	localStorage.removeItem(TOUR_STORAGE_KEY);
});

afterEach(() => {
	// Los pasos de despensa buscan anclas en el documento: cada test deja el
	// body como estaba.
	document.body.replaceChildren();
});

/** Usuario mínimo con el shape de `App.Locals['user']` (sólo para guardias). */
const usuario = { id: 'u1' } as unknown as App.Locals['user'];

describe('stepRouteMatches', () => {
	it('un paso sin ruta encaja en cualquier página', () => {
		expect(stepRouteMatches(undefined, '/pantry')).toBe(true);
		expect(stepRouteMatches(undefined, '/')).toBe(true);
	});

	it('una ruta exacta sólo encaja consigo misma', () => {
		expect(stepRouteMatches('/lists', '/lists')).toBe(true);
		expect(stepRouteMatches('/lists', '/pantry')).toBe(false);
		expect(stepRouteMatches('/', '/lists')).toBe(false);
	});

	it('una ruta con parámetro encaja con cualquier segmento, pero no con más', () => {
		expect(stepRouteMatches('/lists/[listId]', '/lists/abc123')).toBe(true);
		expect(stepRouteMatches('/lists/[listId]', '/lists')).toBe(false);
		expect(stepRouteMatches('/lists/[listId]', '/lists/abc/extra')).toBe(false);
	});
});

describe('estado en localStorage', () => {
	it('sin clave guardada no hay estado', () => {
		expect(getTourState()).toBeNull();
	});

	it('el estado guardado sobrevive y se lee intacto', () => {
		setTourState({ activeStep: 3, finished: false });
		expect(getTourState()).toEqual({ activeStep: 3, finished: false });
	});

	it('un valor corrupto se trata como ausente (no revienta el tour)', () => {
		localStorage.setItem(TOUR_STORAGE_KEY, '{not-json');
		expect(getTourState()).toBeNull();
	});
});

describe('buildTourContext', () => {
	const filas: MinimalListRow[] = [
		{ id: 'l1', itemCount: 5, pendingCount: 5 },
		{ id: 'l2', itemCount: 4, pendingCount: 1 }
	];

	it('prefiere una lista con items comprados (el paso de finalizar podrá anclarse)', () => {
		expect(buildTourContext(filas)).toEqual({ exampleListId: 'l2', hasPurchasedItems: true });
	});

	it('sin nada comprado toma la primera lista y lo dice sin comprados', () => {
		const sinComprados: MinimalListRow[] = [
			{ id: 'l1', itemCount: 2, pendingCount: 2 },
			{ id: 'l2', itemCount: 1, pendingCount: 1 }
		];
		expect(buildTourContext(sinComprados)).toEqual({
			exampleListId: 'l1',
			hasPurchasedItems: false
		});
	});

	it('sin listas no hay ejemplo ni comprados', () => {
		expect(buildTourContext([])).toEqual({ exampleListId: undefined, hasPurchasedItems: false });
	});
});

describe('buildTourSteps', () => {
	it('con lista de ejemplo y comprados, los pasos de detalle van anclados a sus elementos', () => {
		const pasos = buildTourSteps({ exampleListId: 'l1', hasPurchasedItems: true });

		expect(pasos).toHaveLength(6);
		expect(pasos.map((paso) => paso.stepIndex)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(pasos[0].target).toBe('#tour-home-cta');
		expect(pasos[1].target).toBe('#tour-lists-create');
		expect(pasos[2].target).toBe('#add-name');
		expect(pasos[3].target).toBe('#tour-finalize');
		expect(pasos[5].target).toBe('#tour-families-create');
		// Las rutas de los dos pasos de detalle quedan para la navegación.
		expect(pasos[2].route).toBe('/lists/[listId]');
		expect(pasos[3].route).toBe('/lists/[listId]');
	});

	it('sin listas, el paso de alta rápida se centra (document.body) con texto alternativo y sin ruta', () => {
		const pasos = buildTourSteps({});

		expect(pasos[2].target).toBe(document.body);
		expect(pasos[2].content).toBe(m.tour_add_item_no_lists_description());
		expect(pasos[2].route).toBeUndefined();
	});

	it('sin comprados, el paso de finalizar se centra con texto alternativo', () => {
		const pasos = buildTourSteps({ exampleListId: 'l1', hasPurchasedItems: false });

		expect(pasos[3].target).toBe(document.body);
		expect(pasos[3].content).toBe(m.tour_finalize_no_purchased_description());
		// CON lista de ejemplo la ruta se conserva: el paso centrado se pinta
		// sobre la propia página de detalle a la que llegó el paso anterior.
		expect(pasos[3].route).toBe('/lists/[listId]');
	});

	it('sin listas ni comprados, ambos pasos pierden también la ruta', () => {
		const pasos = buildTourSteps({});

		expect(pasos[3].route).toBeUndefined();
	});

	it('el paso de despensa se ancla a la lista de productos si está en el documento', () => {
		const lista = document.createElement('div');
		lista.id = 'tour-pantry-list';
		document.body.append(lista);

		const pasos = buildTourSteps({});
		expect(pasos[4].target).toBe(lista);
	});

	it('el paso de despensa se ancla al estado vacío cuando no hay lista', () => {
		const vacio = document.createElement('div');
		vacio.id = 'tour-pantry-empty';
		document.body.append(vacio);

		const pasos = buildTourSteps({});
		expect(pasos[4].target).toBe(vacio);
	});

	it('el paso de despensa sin ninguna ancla visible se centra como última opción', () => {
		const pasos = buildTourSteps({});
		expect(pasos[4].target).toBe(document.body);
	});
});

describe('continueOnboardingTour (guardias previas al cliente)', () => {
	it('sin usuario no hace nada: ni escribe estado ni monta diálogo', async () => {
		await continueOnboardingTour('/', null);

		expect(getTourState()).toBeNull();
		expect(document.querySelectorAll('.tg-dialog, .tg-backdrop')).toHaveLength(0);
	});

	it('con el tour ya terminado no vuelve a arrancar (ni reescribe el estado)', async () => {
		setTourState({ activeStep: 5, finished: true });

		await continueOnboardingTour('/', usuario);

		expect(getTourState()).toEqual({ activeStep: 5, finished: true });
		expect(document.querySelectorAll('.tg-dialog, .tg-backdrop')).toHaveLength(0);
	});
});
