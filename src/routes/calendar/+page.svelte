<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { m } from '#lib/paraglide/messages.js';
	import MonthGrid from './MonthGrid.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * Las dos vistas del calendario (épica #212). El esqueleto (#217) las
	 * trae vacías: sus datos llegarán con #215 (gastos) y #216 (menús), que
	 * rellenarán las celdas del MISMO grid — la pestaña solo decide qué se
	 * pinta dentro, así que de momento basta estado local, sin query param.
	 */
	type CalendarTab = 'expenses' | 'menu';
	let activeTab: CalendarTab = $state('expenses');
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
	     estado accesible y lo que daisyUI pinta como activa. Las vistas van
	     vacías (#217): cada una es el grid del mes más el aviso de vacío que
	     las futuras vistas de datos (#215/#216) sustituirán. -->
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
			<MonthGrid weeks={data.weeks} weekdays={data.weekdays} caption={data.monthLabel} />
			<p class="mt-3 text-center text-sm opacity-70">{m.calendar_menu_empty()}</p>
		</div>
	{/if}
</section>
