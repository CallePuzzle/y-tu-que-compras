<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { formatQuantity } from '#lib/format.js';
	import { mealTypeLabels } from '#lib/meal-types.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { unitLabels } from '#lib/units.js';
	import { dayPantryStatus } from './pantry-status.js';
	import type { PageData } from './$types';

	/**
	 * Detalle de UN día del calendario (épica #212, tarea #221): los menús de
	 * la fecha pulsada en su orden natural (el load ya los ordena por tipo de
	 * comida), cada uno con su título, sus ingredientes etiquetados (cantidad
	 * localizada y unidad traducida con las claves `unit_*`), el estado de
	 * despensa de cada ingrediente (#244: suficiente / lo que falta / falta,
	 * el cálculo puro de `pantry-status.ts` agregado por producto y día) y
	 * sus botones de editar y borrar. Editar abre el modal de creación
	 * precargado y borrar confirma en un `ConfirmModal`: ambos apilan su
	 * `<dialog>` nativo SOBRE este — el detalle se queda abierto y se repinta
	 * solo cuando el load pesimista trae los datos nuevos tras cada acción.
	 *
	 * La fecha se pinta como su clave `YYYY-MM-DD` (la celda la usa como
	 * identidad, no como texto localizado), igual que el badge fijo del
	 * modal de crear: el título localizado del día no existe todavía y no
	 * hace falta para reconocer el día del grid.
	 */
	type Props = {
		/** Los menús del mes agrupados por día, tal y como los trae el load. */
		mealPlans: PageData['mealPlans'];
		/** Los gastos del mes por día: para ofrecer el detalle de gastos si el día también tiene (#220). */
		purchasesByDay?: PageData['purchasesByDay'];
		/** La despensa de la familia como mapa id → cantidad (#244): contra lo que el cálculo compara la necesidad del día. */
		pantryQuantities: PageData['pantryQuantities'];
		onEdit: (meal: DayMealPlan) => void;
		onDelete: (meal: DayMealPlan) => void;
		/** «Crear otro menú este día»: la página abre el modal de crear. */
		onCreate: (dateKey: string) => void;
		/** «Gastos del día»: la página cierra este modal y abre el de gastos (#220). */
		onOpenExpenses?: (dateKey: string) => void;
	};

	/** Un menú del día, tal y como lo trae el load (mismo tipo en la página y en el modal de crear). */
	type DayMealPlan = PageData['mealPlans'][string][number];

	let {
		mealPlans,
		purchasesByDay,
		pantryQuantities,
		onEdit,
		onDelete,
		onCreate,
		onOpenExpenses
	}: Props = $props();

	const UNIT_LABEL = unitLabels();
	const MEAL_LABEL = mealTypeLabels();

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/** El día abierto (`YYYY-MM-DD`): `null` con el modal cerrado. */
	let dateKey: string | null = $state(null);

	// Los menús del día salen SIEMPRE del load: cuando la página repinte tras
	// editar o borrar (invalidateAll pesimista), este `derived` recalcula y
	// el detalle muestra el estado fresco sin tocar nada más.
	const dayMeals = $derived(dateKey ? (mealPlans[dateKey] ?? []) : []);

	// El estado de despensa del día abierto (#244): el cálculo puro agregado
	// por producto sobre SUS menús, contra la despensa que trae el load.
	// Cada ingrediente consulta el resultado por su `pantryItemId` (los sin
	// FK, bajo `null`) y repinta con el load pesimista, igual que los menús.
	const pantryStatuses = $derived(dayPantryStatus(dayMeals, pantryQuantities));

	/** Abre el detalle de UN día: la celda pulsada manda la clave `YYYY-MM-DD`. */
	export function open(key: string) {
		dateKey = key;
		modal?.showModal();
	}

	/** La cierra la página al pasar de este día al modal de crear. */
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
	{#if dateKey}
		<h2 class="text-lg font-bold">{m.calendar_day_detail()}</h2>
		<p class="mt-1">
			<span class="badge badge-outline font-mono">{dateKey}</span>
		</p>

		{#if dayMeals.length === 0}
			<!-- Día vaciado tras borrar su último menú: mismo modal, estado vacío. -->
			<p class="mt-4 text-sm opacity-70">{m.calendar_day_empty()}</p>
		{:else}
			<div class="mt-3 flex flex-col gap-3">
				{#each dayMeals as meal (meal.id)}
					<article class="bg-base-200 rounded-box flex flex-col gap-2 p-3">
						<header class="flex items-start justify-between gap-2">
							<div class="flex flex-col gap-1">
								<span class="badge badge-outline text-xs">{MEAL_LABEL[meal.mealType]}</span>
								<h3 class="text-sm font-semibold">{meal.title}</h3>
							</div>
							<div class="flex gap-1">
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									aria-label={m.meal_plan_edit()}
									onclick={() => onEdit(meal)}
								>
									<Pencil aria-hidden="true" />
								</button>
								<button
									type="button"
									class="btn btn-ghost btn-sm text-error"
									aria-label={m.meal_plan_delete()}
									onclick={() => onDelete(meal)}
								>
									<Trash2 aria-hidden="true" />
								</button>
							</div>
						</header>

						{#if meal.ingredients.length > 0}
							<!-- Ingredientes etiquetados (#221): cantidad con los
							     separadores de la locale (`formatQuantity`, igual que
							     la despensa) y unidad traducida (`unit_*`), como el
							     enum nunca se muestra tal cual. El badge de despensa
							     (#244) consulta el agregado del día por el producto
							     del ingrediente — los sin FK caen en «falta» — y el
							     déficit se formatea con la unidad DEL INGREDIENTE
							     (mismo producto es misma unidad: el guardado enlaza
							     por nombre normalizado + unidad). -->
							<div class="flex flex-col gap-1">
								<p class="fieldset-label">{m.meal_plan_ingredients()}</p>
								<ul class="flex flex-col gap-1">
									{#each meal.ingredients as ingredient (ingredient.id)}
										{@const status = pantryStatuses.get(ingredient.pantryItemId)}
										<li class="flex items-baseline gap-2 text-sm">
											<span class="shrink-0 font-mono text-xs opacity-80">
												{formatQuantity(ingredient.quantity, getLocale())}
												{UNIT_LABEL[ingredient.unit]}
											</span>
											<span>{ingredient.name}</span>
											{#if status?.status === 'enough'}
												<span class="badge badge-success badge-sm ms-auto shrink-0">
													{m.meal_status_enough()}
												</span>
											{:else if status?.status === 'short'}
												<span class="badge badge-warning badge-sm ms-auto shrink-0">
													{m.meal_status_short({
														quantity: formatQuantity(status.deficit, getLocale()),
														unit: UNIT_LABEL[ingredient.unit]
													})}
												</span>
											{:else}
												<span class="badge badge-error badge-sm ms-auto shrink-0">
													{m.meal_status_missing()}
												</span>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-sm opacity-70">{m.meal_plan_no_ingredients()}</p>
						{/if}
					</article>
				{/each}
			</div>
		{/if}

		<!-- Los pies del detalle (#220): crear otro menú apila el modal de
		     crear SOBRE este detalle (ha de seguir viéndose); si el día
		     también tiene compras, «Gastos del día» CAMBIA de vista — la
		     página cierra este modal y abre el de gastos, que no apila:
		     son dos vistas del mismo día, no una acción sobre él. -->
		<div class="mt-4 flex flex-col items-start gap-2">
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onclick={() => dateKey && onCreate(dateKey)}
			>
				<Plus aria-hidden="true" />
				{m.meal_plan_create_other()}
			</button>
			{#if onOpenExpenses && dateKey && (purchasesByDay?.[dateKey] ?? null)}
				<button
					type="button"
					class="btn btn-outline btn-sm"
					onclick={() => dateKey && onOpenExpenses(dateKey)}
				>
					{m.calendar_day_expenses()}
				</button>
			{/if}
		</div>
	{/if}
</Modal>
