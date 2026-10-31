import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { RouteId } from '$app/types';
import { m } from '$lib/paraglide/messages.js';
import type { TourGuideClient, TourGuideOptions, TourGuideStep } from '$lib/types/tourguide';
import { tourUi } from './tour-ui.svelte.js';

async function createTourGuideClient(options: TourGuideOptions): Promise<TourGuideClient> {
	const module = (await import('@sjmc11/tourguidejs')) as unknown as {
		TourGuideClient: new (options: TourGuideOptions) => TourGuideClient;
	};
	return new module.TourGuideClient(options);
}

// `client.exit()` solo oculta el diálogo/backdrop (display: none), nunca los
// quita del DOM. Como cada página crea su propio TourGuideClient (el `$effect`
// la re-ejecuta al revalidar), un diálogo huérfano del cliente anterior
// duplicaría los id="tg-dialog-title"/"tg-dialog-body" del nuevo: el diálogo
// de la página destino se quedaría sin contenido.
function removeStaleTourDom() {
	if (typeof document === 'undefined') return;
	document.querySelectorAll('.tg-dialog, .tg-backdrop').forEach((el) => el.remove());
}

// Clave única del tour en localStorage: el estado sobrevive a las navegaciones
// entre páginas (cada una retoma el paso guardado) y recuerda que ya se vio.
export const TOUR_STORAGE_KEY = 'onboarding-tour-v1';

type TourState = {
	activeStep: number;
	finished: boolean;
};

export function getTourState(): TourState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(TOUR_STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as TourState;
	} catch {
		return null;
	}
}

export function setTourState(state: TourState) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
}

function finishTour(stepsLength: number) {
	setTourState({ activeStep: stepsLength - 1, finished: true });
}

/** Datos mínimos de una fila de listas para elegir la lista de ejemplo del tour. */
export type MinimalListRow = {
	id: string;
	itemCount: number;
	pendingCount: number;
};

/** Contexto que cada página pasa al tour: qué lista visitar y si tiene comprados. */
export type TourContext = {
	/** Lista que visita el tour en los pasos de detalle; undefined si no hay listas. */
	exampleListId?: string;
	/** Si la lista de ejemplo tiene items comprados: el paso «Finalizar» se ancla a su botón. */
	hasPurchasedItems?: boolean;
};

/**
 * El contexto para páginas que traen las filas de listas (/lists, /pantry): la
 * lista del tour prefiere una CON items comprados — así el paso «Finalizar
 * compra» encuentra su botón — y si no las hay, la primera; sin listas,
 * `exampleListId` queda undefined y esos pasos se muestran centrados.
 */
export function buildTourContext(lists: MinimalListRow[]): TourContext {
	const ejemplo = lists.find((lista) => lista.pendingCount < lista.itemCount) ?? lists[0];
	return {
		exampleListId: ejemplo?.id,
		hasPurchasedItems: ejemplo ? ejemplo.pendingCount < ejemplo.itemCount : false
	};
}

// Ids de ancla centralizados: las páginas los ponen en su HTML y los pasos
// los buscan, sin poder desincronizarse. `#add-name` ya existía (el input del
// alta rápida) y no lleva constante.
export const TOUR_HOME_CTA_ID = 'tour-home-cta';
export const TOUR_LISTS_CREATE_ID = 'tour-lists-create';
export const TOUR_FINALIZE_ID = 'tour-finalize';
export const TOUR_PANTRY_LIST_ID = 'tour-pantry-list';
export const TOUR_PANTRY_EMPTY_ID = 'tour-pantry-empty';
export const TOUR_FAMILIES_CREATE_ID = 'tour-families-create';

export type AppTourStep = TourGuideStep & {
	route?: RouteId;
	stepIndex?: number;
};

// Factoría y no `const` de módulo: las etiquetas `m.*` se resuelven al
// construir los pasos (dentro del `$effect` de cada página), con la locale
// viva en ese momento (regla i18n de `src/lib/routes.ts`).
function baseTourSteps(): AppTourStep[] {
	return [
		{
			title: m.tour_home_title(),
			content: m.tour_home_description(),
			target: `#${TOUR_HOME_CTA_ID}`,
			route: '/'
		},
		{
			title: m.tour_lists_create_title(),
			content: m.tour_lists_create_description(),
			target: `#${TOUR_LISTS_CREATE_ID}`,
			route: '/lists'
		},
		{
			title: m.tour_add_item_title(),
			content: m.tour_add_item_description(),
			target: '#add-name',
			route: '/lists/[listId]'
		},
		{
			title: m.tour_finalize_title(),
			content: m.tour_finalize_description(),
			target: `#${TOUR_FINALIZE_ID}`,
			route: '/lists/[listId]'
		},
		{
			title: m.tour_pantry_title(),
			content: m.tour_pantry_description(),
			target: `#${TOUR_PANTRY_LIST_ID}`,
			route: '/pantry'
		},
		{
			title: m.tour_families_create_title(),
			content: m.tour_families_create_description(),
			target: `#${TOUR_FAMILIES_CREATE_ID}`,
			route: '/families'
		}
	];
}

export function stepRouteMatches(stepRoute: RouteId | undefined, currentPath: string): boolean {
	if (!stepRoute) return true;
	if (stepRoute === currentPath) return true;
	// Rutas con parámetro (`/lists/[listId]`): cualquier segmento encaja.
	if (stepRoute.includes('[')) {
		const regex = new RegExp('^' + stepRoute.replace(/\[\w+\]/g, '[^/]+') + '$');
		return regex.test(currentPath);
	}
	return false;
}

// Un elemento oculto por CSS (p.ej. el pie en móvil) sigue en el DOM, así que
// document.querySelector(selector) puede devolverlo aunque no sea el visible
// para el viewport actual. Se elige el primero cuyo offsetParent exista.
function firstVisible(...selectors: string[]): HTMLElement | undefined {
	for (const selector of selectors) {
		const element = document.querySelector<HTMLElement>(selector);
		if (element && element.offsetParent !== null) return element;
	}
	return undefined;
}

/**
 * Los 6 pasos del tour, ya resueltos para el contexto de la página que los
 * pide. Los fallbacks anclan a `document.body` (paso centrado) con texto
 * alternativo, sin apuntar a elementos que no existen:
 *
 * - Alta rápida sin listas: no hay detalle al que navegar ni `#add-name`; el
 *   paso pierde su ruta y se muestra centrado donde esté el tour.
 * - Finalizar sin items comprados: el botón sólo se pinta con comprados; con
 *   lista de ejemplo se centra sobre esa misma página de detalle y sin listas
 *   también pierde la ruta.
 * - Despensa: lista o estado vacío, el que esté visible; si ninguno lo está
 *   (no debería ocurrir), centrado como última opción.
 */
export function buildTourSteps(ctx: TourContext): AppTourStep[] {
	const base = baseTourSteps();
	return base.map((step, index) => {
		const clone: AppTourStep = { ...step, stepIndex: index };

		if (step === base[2] && !ctx.exampleListId) {
			clone.target = document.body;
			clone.content = m.tour_add_item_no_lists_description();
			clone.route = undefined;
		}

		if (step === base[3] && !ctx.hasPurchasedItems) {
			clone.target = document.body;
			clone.content = m.tour_finalize_no_purchased_description();
			if (!ctx.exampleListId) clone.route = undefined;
		}

		if (step === base[4]) {
			clone.target =
				firstVisible(`#${TOUR_PANTRY_LIST_ID}`, `#${TOUR_PANTRY_EMPTY_ID}`) ?? document.body;
		}

		return clone;
	});
}

// TourGuideJS marca `_promiseWaiting = true` antes de invocar onBeforeStepChange
// y solo lo limpia si el callback resuelve sin abortar el cambio de paso. Como
// aquí abortamos el paso interno (navegamos nosotros con goto), `client.exit()`
// llamado desde dentro de ese callback rechazaría inmediatamente ("Promise
// waiting") y dejaría el diálogo bloqueado en loading para siempre. Se
// resetea el flag interno antes de salir para evitarlo.
function unblockClient(client: TourGuideClient) {
	(client as unknown as { _promiseWaiting: boolean })._promiseWaiting = false;
}

let navigatingBetweenPages = false;

async function navigateToStep(
	client: TourGuideClient,
	nextIndex: number,
	route: RouteId,
	ctx: TourContext
) {
	navigatingBetweenPages = true;
	setTourState({ activeStep: nextIndex, finished: false });
	unblockClient(client);
	await client.exit();
	// `client.exit()` solo oculta el diálogo y el backdrop (display: none), no
	// los elimina del DOM: dejarlos huérfanos duplica los id del diálogo que
	// monte la página destino (ver `removeStaleTourDom`).
	client.dialog?.remove();
	client.backdrop?.remove();
	activeClient = null;
	// El diálogo de la página actual desaparece: el layout puede volver a
	// mostrar el cajón si el usuario lo pide (#144).
	tourUi.dialogVisible = false;
	navigatingBetweenPages = false;

	switch (route) {
		case '/':
			await goto(resolve('/'));
			break;
		case '/lists':
			await goto(resolve('/lists'));
			break;
		case '/lists/[listId]':
			await goto(resolve('/lists/[listId]', { listId: String(ctx.exampleListId) }));
			break;
		case '/pantry':
			await goto(resolve('/pantry'));
			break;
		case '/families':
			await goto(resolve('/families'));
			break;
	}
}

async function handleBeforeStepChange(
	client: TourGuideClient,
	steps: AppTourStep[],
	currentPath: string,
	ctx: TourContext,
	nextStepIndex: number
) {
	const nextBaseStep = steps[nextStepIndex];
	if (!nextBaseStep) return;
	if (stepRouteMatches(nextBaseStep.route, currentPath)) return;
	if (!nextBaseStep.route) return;

	if (nextBaseStep.route.includes('[listId]') && !ctx.exampleListId) {
		// Defensiva: los fallbacks ya convierten este paso en centrado y sin
		// ruta cuando no hay lista de ejemplo; si aun así se pidiera navegar,
		// el tour termina con gracia en vez de ir a un detalle inexistente.
		finishTour(steps.length);
		unblockClient(client);
		await client.exit();
		tourUi.dialogVisible = false;
		throw new Error('Tour navigation aborted');
	}

	await navigateToStep(client, nextStepIndex, nextBaseStep.route, ctx);
	throw new Error('Tour navigation triggered');
}

async function runTour(steps: AppTourStep[], currentPath: string, ctx: TourContext) {
	const state = getTourState();
	if (state?.finished) return;

	const activeStep = state?.activeStep ?? 0;

	// Si nunca se ha visto este tour, solo se inicia desde la portada.
	if (!state && currentPath !== '/') return;

	const currentStep = steps[activeStep];
	if (!currentStep) return;

	if (!stepRouteMatches(currentStep.route, currentPath)) return;

	const client = await createTourGuideClient({
		activeStep,
		rememberStep: false,
		nextLabel: m.tour_next_button(),
		prevLabel: m.tour_prev_button(),
		finishLabel: m.tour_finish_button(),
		closeButton: true,
		showStepProgress: true,
		showStepDots: true,
		keyboardControls: true,
		exitOnEscape: true,
		exitOnClickOutside: false,
		completeOnFinish: false,
		autoScroll: true,
		autoScrollSmooth: true,
		activeStepInteraction: true
	});
	activeClient = client;

	// La opción `activeStep` del constructor no la usa la librería: `start()`
	// llama a `visitStep(this.activeStep)`, y ese campo de instancia solo se
	// fija internamente (por defecto 0). Sin esto, cada página siempre
	// arrancaría el tour en el paso 0 en vez de retomar el guardado.
	client.activeStep = activeStep;

	await client.setOptions({ steps });

	client.onBeforeStepChange(async (_currentStepIndex, nextStepIndex) => {
		await handleBeforeStepChange(client, steps, currentPath, ctx, nextStepIndex);
		setTourState({ activeStep: nextStepIndex, finished: false });
	});

	client.onBeforeExit(() => {
		if (navigatingBetweenPages) return;
		finishTour(steps.length);
		activeClient = null;
		tourUi.dialogVisible = false;
	});

	client.onFinish(() => {
		finishTour(steps.length);
		activeClient = null;
		tourUi.dialogVisible = false;
	});

	await client.start();
	// El diálogo ya está en pantalla: el estado compartido avisa al layout,
	// que cierra el cajón lateral por `bind:open` si estaba abierto (#144).
	tourUi.dialogVisible = true;
}

// Cliente del tour actualmente visible. Lo consulta la guardia de
// `continueOnboardingTour`: las revalidaciones (`useRefetchOnVisible` en
// /lists y /lists/[listId], el cambio de familia vía `invalidateAll`)
// re-ejecutan el `$effect` a mitad de tour y, sin la guardia, su
// `removeStaleTourDom()` se cargaría el diálogo en marcha y montaría otro.
let activeClient: TourGuideClient | null = null;

// El `$effect` que llama a esta función puede re-ejecutarse con cualquier
// cambio de `data` y no espera a que la llamada anterior termine. Sin este
// cerrojo, dos llamadas solapadas crearían dos `TourGuideClient`: el
// `removeStaleTourDom()` de la segunda se llevaría por delante el diálogo que
// la primera acaba de montar.
let tourInProgress = false;

/**
 * Retoma el tour en la página actual, en el paso guardado en localStorage.
 * Solo con sesión (no hay tour de invitado); si nunca se vio, solo arranca
 * desde la portada `/`. El `ctx` lo aporta cada página con lo que sabe.
 */
export async function continueOnboardingTour(
	currentPath: string,
	user: App.Locals['user'] | null,
	ctx: TourContext = {}
) {
	if (typeof window === 'undefined') return;
	if (!user) return;
	if (activeClient?.isVisible) return;
	if (tourInProgress) return;

	tourInProgress = true;
	try {
		removeStaleTourDom();
		await runTour(buildTourSteps(ctx), currentPath, ctx);
	} finally {
		tourInProgress = false;
	}
}

/** Reinicia el tour desde el paso 1: reset de estado y salto a la portada. */
export function startOnboardingTour() {
	setTourState({ activeStep: 0, finished: false });
	if (typeof window !== 'undefined') {
		window.location.href = resolve('/');
	}
}
