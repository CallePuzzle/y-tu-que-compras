<script lang="ts">
	import { enhance as kitEnhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { SvelteMap } from 'svelte/reactivity';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import { formatQuantity } from '$lib/format.js';
	import { m } from '$lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '$lib/refetch-on-visible.svelte.js';
	import { unitLabels } from '$lib/units.js';
	import { textoError } from '$lib/forms.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { UNIT_STEP, redondearCantidad } from '$lib/pantry-steps.js';
	import { readdSchema } from '$lib/schemas/pantry.js';
	import type { Unit } from '$lib/schemas/item.js';
	import { createSwapy, utils, type Swapy } from 'swapy';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de despensa (la trae el load). */
	type PantryRow = PageProps['data']['items'][number];

	// Etiquetas traducidas de las unidades (en render: regla i18n).
	const UNIT_LABEL = unitLabels();

	// ---- Consumir / devolver (checklist #73): stepper −/+ por fila con
	// actualización OPTIMISTA, la misma técnica del toggle de comprado. ----
	// El ajuste que aún no ha confirmado el servidor viaja en `ajustes`
	// (id -> delta acumulado): la UI pinta la cantidad ENCIMA de la que trae
	// el load y retira el optimista cuando llega la verdad del servidor — o
	// en cuanto falla la petición, que es la reversión prometida. Como en el
	// toggle, el delta se anota en el click del botón (ANTES del envío) y el
	// submit function solo decide qué hacer con el resultado.
	//
	// SvelteMap y no `$state(new Map())`: en Svelte 5 el deep-proxy de
	// `$state` solo cubre objetos y arrays PLANOS — un Map pasa sin proxyar y
	// sus mutaciones no repintan nada (revisado en código y verificado con un
	// test de componente: el badge seguía clavado al valor del servidor).
	const ajustes = new SvelteMap<string, number>();
	let falloAjuste: string | null = $state(null);

	/** La cantidad mostrada: la del servidor más el ajuste en vuelo, sin negativos. */
	function cantidadVisible(item: PantryRow): number {
		const base = item.quantity + (ajustes.get(item.id) ?? 0);
		// El redondeo cierra el flotante a los 3 decimales de la columna (0,3
		// − 0,25 pintaría 0,049999…): lo que se muestra es lo que guardará la base.
		return Math.max(0, redondearCantidad(base));
	}

	/**
	 * Las dos secciones de la vista: lo que queda en casa y lo agotado. Un
	 * producto consumido hasta 0 NO desaparece: baja a «Agotados» atenuado —
	 * es la memoria de la compra habitual, con su botón de re-añadir a punto —
	 * y solo se va de la despensa si se quita explícitamente (#74).
	 */
	const enCasa = $derived(data.items.filter((item) => cantidadVisible(item) > 0));
	const agotados = $derived(data.items.filter((item) => cantidadVisible(item) === 0));

	/**
	 * Anota el delta del botón pulsado como ajuste en vuelo (optimista). El
	 * delta NO es un ±1 genérico: es el PASO de la unidad (±0,25 en kg/L,
	 * ±100 en g/ml), el mismo que aplica el servidor — si no, el badge
	 * pintaría valores que el servidor nunca guardará (#113).
	 */
	function anotarAjuste(id: string, delta: number) {
		ajustes.set(id, redondearCantidad((ajustes.get(id) ?? 0) + delta));
		falloAjuste = null;
	}

	/**
	 * Retira el ajuste de UNA petición resuelta: solo SU delta, no la entrada
	 * entera. Con clics rápidos hay varias peticiones en vuelo sobre la misma
	 * fila y borrar al llegar la primera descartaría el delta de las demás:
	 * el badge volvería al valor viejo para luego volver a subir (#113).
	 */
	function retirarAjuste(id: string, delta: number) {
		const quedan = redondearCantidad((ajustes.get(id) ?? 0) - delta);
		if (quedan === 0) {
			ajustes.delete(id);
		} else {
			ajustes.set(id, quedan);
		}
	}

	// ---- Reordenar (#134): drag-to-swap con Swapy en LAS DOS secciones. ----
	// El patrón «dinámico» de la librería, un contenedor POR SECCIÓN (en casa
	// y agotados): los slots son POSICIONES estables y el contenido de cada
	// una lo decide su mapa, con `manualSwap` para que sea Svelte quien mueve
	// el contenido al cambiar el mapa — si Swapy moviera el DOM por su cuenta
	// se pisaría con el keyed each. Dos contenedores también impiden cruzar
	// particiones arrastrando: un swap solo cabe dentro de la suya. Y con
	// `swapMode: 'drop'`: el swap ocurre al SOLTAR sobre otra fila, porque
	// el modo hover de Swapy 1.0.5 revienta el drag (su animación de
	// asentamiento lee `dragEvent()` justo después de cerrarse y lanza
	// «Cannot read properties of null (reading 'relativeX')» — verificado en
	// Brave y Firefox —, aborta el flujo de `pointerup` y `onSwapEnd` nunca
	// dispara el POST). Como en el ajuste de arriba, el swap se pinta al
	// instante y el POST viaja al asentarse; en fallo el mapa vuelve al
	// orden del load con el aviso.
	// Cada mapa es un `$derived` ESCRIBIBLE: su valor base es la identidad del
	// orden que trae el load, y cada asignación (swap en el aire, teclado,
	// reversión) lo pisa HASTA que los productos de la sección cambien — que
	// es justo el reset a la verdad del servidor: un POST confirmado llega
	// con este mismo orden (no se mueve nada), un fallo vuelve aquí al
	// revocarse, y un producto que entra o sale de la sección (consumido a
	// cero, repuesto) aterriza en su sitio sin mapas rancios.
	let mapaEnCasa = $derived(utils.initSlotItemMap(enCasa, 'id'));
	let mapaAgotados = $derived(utils.initSlotItemMap(agotados, 'id'));
	let falloReorden: string | null = $state(null);

	/** Los contenedores Swapy de cada sección (los `<ul>`). */
	let contenedorEnCasa: HTMLElement | undefined = $state();
	let contenedorAgotados: HTMLElement | undefined = $state();
	let swapyEnCasa: Swapy | null = null;
	let swapyAgotados: Swapy | null = null;

	/** Las filas pintadas por sección: slots fijos con su producto asignado.
	 *  Las referencias colgantes (un producto quitado por otro miembro antes
	 *  de que el load re-sincronice el mapa) se saltan. */
	const slottedEnCasa = $derived(
		utils.toSlottedItems(enCasa, 'id', mapaEnCasa).filter((par) => par.item)
	);
	const slottedAgotados = $derived(
		utils.toSlottedItems(agotados, 'id', mapaAgotados).filter((par) => par.item)
	);

	// Cualquier repintado deja el DOM distinto de lo que Swapy cree: relee
	// slots e items. El rAF espera a que el keyed each haya movido sus nodos
	// (el reset del mapa de arriba encadena otro ciclo de render).
	$effect(() => {
		void slottedEnCasa;
		requestAnimationFrame(() => swapyEnCasa?.update());
	});
	$effect(() => {
		void slottedAgotados;
		requestAnimationFrame(() => swapyAgotados?.update());
	});

	$effect(() => {
		if (!contenedorEnCasa) {
			return;
		}
		swapyEnCasa = crearInstancia(contenedorEnCasa, 'enCasa', (mapa) => (mapaEnCasa = mapa));
		return () => {
			swapyEnCasa?.destroy();
			swapyEnCasa = null;
		};
	});
	$effect(() => {
		if (!contenedorAgotados) {
			return;
		}
		swapyAgotados = crearInstancia(contenedorAgotados, 'agotados', (mapa) => (mapaAgotados = mapa));
		return () => {
			swapyAgotados?.destroy();
			swapyAgotados = null;
		};
	});

	/**
	 * Una instancia de Swapy para una sección: el swap optimista dispara UNA
	 * vez, al soltar (`swapMode: 'drop'`), y el POST del orden nuevo viaja
	 * cuando la sesión asienta — en Swapy 1.x eso es `onSwapEnd` con
	 * `hasChanged`.
	 */
	function crearInstancia(
		contenedor: HTMLElement,
		seccion: 'enCasa' | 'agotados',
		fijarMapa: (mapa: Array<{ slot: string; item: string }>) => void
	): Swapy {
		const instancia = createSwapy(contenedor, { manualSwap: true, swapMode: 'drop' });
		instancia.onSwap((event) => {
			// El rAF deja pasar el ciclo del evento, como en el ejemplo de la
			// documentación para Svelte.
			requestAnimationFrame(() => fijarMapa(event.newSlotItemMap.asArray));
		});
		instancia.onSwapEnd((event) => {
			if (event.hasChanged) {
				enviarOrden(
					seccion,
					event.slotItemMap.asArray.map((par) => par.item)
				);
			}
		});
		return instancia;
	}

	let colaReorden: Promise<void> = Promise.resolve();

	/**
	 * El POST del orden nuevo de UNA sección, ENCADENADO: dos arrastres
	 * seguidos no pueden cruzar sus envíos — el servidor aplica el array
	 * completo de cada uno, así que manda el último ENVIADO, no el último
	 * recibido. La lista puede ser parcial (un producto creado por otro
	 * miembro mientras tanto no viaja): el servidor conserva su orden
	 * relativo detrás.
	 */
	function enviarOrden(seccion: 'enCasa' | 'agotados', ids: string[]) {
		colaReorden = colaReorden.then(async () => {
			const body = new FormData();
			for (const id of ids) {
				body.append('ids', id);
			}
			try {
				const respuesta = await fetch('?/reorder', { method: 'POST', body });
				if (!respuesta.ok) {
					throw new Error(`?/reorder -> ${respuesta.status}`);
				}
				falloReorden = null;
				// La verdad del servidor ya es este orden: el reset del mapa
				// que trae la invalidación es una no-operación a la vista.
				await invalidateAll();
			} catch {
				// Fallo (el servidor rechazó) o error (sin respuesta): la
				// reversión es volver al orden que traen los datos.
				if (seccion === 'enCasa') {
					mapaEnCasa = utils.initSlotItemMap(enCasa, 'id');
				} else {
					mapaAgotados = utils.initSlotItemMap(agotados, 'id');
				}
				falloReorden = m.pantry_error();
			}
		});
		return colaReorden;
	}

	/**
	 * El handle con teclado (#134): las flechas intercambian con el vecino
	 * DENTRO de la sección del item (el mapa que lo contenga decide cuál es;
	 * la otra no se toca — las particiones no se cruzan). Un paso de teclado
	 * ya es una sesión terminada: mismo camino de mapa optimista + POST.
	 */
	function moverProducto(itemId: string, delta: 1 | -1) {
		const enCasaIndice = mapaEnCasa.findIndex((par) => par.item === itemId);
		if (enCasaIndice !== -1) {
			intercambiar('enCasa', mapaEnCasa, enCasaIndice, enCasaIndice + delta);
			return;
		}
		const agotadosIndice = mapaAgotados.findIndex((par) => par.item === itemId);
		if (agotadosIndice !== -1) {
			intercambiar('agotados', mapaAgotados, agotadosIndice, agotadosIndice + delta);
		}
	}

	/** El swap del teclado: el mismo trato que el drag, con su POST. */
	function intercambiar(
		seccion: 'enCasa' | 'agotados',
		efectivo: Array<{ slot: string; item: string }>,
		de: number,
		a: number
	) {
		if (de === -1 || a < 0 || a >= efectivo.length) {
			return;
		}
		const mapa = efectivo.map((par) => ({ ...par }));
		[mapa[de].item, mapa[a].item] = [mapa[a].item, mapa[de].item];
		if (seccion === 'enCasa') {
			mapaEnCasa = mapa;
		} else {
			mapaAgotados = mapa;
		}
		falloReorden = null;
		enviarOrden(
			seccion,
			mapa.map((par) => par.item)
		);
	}

	/** Las flechas del handle, como evento (lo comparte el snippet de fila). */
	function teclaHandle(event: KeyboardEvent, itemId: string) {
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moverProducto(itemId, -1);
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			moverProducto(itemId, 1);
		}
	} /**
	 * Resultado de un ajuste: en fallo revierte y avisa; en éxito refresca.
	 * El optimista se retira ANTES de pedir el load: si se quitara después
	 * del `await update()`, la mutación cae en la misma continuación asíncrona
	 * que el refresco y el navegador no llega a repintarla (visto en e2e) —
	 * el badge se quedaba con el delta para siempre. El coste es un parpadeo
	 * de la cantidad vieja durante la revalidación, inferior a un badge
	 * congelado en un valor que el servidor ya desmintió.
	 */
	function alAjustar(id: string, unit: Unit): SubmitFunction {
		return () =>
			async ({ result, update, formData }) => {
				// El delta de ESTA petición viaja en el formulario (el value del
				// botón pulsado, ±1) y aquí se convierte al paso de la unidad:
				// la misma cuenta que hace el click y que aplica el servidor.
				const delta = Number(formData.get('delta')) * UNIT_STEP[unit];
				if (result.type === 'success') {
					retirarAjuste(id, delta);
					await update();
				} else {
					// Fallo (el servidor rechazó) o error (sin respuesta): la
					// reversión es retirar SOLO el optimista de esta petición, y
					// el badge vuelve hacia el estado que traen los datos. Sin
					// `update` en fallo, como el toggle de comprado: el aviso
					// vive aquí y no se duplica.
					falloAjuste =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? m.pantry_error())
							: m.pantry_error();
					retirarAjuste(id, delta);
				}
			};
	}

	// ---- Re-añadir a la compra (checklist #74): modal con SU formulario de
	// superforms (id «readd-item», lo pone el load) para no pisar al ajuste.
	// El schema se construye EN RENDER, como los demás (regla i18n). ----
	const readdSchemaCompiled = readdSchema({
		listIdError: m.schema_readd_list_error(),
		listIdLabel: m.schema_readd_list_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.pantry_readd_quantity_label(),
		pantryModeError: m.schema_readd_mode_error(),
		pantryModeLabel: m.pantry_readd_pantry_label(),
		newQuantityError: m.schema_readd_new_quantity_error(),
		newQuantityLabel: m.schema_readd_new_quantity_label()
	});

	// Aviso de éxito del re-añadido, fuera del modal (como editar en la lista).
	let exito: string | null = $state(null);

	/** El producto que se quiere re-añadir: fija título, id y cantidad por defecto. */
	let itemReAnadir: PantryRow | undefined = $state();
	let readdModal: { showModal(): void; close(): void } | undefined = $state();

	// svelte-ignore state_referenced_locally
	const readdForm = superForm(data.readdForm, {
		validators: zod4Client(readdSchemaCompiled),
		// Pesimista: el modal cierra cuando el load trae la lista con el item
		// y la despensa ya ajustadas, igual que el modal de edición.
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en los modales de la lista.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? m.pantry_readd_success();
				readdModal?.close();
			}
		}
	});
	const {
		form: readdFormData,
		enhance: readdEnhance,
		delayed: readdDelayed,
		message: readdMessage,
		errors: readdErrors
	} = readdForm;

	/** Abre el modal con el producto cargado y la primera lista por defecto. */
	function abrirReAnadir(item: PantryRow) {
		exito = null;
		itemReAnadir = item;
		readdMessage.set(undefined);
		readdErrors.clear();
		readdFormData.set({
			listId: data.lists[0]?.id ?? '',
			// La cantidad por defecto para la lista es la que hay en despensa:
			// «quiero lo mismo que me queda». Un agotado (a 0) no puede pedir
			// cero: se propone un paso de su unidad — 1 en las cuentas enteras
			// y 100 en g/ml; en kg/L manda el 1, que es como se compra.
			quantity: item.quantity > 0 ? item.quantity : Math.max(1, UNIT_STEP[item.unit]),
			pantryMode: 'keep',
			newQuantity: undefined
		});
		readdModal?.showModal();
	}

	// Refresco al volver a la pestaña (ver `useRefetchOnVisible`): la despensa
	// la mueven compras, consumos y re-añadidos de cualquier miembro — el
	// criterio «actualizada tras cada acción» de la #44 —, y no con el
	// formulario de re-añadir a medias.
	useRefetchOnVisible(() => readdForm.isTainted());

	/** La etiqueta del botón lleva el paso exacto: «Consumir 0,25 kg». */
	function etiquetaPaso(
		item: PantryRow,
		verbo: (params: { step: string; unit: string }) => string
	) {
		return verbo({
			step: formatQuantity(UNIT_STEP[item.unit], getLocale()),
			unit: UNIT_LABEL[item.unit]
		});
	}
</script>

<svelte:head>
	<title>{m.pantry_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.pantry_title()}</h1>

	<!-- Error de un ajuste sin JS (consumir/devolver): con JS vive en
	     `falloAjuste`, que revierte el optimista sin recargar. -->
	{#if actionData?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{actionData.error}
		</div>
	{/if}

	{#if falloAjuste}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{falloAjuste}
		</div>
	{/if}

	<!-- Fallo del reorden (#134): el optimista ya se revirtió al orden
	     guardado; el aviso lo explica, como el del ajuste de arriba. -->
	{#if falloReorden}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{falloReorden}
		</div>
	{/if}

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

	{#if data.items.length === 0}
		<!-- Estado vacío con CTA (checklist #72): la despensa se llena al
		     finalizar compras, así que el CTA manda a las listas. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<Refrigerator aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.pantry_empty()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{m.pantry_go_lists()}
			</a>
		</div>
	{:else}
		<!-- Una fila de producto: handle de arrastre (#134), stepper −/+
		     (checklist #73) y botón de re-añadir (checklist #74). El
		     snippet lo comparten las dos secciones («En casa» y
		     «Agotados»), cada una con SU contenedor Swapy: el `<li>` es el
		     slot (id de la posición en el mapa) y el contenido viaja en el
		     `data-swapy-item`. Un agotado no pinta el −: de cero no se
		     puede consumir más, solo reponer o re-añadir. -->
		{#snippet filaProducto(item: PantryRow, slotId: string)}
			{@const cantidad = cantidadVisible(item)}
			<li
				class={`bg-base-200 rounded-box px-3 py-2 sm:px-4 ${cantidad === 0 ? 'opacity-60' : ''}`}
				data-swapy-slot={slotId}
			>
				<div class="flex w-full items-center gap-2" data-swapy-item={item.id}>
					<!-- Handle de arrastre (#134): único punto que inicia el
					     drag, para no pisar el stepper ni los botones. Las
					     flechas mueven sin ratón; `touch-none` deja el gesto al
					     pointer de Swapy en lugar del scroll. -->
					<button
						type="button"
						data-swapy-handle
						class="btn btn-ghost btn-sm text-base-content/40 -ml-2 cursor-grab touch-none active:cursor-grabbing"
						aria-label={m.ui_reorder_handle({ name: item.name })}
						title={m.ui_reorder_handle({ name: item.name })}
						onkeydown={(event) => teclaHandle(event, item.id)}
					>
						<GripVertical aria-hidden="true" />
					</button>
					<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
					<form
						method="POST"
						action="?/adjust"
						use:kitEnhance={alAjustar(item.id, item.unit)}
						class="flex shrink-0 items-center gap-1"
					>
						<input type="hidden" name="item" value={item.id} />
						{#if cantidad > 0}
							<button
								type="submit"
								name="delta"
								value="-1"
								class="btn btn-ghost btn-sm"
								aria-label={etiquetaPaso(item, m.pantry_consume)}
								title={etiquetaPaso(item, m.pantry_consume)}
								onclick={() => anotarAjuste(item.id, -UNIT_STEP[item.unit])}
							>
								<Minus aria-hidden="true" />
							</button>
						{/if}
						<span class="badge badge-ghost tabular-nums">
							{formatQuantity(cantidad, getLocale())}
							{UNIT_LABEL[item.unit]}
						</span>
						<button
							type="submit"
							name="delta"
							value="1"
							class="btn btn-ghost btn-sm"
							aria-label={etiquetaPaso(item, m.pantry_restock)}
							title={etiquetaPaso(item, m.pantry_restock)}
							onclick={() => anotarAjuste(item.id, UNIT_STEP[item.unit])}
						>
							<Plus aria-hidden="true" />
						</button>
					</form>
					<!-- Re-añadir a la compra (checklist #74): abre el modal con el
					     selector de lista y el ajuste de despensa. En un agotado es EL
					     botón: la memoria de «esto se compra» lista para volver. -->
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						title={m.pantry_readd()}
						aria-label={m.pantry_readd()}
						onclick={() => abrirReAnadir(item)}
					>
						<ShoppingCart aria-hidden="true" />
					</button>
				</div>
			</li>
		{/snippet}

		<!-- «En casa»: lo que queda. Su cabecera solo cuando hay agotados
		     debajo (si no, sobra), como pendientes/comprados en la lista.
		     Contenedor Swapy propio (#134): los swaps de aquí no se cruzan
		     con los de «Agotados». -->
		{#if enCasa.length > 0}
			{#if agotados.length > 0}
				<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
					{m.pantry_section_home()}
				</h2>
			{/if}
			<ul
				class="mt-4 flex list-none flex-col gap-2"
				data-swapy-container="en-casa"
				bind:this={contenedorEnCasa}
			>
				{#each slottedEnCasa as par (par.slotId)}
					{#if par.item}
						{@render filaProducto(par.item, par.slotId)}
					{/if}
				{/each}
			</ul>
		{/if}

		<!-- «Agotados»: consumidos hasta 0. Se quedan en la despensa (el
		     servidor NO los borra) para poder re-añadirlos a la compra.
		     Contenedor Swapy propio (#134). -->
		{#if agotados.length > 0}
			<h2
				class={`text-sm font-semibold tracking-wide uppercase opacity-60 ${enCasa.length > 0 ? 'mt-6' : 'mt-4'}`}
			>
				{m.pantry_section_out()}
			</h2>
			<ul
				class={`flex list-none flex-col gap-2 ${enCasa.length > 0 ? 'mt-2' : 'mt-4'}`}
				data-swapy-container="agotados"
				bind:this={contenedorAgotados}
			>
				{#each slottedAgotados as par (par.slotId)}
					{#if par.item}
						{@render filaProducto(par.item, par.slotId)}
					{/if}
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<!-- Re-añadir a la compra (checklist #74): una modal compartida; cada botón
     de fila fija a qué producto se re-añade antes de abrirla. Con SU
     formulario de superforms (id «readd-item») para no pisar al ajuste. Los
     fallos del action (producto consumido por otro a la vez, lista borrada,
     error de servidor) se cuentan aquí dentro. -->
<Modal
	bind:this={readdModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.pantry_readd_title({ name: itemReAnadir?.name ?? '' })}</h2>
	<p class="mt-1 text-sm opacity-70">{m.pantry_readd_description()}</p>

	{#if data.lists.length === 0}
		<!-- Sin listas no hay destino posible: se explica y se manda a crearlas. -->
		<div class="mt-4 flex flex-col items-center gap-3 text-center">
			<p class="opacity-70">{m.pantry_readd_no_lists()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">{m.pantry_go_lists()}</a>
		</div>
	{:else}
		<form method="POST" action="?/readd" use:readdEnhance class="mt-4 flex flex-col gap-4">
			<!-- El id del producto de despensa viaja con el formulario. -->
			<input type="hidden" name="pantry" value={itemReAnadir?.id ?? ''} />

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="readd-list">{m.schema_readd_list_label()}</label>
				<select
					bind:value={$readdFormData.listId}
					aria-invalid={textoError($readdErrors.listId) ? 'true' : undefined}
					id="readd-list"
					name="listId"
					class="select w-full"
					required
				>
					{#each data.lists as lista (lista.id)}
						<option value={lista.id}>{lista.name}</option>
					{/each}
				</select>
				{#if textoError($readdErrors.listId)}
					<p class="fieldset-label text-error" role="alert">{textoError($readdErrors.listId)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="readd-quantity">{m.pantry_readd_quantity_label()}</label>
				<!-- Por defecto, la cantidad que hay en despensa: «lo mismo que
				     me queda». Sin `min` nativo: el corte lo hace zod en cliente
				     con el error del schema (igual que el alta de items). -->
				<input
					bind:value={$readdFormData.quantity}
					aria-invalid={textoError($readdErrors.quantity) ? 'true' : undefined}
					id="readd-quantity"
					name="quantity"
					type="number"
					class="input w-full"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if textoError($readdErrors.quantity)}
					<p class="fieldset-label text-error" role="alert">
						{textoError($readdErrors.quantity)}
					</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<span class="fieldset-label">{m.pantry_readd_pantry_label()}</span>
				<div class="flex flex-col gap-2">
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="keep"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_keep()}
					</label>
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="set"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_set()}
					</label>
					{#if $readdFormData.pantryMode === 'set'}
						<!-- Solo visible con «fijar nueva cantidad»: cuánto QUEDA. -->
						<div class="flex flex-col gap-1 pl-6">
							<label class="fieldset-label" for="readd-new-quantity"
								>{m.schema_readd_new_quantity_label()}</label
							>
							<input
								bind:value={$readdFormData.newQuantity}
								aria-invalid={textoError($readdErrors.newQuantity) ? 'true' : undefined}
								id="readd-new-quantity"
								name="newQuantity"
								type="number"
								class="input w-full"
								step="any"
								inputmode="decimal"
							/>
							{#if textoError($readdErrors.newQuantity)}
								<p class="fieldset-label text-error" role="alert">
									{textoError($readdErrors.newQuantity)}
								</p>
							{/if}
						</div>
					{/if}
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="remove"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_remove()}
					</label>
				</div>
				{#if textoError($readdErrors.pantryMode)}
					<p class="fieldset-label text-error" role="alert">
						{textoError($readdErrors.pantryMode)}
					</p>
				{/if}
			</div>

			{#if $readdMessage}
				<div class="alert alert-error text-sm" role="alert">
					{$readdMessage}
				</div>
			{/if}

			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => readdModal?.close()}>
					{m.ui_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={$readdDelayed}>
					{#if $readdDelayed}
						<span class="loading loading-spinner"></span>
					{/if}
					{m.pantry_readd()}
				</button>
			</div>
		</form>
	{/if}
</Modal>
