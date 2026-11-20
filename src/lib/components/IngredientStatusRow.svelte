<script lang="ts">
	import { formatQuantity } from '#lib/format.js';
	import type { ProductPantryStatus } from '#lib/pantry-status.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { unitLabels } from '#lib/units.js';
	import type { Unit } from '#lib/schemas/item.js';

	/**
	 * Una fila de ingrediente con su estado de despensa (épica #236, #244 y
	 * #245; issue #290): la cantidad localizada (`formatQuantity` + locale) y
	 * la unidad traducida (`unit_*`, el enum nunca se muestra tal cual), el
	 * nombre, el badge del estado agregado del cálculo puro
	 * (`dayPantryStatus`, que lo decide quien lo llama) y el botón de añadir
	 * lo que falta a la lista del formulario de volcado de SU vista — el
	 * detalle del día y el de receta lo comparten, con el mismo marcado y los
	 * mismos mensajes. El botón es un submit NATIVO del formulario indicado
	 * (`form=`): su vista lo recibe como `ingredientId` sin JavaScript
	 * también, y con JS fija el destino por `onDump` antes del envío.
	 */
	type Props = {
		/** El ingrediente: su id viaja en el envío del volcado individual. */
		ingredient: { id: string; name: string; quantity: number; unit: Unit };
		/**
		 * Su estado de despensa agregado por producto. `undefined` solo si el
		 * cálculo no lo cubre (no debería ocurrir: toda clave de ingrediente
		 * acaba en el mapa): se pinta «falta», sin cifra.
		 */
		status?: ProductPantryStatus;
		/** El formulario de volcado al que el botón envía SU ingrediente. */
		dumpFormId: string;
		/** Sin volcado posible: cubierto, sin listas o volcado en vuelo. */
		dumpDisabled?: boolean;
		/** Fija el ingrediente como destino del volcado antes del submit. */
		onDump: () => void;
	};

	let { ingredient, status, dumpFormId, dumpDisabled = false, onDump }: Props = $props();

	const UNIT_LABEL = unitLabels();
</script>

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
		<!-- Insuficiente: el déficit exacto (`max(0, necesidad − despensa)`),
		     formateado con la unidad DEL INGREDIENTE (mismo producto es misma
		     unidad: el guardado enlaza por nombre normalizado + unidad). -->
		<span class="badge badge-warning badge-sm ms-auto shrink-0">
			{m.meal_status_short({
				quantity: formatQuantity(status.deficit, getLocale()),
				unit: UNIT_LABEL[ingredient.unit]
			})}
		</span>
	{:else}
		<!-- Sin producto de despensa (sin FK): falta, sin cifra. -->
		<span class="badge badge-error badge-sm ms-auto shrink-0">
			{m.meal_status_missing()}
		</span>
	{/if}
	<!-- Volcado individual: lo que falta de SU producto (el déficit agregado
	     que enseña el badge), a la lista del formulario indicado — lo envía
	     con `form=` desde fuera de él. Sin producto cubierto (`enough`) no
	     hay nada que añadir: deshabilitado, como sin listas. -->
	<button
		type="submit"
		form={dumpFormId}
		name="ingredientId"
		value={ingredient.id}
		class="btn btn-ghost btn-xs shrink-0"
		aria-label={m.calendar_dump_ingredient_aria({ name: ingredient.name })}
		disabled={dumpDisabled}
		onclick={onDump}
	>
		{m.calendar_dump_ingredient()}
	</button>
</li>
