<script lang="ts">
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { formatQuantity } from '$lib/format.js';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { unitLabels } from '$lib/units.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	/**
	 * Una fila de item (checklists #68 y #69): checkbox de comprado, nombre,
	 * cantidad y acciones. La comparten las dos secciones (pendientes y
	 * comprados). El estado optimista vive en la página: aquí llega ya
	 * resuelto en `comprado`, y el toque se avisa con `onToggle`.
	 */
	type Props = {
		item: PageData['items'][number];
		/** El comprado mostrado (el optimista si lo hay). */
		comprado: boolean;
		/** El resultado del envío de `?/purchased` (revierte en fallo). */
		onPurchasedResult: SubmitFunction;
		/** El toque en el checkbox, con el valor NUEVO, antes del envío. */
		onToggle: (nuevo: boolean) => void;
		onEdit: () => void;
		onDelete: () => void;
	};

	let { item, comprado, onPurchasedResult, onToggle, onEdit, onDelete }: Props = $props();

	const UNIT_LABEL = unitLabels();
</script>

<li
	class={`bg-base-200 rounded-box flex items-center gap-3 px-4 py-3 ${comprado ? 'opacity-60' : ''}`}
>
	<!-- Checkbox de comprado (checklist #69): envía `?/purchased` con
	     el id y el NUEVO valor. El hidden «false» + el checkbox
	     «true» dejan el valor correcto también en un envío nativo. -->
	<form method="POST" action="?/purchased" use:enhance={onPurchasedResult}>
		<input type="hidden" name="item" value={item.id} />
		<input type="hidden" name="purchased" value="false" />
		<input
			type="checkbox"
			name="purchased"
			value="true"
			class="checkbox checkbox-primary"
			checked={comprado}
			aria-label={comprado ? m.items_mark_pending() : m.items_mark_purchased()}
			onchange={(event) => {
				// Optimista ANTES del envío: la UI responde al toque; si
				// la acción falla, la página lo revierte.
				//
				// PERO el toggle nativo se deshace aquí mismo: el click
				// cambia la propiedad `checked` a espaldas de Svelte, y
				// al conmutar entre pendientes y comprados Svelte puede
				// reciclar la fila (las dos secciones comparten
				// plantilla) — `set_checked` no reasigna cuando su cache
				// ya coincide con el destino, así que la casilla podía
				// volver MARCADA a Pendientes tras un fallo. Con la
				// propiedad devuelta a `comprado`, cache y DOM quedan
				// alineados: el estado es quien pinta cada valor.
				// El valor NUEVO no se pierde: pasa al hidden y al checkbox se
				// le QUITA el `name`, para que el envío lleve UN solo valor —
				// el del hidden. Sin esto, al desmarcar el FormData llega con
				// el hidden «false» Y el checkbox «true» (la propiedad se
				// devolvió a su valor anterior arriba) y la acción se queda
				// con «true»: el desmarcado nunca se guardaba (issue #106).
				// Sin JS no hay toggle (no corre este `onchange`): el envío
				// nativo conserva el par hidden+checkbox intacto y el
				// servidor sigue leyéndolo bien.
				const input = event.currentTarget;
				const nuevo = input.checked;
				input.checked = comprado;
				input.removeAttribute('name');
				const hidden = input.form?.querySelector<HTMLInputElement>(
					'input[name="purchased"][type="hidden"]'
				);
				if (hidden) hidden.value = String(nuevo);
				onToggle(nuevo);
				input.form?.requestSubmit();
			}}
		/>
	</form>
	<!-- Sin `truncate` (issue #152): el nombre largo salta a varias líneas y
	     la fila crece con él; `break-words` parte también palabras sin
	     espacios para que no desborde la caja. -->
	<p class={`min-w-0 flex-1 font-medium break-words ${comprado ? 'line-through' : ''}`}>
		{item.name}
	</p>
	<span class="badge badge-ghost shrink-0 tabular-nums">
		{formatQuantity(item.quantity, getLocale())}
		{UNIT_LABEL[item.unit]}
	</span>
	<span class="flex items-center gap-1">
		<button type="button" class="btn btn-ghost btn-sm" title={m.items_edit()} onclick={onEdit}>
			<Pencil aria-hidden="true" />
			<span class="sr-only">{m.items_edit()}</span>
		</button>
		<button type="button" class="btn btn-ghost btn-sm" title={m.items_delete()} onclick={onDelete}>
			<Trash2 aria-hidden="true" />
			<span class="sr-only">{m.items_delete()}</span>
		</button>
	</span>
</li>
