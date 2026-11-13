<script lang="ts">
	import type { CalendarCell } from './grid.js';

	/**
	 * El grid mensual del calendario (#217): una tabla de SIEMPRE 6 semanas
	 * × 7 días, la semana empezando en lunes. Los textos (cabecera de días y
	 * caption) viajan ya compuestos desde el load (regla i18n): aquí solo se
	 * pinta. Las celdas de los meses contiguos van atenuadas y «hoy» queda
	 * destacado con el primario (`aria-current="date"`).
	 *
	 * Con menús (#222) la vista del tab Menú cuelga de cada `dateKey` los
	 * menús del día (título truncado; el chip crece la celda, la altura es
	 * mínima) y los días del mes se vuelven BOTONES que abren la creación:
	 * pulsar un día es el «añadir» de esa fecha (el detalle/editar llega con
	 * #221 y colgará del mismo `onDaySelect`). Sin `onDaySelect` (tab Gastos,
	 * #215) las celdas quedan como el esqueleto: número y nada más.
	 */
	type Props = {
		weeks: CalendarCell[][];
		/** Nombres cortos de lunes a domingo, ya localizados. */
		weekdays: string[];
		/** El nombre del mes en vista, para el caption accesible de la tabla. */
		caption: string;
		/** Menús por día (`YYYY-MM-DD`), tal y como los agrupa el load. */
		mealPlans?: Record<string, DayMeal[]>;
		/** Al pulsar un día del mes en vista: abre la creación de menú. */
		onDaySelect?: (dateKey: string) => void;
	};

	/** Un menú del día tal y como la celda lo pinta: su título. */
	interface DayMeal {
		id: string;
		title: string;
	}

	let { weeks, weekdays, caption, mealPlans, onDaySelect }: Props = $props();
</script>

<!-- `table-fixed`: las 7 columnas iguales sea cual sea el ancho; las celdas
     llevan la altura mínima (el hueco para datos) y el grid no baila entre
     meses: los chips del día crecen la fila sin desbordarla. -->
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
						{#if onDaySelect && cell.inMonth}
							<!-- Día del mes en vista con creación (#222): un botón con
							     altura mínima de toque propia (`min-h-11`), para el dedo
							     y para el teclado. Su nombre accesible es el contenido
							     visible: el número y los títulos del día. Los chips lo
							     crecen; el `td` nunca se queda corto porque en celdas
							     `height` ya actúa de mínimo. -->
							<button
								type="button"
								class="focus-visible:outline-primary rounded-box hover:bg-base-200 flex min-h-11 w-full flex-col items-center gap-0.5 p-0.5 focus-visible:outline-2"
								onclick={() => onDaySelect(cell.dateKey)}
							>
								<span
									class={`mx-auto flex size-7 shrink-0 items-center justify-center rounded-full ${cell.isToday ? 'bg-primary text-primary-content font-bold' : ''}`}
								>
									{cell.day}
								</span>
								{#each mealPlans?.[cell.dateKey] ?? [] as meal (meal.id)}
									<!-- Título truncado (#222): una celda no da para más;
									     el detalle completo llega con #221. -->
									<span class="w-full truncate text-[10px] leading-tight opacity-80">
										{meal.title}
									</span>
								{/each}
							</button>
						{:else if cell.inMonth}
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
