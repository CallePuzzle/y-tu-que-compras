<script lang="ts">
	import { enhance as kitEnhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { SvelteMap } from 'svelte/reactivity';
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
	import { buildTourContext, continueOnboardingTour } from '$lib/utils/tour';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { UNIT_STEP, redondearCantidad } from '$lib/pantry-steps.js';
	import { readdSchema } from '$lib/schemas/pantry.js';
	import type { Unit } from '$lib/schemas/item.js';
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
	// en cuanto falla la petición, que es la reversión prometida. A diferencia
	// del toggle, el delta NO se anota en el click sino en el submit function
	// (#148): solo ahí es seguro que el envío ha empezado de verdad.
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
	 *
	 * Se llama desde el submit function, NO desde el `onclick` (#148): esta
	 * función solo ha de correr cuando el evento submit HA DISPARADO y la
	 * petición está echada a andar. En el click, pintar el optimista podía
	 * mover la fila de sección (En casa ↔ Agotados) y desmontar el `<form>`
	 * ANTES de que el navegador disparase el submit: el ajuste quedaba pintado
	 * sin petición, la UI decía 0/agotado y la BD conservaba cantidad — al
	 * recargar, el producto «dejaba de estar agotado». Sin click-optimista,
	 * todo optimista implica un POST en vuelo: si el badge llega a 0, la base
	 * acaba en 0 (con el clamp del servidor, como mucho antes).
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
	} /**
	 * Ciclo de un ajuste: anota el optimista cuando el submit ARRANCA (ver
	 * `anotarAjuste`) y el submit function devuelto decide qué hacer con el
	 * resultado: en éxito refresca y retira SU delta DESPUÉS, cuando la
	 * verdad ya está en pantalla; en fallo revierte y avisa. El orden importa
	 * (#148): retirar el delta ANTES del load dejaba un instante con datos
	 * viejos y ajuste ya quitado — el badge volvía a la cantidad vieja y la
	 * fila saltaba de «Agotados» a «En casa» y de vuelta al llegar el
	 * refresco. Retirado después, el badge no se mueve en todo el camino:
	 * mientras vuela el refresco sigue el optimista (dato viejo + delta, que
	 * `cantidadVisible` clampea a 0) y al aterrizar la verdad el delta sobra
	 * exactamente. Con clics rápidos hay varias peticiones en vuelo sobre la
	 * misma fila y cada una retira SOLO su delta (#113).
	 */
	function alAjustar(id: string, unit: Unit): SubmitFunction {
		return ({ formData }) => {
			// El delta de ESTA petición viaja en el formulario (el value del
			// botón pulsado, ±1) y aquí se convierte al paso de la unidad:
			// la misma cuenta que aplica el servidor.
			const delta = Number(formData.get('delta')) * UNIT_STEP[unit];
			anotarAjuste(id, delta);
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update();
					retirarAjuste(id, delta);
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
		};
	}

	// ---- Re-añadir a la compra (checklist #74): modal con SU formulario de
	// superforms (id «readd-item», lo pone el load) para no pisar al ajuste.
	// El schema se construye EN RENDER, como los demás (regla i18n). ----
	const readdSchemaCompiled = readdSchema({
		listIdError: m.schema_readd_list_error(),
		listIdLabel: m.schema_readd_list_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.pantry_readd_quantity_label()
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
		// ya dentro, igual que el modal de edición.
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
			quantity: item.quantity > 0 ? item.quantity : Math.max(1, UNIT_STEP[item.unit])
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

	// Tour de onboarding (#142): el paso de despensa ancla a la lista o al
	// estado vacío (el que se pinte); con las listas del load se construye el
	// ctx por si el tour retrocede hacia los pasos de detalle.
	$effect(() => {
		void continueOnboardingTour(page.url.pathname, data.user ?? null, buildTourContext(data.lists));
	});
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

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

	{#if data.items.length === 0}
		<!-- Estado vacío con CTA (checklist #72): la despensa se llena al
		     finalizar compras, así que el CTA manda a las listas. `id` de
		     ancla del tour (#142): paso de despensa sin productos. -->
		<div id="tour-pantry-empty" class="mt-8 flex flex-col items-center gap-3 text-center">
			<Refrigerator aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.pantry_empty()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{m.pantry_go_lists()}
			</a>
		</div>
	{:else}
		<!-- Una fila de producto: stepper −/+ (checklist #73) y botón de
		     re-añadir (checklist #74). El snippet lo comparten las dos
		     secciones («En casa» y «Agotados»); un agotado no pinta el −: de
		     cero no se puede consumir más, solo reponer o re-añadir. -->
		{#snippet filaProducto(item: PantryRow)}
			{@const cantidad = cantidadVisible(item)}
			<li
				class={`bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 sm:px-4 ${cantidad === 0 ? 'opacity-60' : ''}`}
			>
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
					>
						<Plus aria-hidden="true" />
					</button>
				</form>
				<!-- Re-añadir a la compra (checklist #74): abre el modal con el
				     selector de lista y la cantidad. En un agotado es EL botón:
				     la memoria de «esto se compra» lista para volver. -->
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					title={m.pantry_readd()}
					aria-label={m.pantry_readd()}
					onclick={() => abrirReAnadir(item)}
				>
					<ShoppingCart aria-hidden="true" />
				</button>
			</li>
		{/snippet}

		<!-- Envoltorio con el `id` de ancla del tour (#142): cubre las dos
		     secciones («En casa» y «Agotados»), una sola de las cuales puede
		     existir según lo que haya en despensa. -->
		<div id="tour-pantry-list">
			<!-- «En casa»: lo que queda. Su cabecera solo cuando hay agotados
			     debajo (si no, sobra), como pendientes/comprados en la lista. -->
			{#if enCasa.length > 0}
				{#if agotados.length > 0}
					<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
						{m.pantry_section_home()}
					</h2>
				{/if}
				<ul class="mt-4 flex list-none flex-col gap-2">
					{#each enCasa as item (item.id)}
						{@render filaProducto(item)}
					{/each}
				</ul>
			{/if}

			<!-- «Agotados»: consumidos hasta 0. Se quedan en la despensa (el
			     servidor NO los borra) para poder re-añadirlos a la compra. -->
			{#if agotados.length > 0}
				<h2
					class={`text-sm font-semibold tracking-wide uppercase opacity-60 ${enCasa.length > 0 ? 'mt-6' : 'mt-4'}`}
				>
					{m.pantry_section_out()}
				</h2>
				<ul class={`flex list-none flex-col gap-2 ${enCasa.length > 0 ? 'mt-2' : 'mt-4'}`}>
					{#each agotados as item (item.id)}
						{@render filaProducto(item)}
					{/each}
				</ul>
			{/if}
		</div>
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
