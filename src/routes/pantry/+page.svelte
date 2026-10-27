<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance as kitEnhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import { m } from '$lib/paraglide/messages.js';
	import { UNIT_STEP, redondearCantidad } from '$lib/pantry-steps.js';
	import type { Unit } from '$lib/schemas/item.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de despensa (la trae el load). */
	type PantryRow = PageProps['data']['items'][number];

	/**
	 * Etiquetas de las unidades: los valores del enum NUNCA se muestran tal
	 * cual (son identificadores estables en inglés), los traduce Paraglide.
	 * El mapa se construye EN RENDER, no en scope de módulo (regla i18n).
	 */
	const UNIT_LABEL: Record<Unit, string> = {
		unit: m.unit_unit(),
		kilogram: m.unit_kilogram(),
		gram: m.unit_gram(),
		liter: m.unit_liter(),
		milliliter: m.unit_milliliter(),
		package: m.unit_package(),
		can: m.unit_can(),
		dozen: m.unit_dozen()
	};

	// Refresco al volver a la pestaña: la despensa la mueven las compras y los
	// consumos de CUALQUIER miembro y la v1 no tiene tiempo real, así que lo
	// barato y suficiente es revalidar al volver a mirar — el criterio
	// «actualizada tras cada acción» de la #44. La única peticiones en vuelo
	// posibles al volver son ajustes (−/+) propios, cuyo optimista pinta
	// ENCIMA de los datos: repintar la verdad del servidor a mitad de ajuste
	// es inofensivo, el resultado del ajuste llega un instante después.
	$effect(() => {
		function alVolver() {
			if (document.visibilityState !== 'visible') return;
			void invalidateAll();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});

	// ---- Consumir / devolver (checklist #73): stepper −/+ por fila con
	// actualización OPTIMISTA, la misma técnica del toggle de comprado. ----
	// El ajuste que aún no ha confirmado el servidor viaja en `ajustes`
	// (id -> delta acumulado): la UI pinta la cantidad ENCIMA de la que trae
	// el load y retira el optimista cuando llega la verdad del servidor — o
	// en cuanto falla la petición, que es la reversión prometida. Como en el
	// toggle, el delta se anota en el click del botón (ANTES del envío) y el
	// submit function solo decide qué hacer con el resultado.
	const ajustes = $state(new Map<string, number>());
	let falloAjuste: string | null = $state(null);

	/** La cantidad mostrada: la del servidor más el ajuste en vuelo, sin negativos. */
	function cantidadVisible(item: PantryRow): number {
		const base = item.quantity + (ajustes.get(item.id) ?? 0);
		// El redondeo cierra el flotante a los 3 decimales de la columna (0,3
		// − 0,25 pintaría 0,049999…): lo que se muestra es lo que guardará la base.
		return Math.max(0, redondearCantidad(base));
	}

	/** Las filas que se pintan: las consumidas hasta 0 en optimista ya no están. */
	const itemsVisibles = $derived(data.items.filter((item) => cantidadVisible(item) > 0));

	/** Anota el delta del botón pulsado como ajuste en vuelo (optimista). */
	function anotarAjuste(id: string, delta: 1 | -1) {
		ajustes.set(id, redondearCantidad((ajustes.get(id) ?? 0) + delta));
		falloAjuste = null;
	}

	/**
	 * Resultado de un ajuste: en fallo revierte y avisa; en éxito refresca.
	 * El optimista se retira ANTES de pedir el load: si se quitara después
	 * del `await update()`, la mutación cae en la misma continuación asíncrona
	 * que el refresco y el navegador no llega a repintarla (visto en e2e) —
	 * el badge se quedaba con el delta para siempre. El coste es un parpadeo
	 * de la cantidad vieja durante la revalidación, inferior a un badge
	 * congelado en un valor que el servidor ya desmintió.
	 */
	function alAjustar(id: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					ajustes.delete(id);
					await update();
				} else {
					// Fallo (el servidor rechazó) o error (sin respuesta): la
					// reversión es retirar el optimista, y el badge vuelve al
					// estado que traen los datos. Sin `update` en fallo, como el
					// toggle de comprado: el aviso vive aquí y no se duplica.
					falloAjuste =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? m.pantry_error())
							: m.pantry_error();
					ajustes.delete(id);
				}
			};
	}

	/** La etiqueta del botón lleva el paso exacto: «Consumir 0.25 kg». */
	function etiquetaPaso(
		item: PantryRow,
		verbo: (params: { step: string; unit: string }) => string
	) {
		return verbo({ step: String(UNIT_STEP[item.unit]), unit: UNIT_LABEL[item.unit] });
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
		<!-- Los productos con su stepper −/+ (checklist #73): consumir quita un
		     paso y devuelve lo añade; al llegar a 0 el producto desaparece (el
		     servidor lo borra y el optimista lo esconde mientras tanto). -->
		<ul class="mt-4 flex list-none flex-col gap-2">
			{#each itemsVisibles as item (item.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 sm:px-4">
					<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
					<form
						method="POST"
						action="?/adjust"
						use:kitEnhance={alAjustar(item.id)}
						class="flex shrink-0 items-center gap-1"
					>
						<input type="hidden" name="item" value={item.id} />
						<button
							type="submit"
							name="delta"
							value="-1"
							class="btn btn-ghost btn-sm"
							aria-label={etiquetaPaso(item, m.pantry_consume)}
							title={etiquetaPaso(item, m.pantry_consume)}
							onclick={() => anotarAjuste(item.id, -1)}
						>
							<Minus aria-hidden="true" />
						</button>
						<span class="badge badge-ghost tabular-nums">
							{cantidadVisible(item)}
							{UNIT_LABEL[item.unit]}
						</span>
						<button
							type="submit"
							name="delta"
							value="1"
							class="btn btn-ghost btn-sm"
							aria-label={etiquetaPaso(item, m.pantry_restock)}
							title={etiquetaPaso(item, m.pantry_restock)}
							onclick={() => anotarAjuste(item.id, 1)}
						>
							<Plus aria-hidden="true" />
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>
