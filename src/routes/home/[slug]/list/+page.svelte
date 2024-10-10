<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate, type SuperForm } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import { ListSchema } from '$lib/schemas';
	import AddEditModal from '$lib/components/forms/AddEditModal.svelte';
	import ArrayCombobox from '$lib/components/forms/ArrayCombobox.svelte';

	import type { PageData } from './$types';
	import type { Grocery } from '@prisma/client';
	import type { SuperFormData } from 'sveltekit-superforms/client';

	let superform = $state();
	let superFormReady = $state(false);
	let form = $state() as SuperForm<any, any>;
	let formData = $state() as SuperFormData<any>;

	let {
		data
	}: {
		data: PageData;
	} = $props();

	onMount(async () => {
		superform = await superValidate(zod(ListSchema));
		superFormReady = true;
	});
</script>

{#if superFormReady}
	<AddEditModal
		title="Crea una nueva lista"
		{superform}
		schema={ListSchema}
		type="list"
		action="add"
		excludeFields={['groceries']}
		bind:form
		bind:formData
	>
		<ArrayCombobox {form} field="groceries" type="list" {formData} comboxArray={data.groceries}
		></ArrayCombobox>
	</AddEditModal>
{/if}
