import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El tour navega con `goto` ($app/navigation): fuera del runtime de SvelteKit
// no hace nada, así que se simula (los tests de este fichero no arrancan el
// cliente real; sólo construyen pasos y estado). Factory autosuficiente y sin
// `importOriginal`: el mocker de vitest no llega a resolver el original de
// kit 3 (`$app/navigation` es un `export * from '#app/navigation'`, y el
// grafo mockeado lo deja vacío); el superset de exports cubre al resto de
// importadores del grafo (superforms, componentes de @callepuzzle/svelte-ui).
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	disableScrollHandling: vi.fn(),
	goto,
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	onNavigate: vi.fn(),
	preloadCode: vi.fn(),
	preloadData: vi.fn(),
	pushState: vi.fn(),
	refreshAll: vi.fn(),
	replaceState: vi.fn(),
	snapshot: vi.fn()
}));

// El runtime de Paraglide lee la locale de la petición/cookie: fuera de la app
// se fija a mano (igual que en LanguageSwitcher.svelte.test.ts).
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
const setLocale = vi.hoisted(() => vi.fn());
vi.mock('#lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale,
	setLocale
}));

// La librería del tour se sustituye por un stub mínimo: los tests de abajo
// sí ARRANCAN el tour (a diferencia del resto del fichero, que sólo toca
// guardias y constructores) para comprobar el estado compartido del diálogo
// (`tourUi.dialogVisible`, #144), sin montar el diálogo real. Se guarda cada
// cliente creado para poder disparar sus callbacks como los haría la librería.
const fakeClients = vi.hoisted(() => {
	const created: Array<{
		activeStep: number;
		isVisible: boolean;
		dialog: null;
		backdrop: null;
		setOptions: ReturnType<typeof vi.fn>;
		start: ReturnType<typeof vi.fn>;
		onBeforeStepChange: ReturnType<typeof vi.fn>;
		onBeforeExit: ReturnType<typeof vi.fn>;
		onFinish: ReturnType<typeof vi.fn>;
	}> = [];
	function create() {
		const fakeClient = {
			activeStep: 0,
			isVisible: false,
			dialog: null,
			backdrop: null,
			setOptions: vi.fn(async () => {}),
			start: vi.fn(async () => {
				fakeClient.isVisible = true;
			}),
			onBeforeStepChange: vi.fn(),
			onBeforeExit: vi.fn(),
			onFinish: vi.fn()
		};
		created.push(fakeClient);
		return fakeClient;
	}
	return { create, created };
});
vi.mock('@sjmc11/tourguidejs', () => ({
	TourGuideClient: class {
		constructor() {
			return fakeClients.create();
		}
	}
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
import { tourUi } from './tour-ui.svelte.js';
import { m } from '#lib/paraglide/messages.js';

beforeEach(() => {
	localStorage.removeItem(TOUR_STORAGE_KEY);
});

afterEach(async () => {
	// Los pasos de despensa buscan anclas en el documento: cada test deja el
	// body como estaba.
	document.body.replaceChildren();

	// El cliente activo es estado de MÓDULO en `tour.ts` (sobrevive a los
	// tests): se cierra vía el `onBeforeExit` que registró el propio módulo,
	// igual que lo dispararía la librería, y así la guardia
	// `activeClient?.isVisible` de `continueOnboardingTour` no contamina al
	// test siguiente. El flag compartido vuelve a su valor de reposo.
	const last = fakeClients.created.at(-1);
	const onExit = last?.onBeforeExit.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
	if (onExit) await onExit();
	fakeClients.created.length = 0;
	tourUi.dialogVisible = false;
});

/** Usuario mínimo con el shape de `App.Locals['user']` (sólo para guardias). */
const user = { id: 'u1' } as unknown as App.Locals['user'];

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
	const rows: MinimalListRow[] = [
		{ id: 'l1', itemCount: 5, pendingCount: 5 },
		{ id: 'l2', itemCount: 4, pendingCount: 1 }
	];

	it('prefiere una lista con items comprados (el paso de finalizar podrá anclarse)', () => {
		expect(buildTourContext(rows)).toEqual({ exampleListId: 'l2', hasPurchasedItems: true });
	});

	it('sin nada comprado toma la primera lista y lo dice sin comprados', () => {
		const withoutPurchased: MinimalListRow[] = [
			{ id: 'l1', itemCount: 2, pendingCount: 2 },
			{ id: 'l2', itemCount: 1, pendingCount: 1 }
		];
		expect(buildTourContext(withoutPurchased)).toEqual({
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
		const steps = buildTourSteps({ exampleListId: 'l1', hasPurchasedItems: true });

		expect(steps).toHaveLength(6);
		expect(steps.map((step) => step.stepIndex)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(steps[0].target).toBe('#tour-home-cta');
		expect(steps[1].target).toBe('#tour-lists-create');
		expect(steps[2].target).toBe('#add-name');
		expect(steps[3].target).toBe('#tour-finalize');
		expect(steps[5].target).toBe('#tour-families-create');
		// Las rutas de los dos pasos de detalle quedan para la navegación.
		expect(steps[2].route).toBe('/lists/[listId]');
		expect(steps[3].route).toBe('/lists/[listId]');
	});

	it('sin listas, el paso de alta rápida se centra (document.body) con texto alternativo y sin ruta', () => {
		const steps = buildTourSteps({});

		expect(steps[2].target).toBe(document.body);
		expect(steps[2].content).toBe(m.tour_add_item_no_lists_description());
		expect(steps[2].route).toBeUndefined();
	});

	it('sin comprados, el paso de finalizar se centra con texto alternativo', () => {
		const steps = buildTourSteps({ exampleListId: 'l1', hasPurchasedItems: false });

		expect(steps[3].target).toBe(document.body);
		expect(steps[3].content).toBe(m.tour_finalize_no_purchased_description());
		// CON lista de ejemplo la ruta se conserva: el paso centrado se pinta
		// sobre la propia página de detalle a la que llegó el paso anterior.
		expect(steps[3].route).toBe('/lists/[listId]');
	});

	it('sin listas ni comprados, ambos pasos pierden también la ruta', () => {
		const steps = buildTourSteps({});

		expect(steps[3].route).toBeUndefined();
	});

	it('el paso de despensa se ancla a la lista de productos si está en el documento', () => {
		const list = document.createElement('div');
		list.id = 'tour-pantry-list';
		document.body.append(list);

		const steps = buildTourSteps({});
		expect(steps[4].target).toBe(list);
	});

	it('el paso de despensa se ancla al estado vacío cuando no hay lista', () => {
		const empty = document.createElement('div');
		empty.id = 'tour-pantry-empty';
		document.body.append(empty);

		const steps = buildTourSteps({});
		expect(steps[4].target).toBe(empty);
	});

	it('el paso de despensa sin ninguna ancla visible se centra como última opción', () => {
		const steps = buildTourSteps({});
		expect(steps[4].target).toBe(document.body);
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

		await continueOnboardingTour('/', user);

		expect(getTourState()).toEqual({ activeStep: 5, finished: true });
		expect(document.querySelectorAll('.tg-dialog, .tg-backdrop')).toHaveLength(0);
		expect(tourUi.dialogVisible).toBe(false);
	});
});

describe('continueOnboardingTour (arranca el tour: estado del diálogo, #144)', () => {
	it('con el diálogo en pantalla, el estado compartido lo marca visible', async () => {
		// Estado pendiente en la portada: el tour retoma y monta el diálogo
		// (aquí, el stub). El layout lee este flag para cerrar el cajón.
		setTourState({ activeStep: 0, finished: false });

		await continueOnboardingTour('/', user);

		expect(fakeClients.created).toHaveLength(1);
		expect(fakeClients.created[0].start).toHaveBeenCalledTimes(1);
		expect(tourUi.dialogVisible).toBe(true);
	});

	it('al salir del tour, el estado deja de marcarlo visible', async () => {
		setTourState({ activeStep: 0, finished: false });
		await continueOnboardingTour('/', user);

		// El cierre (Escape, botón o programático) dispara `onBeforeExit`: se
		// invoca como lo haría la librería con el cliente activo.
		const fakeClient = fakeClients.created[0];
		const onExit = fakeClient.onBeforeExit.mock.calls[0][0] as () => Promise<void>;
		await onExit();

		expect(tourUi.dialogVisible).toBe(false);
		// `finishTour` fija el último paso: el tour queda visto para siempre.
		expect(getTourState()).toEqual({ activeStep: 5, finished: true });
	});
});
