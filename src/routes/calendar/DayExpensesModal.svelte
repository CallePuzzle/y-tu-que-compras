<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Store from '@lucide/svelte/icons/store';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { formatPrice } from '#lib/format.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import type { PageData } from './$types';

	/**
	 * Detalle de GASTOS de un día del calendario (épica #212, tarea #220):
	 * el total del día y sus compras, cada una con su establecimiento y su
	 * total ENLAZANDO a su detalle del historial (`/history/[purchaseId]`) —
	 * la celda solo enseña la cifra abreviada; el ticket completo vive allí.
	 *
	 * Es el gemelo del detalle de menús (`DayDetailModal`), no su sustituto:
	 * un día puede tener compras Y menús, y si los tiene, un botón ofrece el
	 * otro detalle. La página hace el cambio de detalle CERRANDO este modal
	 * y abriendo el otro (dos vistas del mismo día, una en pantalla), no
	 * apilándolos — al contrario que editar/borrar, que SÍ apilan porque el
	 * detalle de debajo ha de seguir viéndose.
	 *
	 * La fecha se pinta como su clave `YYYY-MM-DD` (la identidad de la
	 * celda), igual que el detalle de menús.
	 */
	type Props = {
		/** Los gastos del mes agrupados por día, tal y como los trae el load. */
		purchasesByDay: PageData['purchasesByDay'];
		/** Los menús del mes: para ofrecer el otro detalle si el día también tiene. */
		mealPlans: PageData['mealPlans'];
		/** «Menús del día»: la página cierra este modal y abre el de menús. */
		onOpenMenus: (dateKey: string) => void;
	};

	let { purchasesByDay, mealPlans, onOpenMenus }: Props = $props();

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/** El día abierto (`YYYY-MM-DD`): `null` con el modal cerrado. */
	let dateKey: string | null = $state(null);

	// Igual que el detalle de menús: los datos salen SIEMPRE del load, así
	// que el modal repinta solo cuando la página invalida.
	const dayExpenses = $derived(dateKey ? (purchasesByDay[dateKey] ?? null) : null);

	/** Abre el detalle de gastos de UN día: la celda manda la clave `YYYY-MM-DD`. */
	export function open(key: string) {
		dateKey = key;
		modal?.showModal();
	}

	/** La cierra la página al cambiar a la otra vista del mismo día. */
	export function close() {
		modal?.close();
	}
</script>

<Modal
	bind:this={modal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	{#if dateKey && dayExpenses}
		<h2 class="text-lg font-bold">{m.calendar_day_expenses()}</h2>
		<p class="mt-1">
			<span class="badge badge-outline font-mono">{dateKey}</span>
		</p>

		<!-- El total del día, SIEMPRE completo (sin compacto): la cifra de la
		     celda es la abreviatura; esto es la verdad. -->
		<p
			class="bg-base-200 rounded-box mt-3 flex items-center justify-between p-3 text-sm font-semibold"
		>
			<span>{m.expenses_day_total()}</span>
			<span class="tabular-nums">{formatPrice(dayExpenses.total, getLocale())}</span>
		</p>

		<div class="mt-3 flex flex-col gap-2">
			{#each dayExpenses.purchases as purchase (purchase.id)}
				<!-- Cada compra ENLAZA a su detalle del historial (#220): la
				     fila entera es el enlace — el dedo no busca un hueco
				     pequeño en móvil. El total, completo también aquí. -->
				<a
					class="bg-base-200 hover:bg-base-300 rounded-box flex items-center justify-between gap-2 p-3 text-sm"
					href={resolve('/history/[purchaseId]', { purchaseId: purchase.id })}
				>
					<span class="flex min-w-0 items-center gap-2">
						<Store aria-hidden="true" class="size-4 shrink-0 opacity-70" />
						<span class="truncate">{purchase.storeName ?? m.history_no_store()}</span>
					</span>
					<span class="flex shrink-0 items-center gap-1 tabular-nums">
						{formatPrice(purchase.total, getLocale())}
						<ChevronRight aria-hidden="true" class="size-4 opacity-70" />
					</span>
				</a>
			{/each}
		</div>

		{#if (mealPlans[dateKey]?.length ?? 0) > 0}
			<!-- El día también tiene menús (#220): el otro detalle del día
			     queda a un botón; la página cambia de vista cerrando este. -->
			<button
				type="button"
				class="btn btn-outline btn-sm mt-4 self-start"
				onclick={() => dateKey && onOpenMenus(dateKey)}
			>
				{m.calendar_day_detail()}
			</button>
		{/if}
	{/if}
</Modal>
