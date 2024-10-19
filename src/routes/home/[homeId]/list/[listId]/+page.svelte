<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import { IdSchema } from '$lib/schemas';
	import Check from '$lib/components/list/Check.svelte';

	import type { PageData } from './$types';
	import Form from '$lib/components/forms/Form.svelte';
	import type { GroceryListExtended } from '$lib/schemas';

	let superform: SuperValidated<Infer<any>> = $state({}) as SuperValidated<Infer<any>>;
	let superFormReady = $state(false);

	let {
		data
	}: {
		data: PageData;
	} = $props();

	let groceryList = $state(data.list.groceries as GroceryListExtended[]);

	onMount(async () => {
		superform = await superValidate(zod(IdSchema));
		superFormReady = true;
	});
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{data.list.name}</h2>
	{#each groceryList as item, index}
		{#if !item.completed}
			<Check bind:groceryList={groceryList[index]} />
		{/if}
	{/each}
	{#each groceryList as item, index}
		{#if item.completed}
			<Check bind:groceryList={groceryList[index]} />
		{/if}
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
