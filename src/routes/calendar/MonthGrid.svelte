<script lang="ts">
	import { formatPrice, formatPriceCompact } from '#lib/format.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import type { CalendarCell } from './grid.js';

	/**
	 * El grid mensual del calendario (#217): una tabla de SIEMPRE 6 semanas
	 * × 7 días, la semana empezando en lunes. Los textos (cabecera de días y
	 * caption) viajan ya compuestos desde el load (regla i18n); las cifras se
	 * componen en render con la locale activa (`getLocale`), como el
	 * `formatQuantity` del detalle de menús (#221). Las celdas de los meses
	 * contiguos van atenuadas y «hoy» queda destacado con el primario
	 * (`aria-current="date"`).
	 *
	 * Con menús (#222) la vista del tab Menú cuelga de cada `dateKey` los
	 * menús del día (título truncado; el chip crece la celda, la altura es
	 * mínima) y TODOS los días del mes son botones: los vacíos ofrecen crear
	 * (#221), decisión de la página en el mismo `onDaySelect`.
	 *
	 * Con gastos (#220) la vista del tab Gastos cuelga de cada `dateKey` la
	 * cifra del día y SOLO los días con compras son botones: un día sin
	 * gastos no abre nada (queda como el esqueleto). La regla del botón sale
	 * de los datos que trae cada vista: con `mealPlans` presente manda el
	 * menú (todos los días); si el día trae total en `purchasesByDay`, es
	 * pulsable.
	 */
	type Props = {
		weeks: CalendarCell[][];
		/** Nombres cortos de lunes a domingo, ya localizados. */
		weekdays: string[];
		/** El nombre del mes en vista, para el caption accesible de la tabla. */
		caption: string;
		/** Menús por día (`YYYY-MM-DD`), tal y como los agrupa el load. */
		mealPlans?: Record<string, DayMeal[]>;
		/** Gastos por día (`YYYY-MM-DD`), tal y como los agrupa el load (#220). */
		purchasesByDay?: Record<string, DayExpenses>;
		/** Al pulsar un día del mes en vista: detalle del día o creación. */
		onDaySelect?: (dateKey: string) => void;
	};

	/** Un menú del día tal y como la celda lo pinta: su título. */
	interface DayMeal {
		id: string;
		title: string;
	}

	/** Los gastos de un día tal y como la celda los pinta: su total (#220). */
	interface DayExpenses {
		total: number;
	}

	let { weeks, weekdays, caption, mealPlans, purchasesByDay, onDaySelect }: Props = $props();

	/**
	 * La cifra de la celda (#220): el total del día con SU signo (un gasto
	 * resta) y, a partir del millar, en compacto — «-1,2 mil €» en es,
	 * «-€1.2K» en en — porque la celda no da para más. El detalle completo
	 * SIEMPRE en el modal del día.
	 */
	function expenseLabel(total: number, locale: string): string {
		const amount = -total;
		return total >= 1000 ? formatPriceCompact(amount, locale) : formatPrice(amount, locale);
	}
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
					{@const dayExpenses = purchasesByDay?.[cell.dateKey]}
					<td class="h-12 p-0.5 align-top sm:h-14" aria-current={cell.isToday ? 'date' : undefined}>
						{#if onDaySelect && cell.inMonth && (mealPlans || dayExpenses)}
							<!-- Día del mes en vista con datos (menús #222/#221,
							     gastos #220): un botón con altura mínima de toque
							     propia (`min-h-11`), para el dedo y para el teclado.
							     Su nombre accesible es el contenido visible: el
							     número y los títulos o cifras del día. Los chips lo
							     crecen; el `td` nunca se queda corto porque en
							     celdas `height` ya actúa de mínimo. -->
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
									     el detalle completo lo enseña el día pulsado (#221). -->
									<span class="w-full truncate text-[10px] leading-tight opacity-80">
										{meal.title}
									</span>
								{/each}
								{#if dayExpenses}
									<!-- El gasto del día (#220): SU cifra negativa bajo el
									     número, en compacto a partir del millar — una
									     celda no da para más; el detalle completo lo
									     enseña el modal del día. `tabular-nums`: los
									     dígitos no bailan de celda a celda. -->
									<span
										class="w-full truncate text-[10px] leading-tight font-medium tabular-nums opacity-80"
									>
										{expenseLabel(dayExpenses.total, getLocale())}
									</span>
								{/if}
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
