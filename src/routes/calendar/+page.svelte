<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import CreateMealPlanModal from './CreateMealPlanModal.svelte';
	import DayDetailModal from './DayDetailModal.svelte';
	import MonthGrid from './MonthGrid.svelte';
	import type { PageData, PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * Las dos vistas del calendario (épica #212). La de gastos sigue vacía
	 * (#217): sus datos llegarán con #215. La de menús cuelga del load
	 * (#222): los menús del mes se pintan en la celda de su día y pulsar un
	 * día abre SU DETALLE si ya tiene menús (#221) o la creación si está
	 * vacío. La pestaña solo decide qué se pinta dentro, así que de momento
	 * basta estado local, sin query param.
	 */
	type CalendarTab = 'expenses' | 'menu';
	let activeTab: CalendarTab = $state('expenses');

	/** Un menú del día, tal y como lo trae el load (grupo `YYYY-MM-DD`). */
	type DayMealPlan = PageData['mealPlans'][string][number];

	// Aviso de éxito FUERA del modal (#222): el menú creado se ve en su celda
	// cuando el load pesimista repinta el grid; el texto confirma. El error de
	// crear se queda dentro del modal, como en editar item.
	let successMessage: string | null = $state(null);

	let createModal: CreateMealPlanModal | undefined = $state();

	// Detalle del día (#221) y borrado con confirmación (patrón de familias y
	// categorías): el detalle queda ABIERTO bajo el modal de editar o de
	// borrar — ambos son `<dialog>` nativos apilados y al cerrarse el de
	// arriba, el detalle repinta con los datos del load pesimista.
	let detailModal: DayDetailModal | undefined = $state();
	let detailDateKey: string | null = $state(null);
	let deletedMeal: DayMealPlan | undefined = $state();
	let deleteModal: ConfirmModal | undefined = $state();

	/**
	 * El día pulsado del grid: su detalle si ya tiene menús, la creación si
	 * está vacío. La clave la guarda la página porque editar y «crear otro»
	 * desde el detalle necesitan el día del menú en edición.
	 */
	function openDay(dateKey: string) {
		successMessage = null;
		const dayMeals = data.mealPlans[dateKey];
		if (dayMeals && dayMeals.length > 0) {
			detailDateKey = dateKey;
			detailModal?.open(dateKey);
		} else {
			detailDateKey = null;
			createModal?.open(dateKey);
		}
	}

	/** Editar un menú del detalle: el modal de crear, precargado (#221). */
	function openEdit(meal: DayMealPlan) {
		const dateKey = detailDateKey;
		if (!dateKey) return;
		createModal?.openForEdit(meal, dateKey);
	}

	/** Borrar un menú del detalle: confirmación, patrón de familias/categorías. */
	function openDelete(meal: DayMealPlan) {
		deletedMeal = meal;
		deleteModal?.showModal();
	}

	/** «Crear otro menú este día» desde el detalle: el de crear, apilado. */
	function openCreateFromDetail() {
		const dateKey = detailDateKey;
		if (!dateKey) return;
		createModal?.open(dateKey);
	}

	// ¿Hay menús este mes? El aviso de vacío solo con la cesta vacía; con
	// datos, el grid manda y el hueco lo ocupan los títulos.
	const monthHasMenus = $derived(Object.keys(data.mealPlans).length > 0);
</script>

<svelte:head>
	<title>{m.calendar_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.calendar_title()}</h1>

	<!-- Navegación de mes (#217): formularios GET que cambian SOLO el query
	     param, el patrón de los «Cargar más» del historial. El router de
	     SvelteKit los sigue como una navegación y el load recalcula el grid
	     en servidor; sin JavaScript, el submit nativo hace lo mismo con la
	     página entera (`action` lleva el `resolve()` que exige el lint). El
	     mes NO se confía al cliente: los tres destinos (anterior, siguiente
	     y hoy) los calcula el servidor y aquí solo se envían. -->
	<nav class="mt-4 flex items-center gap-1" aria-label={m.calendar_month_nav()}>
		<form action={resolve('/calendar')} class="contents">
			<input type="hidden" name="month" value={data.prevMonthKey} />
			<button type="submit" class="btn btn-ghost btn-sm" aria-label={m.calendar_prev_month()}>
				<ChevronLeft aria-hidden="true" />
			</button>
		</form>
		<!-- El título del mes lo compone el servidor con la locale de la
		     petición (regla i18n). `aria-live`: al navegar, la navegación
		     cliente repinta este texto y quien va con lector lo oye. -->
		<p class="flex-1 text-center text-sm font-semibold" aria-live="polite">{data.monthLabel}</p>
		<form action={resolve('/calendar')} class="contents">
			<input type="hidden" name="month" value={data.nextMonthKey} />
			<button type="submit" class="btn btn-ghost btn-sm" aria-label={m.calendar_next_month()}>
				<ChevronRight aria-hidden="true" />
			</button>
		</form>
		<form action={resolve('/calendar')} class="contents">
			<input type="hidden" name="month" value={data.todayMonthKey} />
			<button type="submit" class="btn btn-outline btn-sm">{m.calendar_today()}</button>
		</form>
	</nav>

	<!-- Pestañas Gastos/Menú (daisyUI tabs): `aria-selected` es a la vez el
	     estado accesible y lo que daisyUI pinta como activa. La vista de
	     gastos va vacía (#215 la rellenará); la de menús pinta el grid con
	     los menús de su load y los días pulsables (#222). -->
	<div role="tablist" class="tabs tabs-box mt-4" aria-label={m.calendar_tabs()}>
		<button
			type="button"
			role="tab"
			class="tab"
			aria-selected={activeTab === 'expenses'}
			aria-controls="calendar-panel-expenses"
			onclick={() => (activeTab = 'expenses')}
		>
			{m.calendar_tab_expenses()}
		</button>
		<button
			type="button"
			role="tab"
			class="tab"
			aria-selected={activeTab === 'menu'}
			aria-controls="calendar-panel-menu"
			onclick={() => (activeTab = 'menu')}
		>
			{m.calendar_tab_menu()}
		</button>
	</div>

	{#if activeTab === 'expenses'}
		<div id="calendar-panel-expenses" role="tabpanel" class="mt-3">
			<MonthGrid weeks={data.weeks} weekdays={data.weekdays} caption={data.monthLabel} />
			<p class="mt-3 text-center text-sm opacity-70">{m.calendar_expenses_empty()}</p>
		</div>
	{:else}
		<div id="calendar-panel-menu" role="tabpanel" class="mt-3">
			<MonthGrid
				weeks={data.weeks}
				weekdays={data.weekdays}
				caption={data.monthLabel}
				mealPlans={data.mealPlans}
				onDaySelect={openDay}
			/>
			<!-- El aviso bajo el grid: vacío sin menús, pista de uso con ellos
			     (los días son botones desde el esqueleto de #217). -->
			<p class="mt-3 text-center text-sm opacity-70">
				{monthHasMenus ? m.calendar_menu_hint() : m.calendar_menu_empty()}
			</p>
		</div>
	{/if}
</section>

{#if successMessage}
	<div class="alert alert-success mx-auto mt-4 max-w-md text-sm" role="status">
		{successMessage}
	</div>
{/if}

<CreateMealPlanModal
	bind:this={createModal}
	form={data.form}
	categories={data.categories}
	pantryNames={data.pantryNames}
	onSuccess={(message) => (successMessage = message)}
/>

<!-- Detalle del día (#221): los menús del día abierto salen SIEMPRE del
     load, así que cada acción (editar, borrar, crear otro) lo repinta
     cuando el load pesimista vuelve. -->
<DayDetailModal
	bind:this={detailModal}
	mealPlans={data.mealPlans}
	onEdit={openEdit}
	onDelete={openDelete}
	onCreate={openCreateFromDetail}
/>

<!-- Borrar menú (#221): una modal compartida; el botón del detalle fija a
     qué menú borra antes de abrirla (patrón de categorías). -->
<ConfirmModal
	bind:this={deleteModal}
	title={m.meal_plan_delete_title({ title: deletedMeal?.title ?? '' })}
	description={m.meal_plan_delete_description()}
	confirmLabel={m.meal_plan_delete_confirm()}
	action="?/delete"
	fields={{ id: deletedMeal?.id ?? '' }}
	errorFallback={m.meal_plan_error()}
	onSuccess={() => (successMessage = m.meal_plan_deleted())}
/>
