<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import { formatQuantity } from '#lib/format.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import type { Unit } from '#lib/schemas/item.js';
	import { unitLabels } from '#lib/units.js';
	import {
		convertQuantity,
		findUnitConflicts,
		type PantryProduct,
		type UnitConversion
	} from '#lib/unit-convert.js';

	/**
	 * Chip de aviso de unidad conflictiva (épica #232, tarea #240), pieza
	 * REUTILIZABLE: mientras se rellena una fila (ingrediente de receta hoy,
	 * otros formularios mañana), detecta que el nombre coincide con un
	 * producto de despensa en OTRA unidad — el match lo hace
	 * `findUnitConflicts` sobre el nombre canónico — y lo avisa. Si la
	 * conversión es EXACTA (`convertQuantity`, los 3 decimales de la columna),
	 * ofrece un botón «usar kg → 0,3 kg» por producto y opción; si no la hay
	 * (ud→docena, paquete, lata…), el aviso informa SIN botón. El chip no
	 * muta nada: propone y `onApply` decide — quien lo monta es dueño de su
	 * fila. Sin conflicto no pinta nada.
	 */
	type Props = {
		/** El nombre tecleado en la fila (lo normaliza el helper). */
		name: string;
		/** La unidad actual de la fila: con la del producto NO hay conflicto. */
		unit: Unit;
		/** La cantidad actual de la fila: la que convierte el botón. */
		quantity: number;
		/** Los productos de despensa donde buscar (los trae el load de la vista). */
		pantryProducts: readonly PantryProduct[];
		/** Aplica la conversión elegida sobre la fila que monto el consumidor. */
		onApply: (conversion: UnitConversion) => void;
	};

	let { name, unit, quantity, pantryProducts, onApply }: Props = $props();

	const UNIT_LABEL = unitLabels();

	/** Los productos con el mismo nombre canónico en otra unidad. */
	const conflicts = $derived(findUnitConflicts(name, unit, pantryProducts));

	/** Los que además admiten conversión exacta desde la unidad de la fila. */
	const convertible = $derived(
		conflicts
			.map((product) => ({ product, quantity: convertQuantity(quantity, unit, product.unit) }))
			.filter(
				(option): option is { product: PantryProduct; quantity: number } => option.quantity !== null
			)
	);

	/** Las unidades conflictivas para el texto («kg, docena»), con su etiqueta. */
	const conflictUnits = $derived(conflicts.map((product) => UNIT_LABEL[product.unit]).join(', '));

	/** La etiqueta de cantidad del botón («0,3 kg»), con la locale activa. */
	function convertedLabel(option: { product: PantryProduct; quantity: number }): string {
		return `${formatQuantity(option.quantity, getLocale())} ${UNIT_LABEL[option.product.unit]}`;
	}
</script>

{#if conflicts.length > 0}
	<!-- Aviso, no error: los botones son `type="button"` (viven DENTRO del
	     formulario de la fila) y el rol `status` lo anuncia en voz baja, sin
	     interrumpir como un `alert` lo que se está tecleando. -->
	<div class="alert alert-warning py-2 text-sm" role="status">
		<AlertTriangle aria-hidden="true" class="size-4 shrink-0" />
		<div class="flex flex-col items-start gap-1">
			<p>{m.unit_convert_conflict({ name, units: conflictUnits })}</p>
			{#each convertible as option (option.product.id)}
				<button
					type="button"
					class="btn btn-outline btn-warning btn-xs"
					onclick={() =>
						onApply({
							unit: option.product.unit,
							quantity: option.quantity,
							pantryItemId: option.product.id
						})}
				>
					{m.unit_convert_apply({
						unit: UNIT_LABEL[option.product.unit],
						quantity: convertedLabel(option)
					})}
				</button>
			{/each}
		</div>
	</div>
{/if}
