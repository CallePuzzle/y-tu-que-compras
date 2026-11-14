<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { errorMessage } from '#lib/forms.js';
	import { formatQuantity } from '#lib/format.js';
	import { mealTypeLabels } from '#lib/meal-types.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { dayPantryStatus } from '#lib/pantry-status.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { dumpFormSchema } from './schemas.js';
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
	 * El volcado a la compra (#245) vive aquí dentro: cada ingrediente lleva
	 * su botón de añadir lo que falta (deshabilitado si su producto está
	 * cubierto) y el pie ofrece «añadir lo que falta del día» a la lista que
	 * se elija. Un solo formulario con dos destinos: el botón pulsado fija
	 * `dumpTarget` (el id del ingrediente, o undefined para el día) y el
	 * action lo recalcula TODO en servidor — aquí solo se decide el botón.
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
		/** Las listas de la familia: el selector de destino del volcado (#245). */
		lists: PageData['lists'];
		/** El formulario del volcado (#245), con id propio como el de crear menú. */
		dumpForm: PageData['dumpForm'];
		onEdit: (meal: DayMealPlan) => void;
		onDelete: (meal: DayMealPlan) => void;
		/** «Crear otro menú este día»: la página abre el modal de crear. */
		onCreate: (dateKey: string) => void;
		/** «Gastos del día»: la página cierra este modal y abre el de gastos (#220). */
		onOpenExpenses?: (dateKey: string) => void;
		/** El volcado entró en la lista: la página avisa FUERA del modal, como al crear (#245). */
		onDumpSuccess: (message: string) => void;
	};

	/** Un menú del día, tal y como lo trae el load (mismo tipo en la página y en el modal de crear). */
	type DayMealPlan = PageData['mealPlans'][string][number];

	let {
		mealPlans,
		purchasesByDay,
		pantryQuantities,
		lists,
		dumpForm: initialDumpForm,
		onEdit,
		onDelete,
		onCreate,
		onOpenExpenses,
		onDumpSuccess
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

	// ¿Hay algo que volcar (#245)? Cuentan los dos estados con déficit:
	// insuficiente (falta para el día) y sin producto (no hay despensa que
	// cubra nada). El botón del día se deshabilita si no hay nada — igual
	// que el individual de un producto cubierto —; el servidor LO
	// RECALCULA de todas formas al recibir el envío.
	const dayHasDeficit = $derived(
		[...pantryStatuses.values()].some((status) => status.status !== 'enough')
	);

	// ---- Volcado a la compra (#245): un formulario para el día entero y
	// para cada botón de ingrediente. Pesimista como el resto de acciones:
	// el detalle cierra cuando el load trae la verdad — que aquí no cambia
	// nada visible (la despensa no se toca), así que el aviso viaja a la
	// página. El fallo se queda DENTRO, como el de crear/editar. ----

	// El aviso del modal es solo para FALLOS (404/500): en éxito el texto
	// viaja a la página con `onDumpSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado (misma razón que el `saveError` del
	// modal de crear).
	let dumpError = $state(false);

	/**
	 * El destino del volcado en vuelo: `undefined` = el día entero; el id del
	 * ingrediente = individual. Lo fija el botón pulsado (el click corre
	 * antes del submit) y `onSubmit` lo inyecta en el JSON de salida — con
	 * `dataType: 'json'` superforms manda solo los datos validados del
	 * schema, y `JSON.stringify` suelta los valores undefined.
	 */
	let dumpTarget: string | undefined = $state(undefined);

	// svelte-ignore state_referenced_locally
	const dumpForm = superForm(initialDumpForm, {
		validators: zod4Client(dumpFormSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
		onSubmit({ jsonData }) {
			jsonData({ ...$dumpFormData, ingredientId: dumpTarget });
		},
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el resto de modales de la app.
				const data = result.data as { form?: { message?: string } } | undefined;
				onDumpSuccess(data?.form?.message ?? '');
				dumpError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				dumpError = true;
			}
		}
	});
	const {
		form: dumpFormData,
		enhance: dumpEnhance,
		delayed: dumpDelayed,
		message: dumpMessage,
		errors: dumpErrors
	} = dumpForm;

	/** Abre el detalle de UN día: la celda pulsada manda la clave `YYYY-MM-DD`. */
	export function open(key: string) {
		dateKey = key;
		// El volcado (#245) arranca limpio: destino «el día entero» y la
		// primera lista por defecto, como el re-añadido de despensa.
		dumpTarget = undefined;
		dumpMessage.set(undefined);
		dumpErrors.clear();
		dumpError = false;
		dumpFormData.set({ date: key, listId: lists[0]?.id ?? '' });
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
											<!-- Volcado individual (#245): lo que falta de SU
											     producto para el día entero (el déficit
											     agregado que enseña el badge), a la lista
											     del formulario de abajo — lo envía con
											     `form=` desde fuera de él. Sin producto
											     cubierto (`enough`) no hay nada que
											     añadir: deshabilitado, como sin listas. -->
											<button
												type="submit"
												form="calendar-dump"
												name="ingredientId"
												value={ingredient.id}
												class="btn btn-ghost btn-xs shrink-0"
												aria-label={m.calendar_dump_ingredient_aria({ name: ingredient.name })}
												disabled={status?.status === 'enough' || lists.length === 0 || $dumpDelayed}
												onclick={() => (dumpTarget = ingredient.id)}
											>
												{m.calendar_dump_ingredient()}
											</button>
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

		<!-- Volcado a la lista de la compra (#245): lo que falta del día, a
		     la lista que se elija. Un solo formulario para el día entero y
		     para los botones de ingrediente de arriba (los envían con
		     `form=` desde fuera); sin listas no hay destino posible y se
		     explica, como en el re-añadido de despensa. El fallo del action
		     se cuenta aquí dentro; el éxito cierra el detalle y avisa a la
		     página. Solo con menús en el día: un día vaciado no tiene
		     nada que volcar. -->
		{#if dayMeals.length > 0}
			{#if lists.length === 0}
				<p class="mt-4 text-sm opacity-70">{m.calendar_dump_no_lists()}</p>
			{:else}
				<form
					id="calendar-dump"
					method="POST"
					action="?/dump"
					use:dumpEnhance
					class="mt-4 flex flex-col gap-2"
				>
					<!-- El día del volcado viaja fijo: el del detalle abierto. -->
					<input type="hidden" name="date" value={dateKey ?? ''} />
					<div class="flex items-end gap-2">
						<div class="flex flex-1 flex-col gap-1">
							<label class="fieldset-label" for="calendar-dump-list">
								{m.schema_readd_list_label()}
							</label>
							<select
								bind:value={$dumpFormData.listId}
								id="calendar-dump-list"
								name="listId"
								class="select w-full"
								required
							>
								{#each lists as list (list.id)}
									<option value={list.id}>{list.name}</option>
								{/each}
							</select>
							{#if errorMessage($dumpErrors.listId)}
								<p class="fieldset-label text-error" role="alert">
									{errorMessage($dumpErrors.listId)}
								</p>
							{/if}
						</div>
						<button
							type="submit"
							class="btn btn-outline"
							disabled={!dayHasDeficit || $dumpDelayed}
							onclick={() => (dumpTarget = undefined)}
						>
							{#if $dumpDelayed}
								<span class="loading loading-spinner"></span>
							{/if}
							{m.calendar_dump_day()}
						</button>
					</div>

					{#if dumpError && $dumpMessage}
						<div class="alert alert-error text-sm" role="alert">
							{$dumpMessage}
						</div>
					{/if}
				</form>
			{/if}
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
