<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import { IdSchema } from '$lib/schemas';
	import Check from '$lib/components/list/Check.svelte';

	import type { PageData } from './$types';
	import Form from '$lib/components/forms/Form.svelte';

	let superform: SuperValidated<Infer<any>> = $state({}) as SuperValidated<Infer<any>>;
	let superFormReady = $state(false);

	let {
		data
	}: {
		data: PageData;
	} = $props();

	onMount(async () => {
		superform = await superValidate(zod(IdSchema));
		superFormReady = true;
	});
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{data.list.name}</h2>
	{#each data.todoGroceries as item}
		<Check
			id={item.id}
			name={item.grocery.name}
			completed={item.completed}
			superform={data.todoForms[item.id]}
		/>
	{/each}
	{#each data.completedGroceries as item}
		<Check
			id={item.id}
			name={item.grocery.name}
			completed={item.completed}
			superform={data.completedForms[item.id]}
		/>
	{/each}
	{#if superFormReady}
		<Form
			{superform}
			schema={IdSchema}
			type="list"
			action="?/addGroceryToList"
			excludeFields={['id']}
		>
			{#snippet extraFields(form, formData)}
				<Combobox {form} field="id" {formData} comboxArray={data.groceries} />
			{/snippet}
		</Form>
	{/if}
</div>
