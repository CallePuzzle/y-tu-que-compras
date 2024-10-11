<script lang="ts">
	import { t } from '$lib/translations';
	import { Fieldset, Legend, ElementField, Control, Label, FieldErrors } from 'formsnap';
	import { type SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';

	let {
		form,
		field,
		type,
		formData
	}: {
		form: SuperForm<any, any>;
		field: string;
		type: string;
		formData: SuperFormData<any>;
	} = $props();

	function removeByIndex(index: number) {
		$formData[field] = $formData[field].filter((_, i) => i !== index);
	}

	function add() {
		$formData[field] = [...$formData[field], ''];
	}
</script>

<Fieldset {form} name={field}>
	<Legend>{$t(type + '.' + field)}</Legend>
	{#each $formData[field] as _, i}
		<ElementField {form} name={field[i]}>
			<Control let:attrs>
				<Label class="sr-only">{$t(type + '.' + field)} {i + 1}</Label>
				<input type="string" {...attrs} bind:value={$formData[field][i]} />
				<button type="button" onclick={() => removeByIndex(i)}> Borrar </button>
			</Control>
		</ElementField>
	{/each}
	<FieldErrors />
	<button type="button" onclick={add}>Añadir</button>
</Fieldset>
