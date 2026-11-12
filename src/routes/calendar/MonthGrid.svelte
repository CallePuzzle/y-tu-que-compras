<script lang="ts">
	import type { CalendarCell } from './grid.js';

	/**
	 * El grid mensual del calendario (#217): una tabla de SIEMPRE 6 semanas
	 * × 7 días, la semana empezando en lunes. Los textos (cabecera de días y
	 * caption) viajan ya compuestos desde el load (regla i18n): aquí solo se
	 * pinta. Las celdas de los meses contiguos van atenuadas y «hoy» queda
	 * destacado con el primario (`aria-current="date"`); el resto del hueco
	 * de cada celda es el sitio donde las vistas de la épica colgarán los
	 * datos del día (#215 y #216), indexados por el `dateKey` de la celda.
	 */
	type Props = {
		weeks: CalendarCell[][];
		/** Nombres cortos de lunes a domingo, ya localizados. */
		weekdays: string[];
		/** El nombre del mes en vista, para el caption accesible de la tabla. */
		caption: string;
	};

	let { weeks, weekdays, caption }: Props = $props();
</script>

<!-- `table-fixed`: las 7 columnas iguales sea cual sea el ancho; las celdas
     llevan la altura (el hueco para datos) y el grid no baila entre meses. -->
<table class="w-full table-fixed border-collapse text-center">
	<caption class="sr-only">{caption}</caption>
	<thead>
		<tr>
			{#each weekdays as weekday (weekday)}
				<th scope="col" class="pb-1 text-xs font-semibold tracking-wide uppercase opacity-60">
					{weekday}
				</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each weeks as week, weekIndex (weekIndex)}
			<tr>
				{#each week as cell (cell.dateKey)}
					<td class="h-12 p-0.5 align-top sm:h-14" aria-current={cell.isToday ? 'date' : undefined}>
						{#if cell.inMonth}
							<span
								class={`mx-auto flex size-7 items-center justify-center rounded-full ${cell.isToday ? 'bg-primary text-primary-content font-bold' : ''}`}
							>
								{cell.day}
							</span>
						{:else}
							<!-- Relleno del mes contiguo: atenuado, pero en su celda. -->
							<span class="opacity-40">{cell.day}</span>
						{/if}
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>
