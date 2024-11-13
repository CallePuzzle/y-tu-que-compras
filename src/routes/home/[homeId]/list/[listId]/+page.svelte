<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/translations';
	import { superValidate, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import { IdSchema } from '$lib/schemas';
	import GroceryDetail from '$lib/components/list/GroceryDetail.svelte';

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

	let groceryList = $state(data.groceryList as GroceryListExtended[]);

	onMount(async () => {
		superform = await superValidate(zod(IdSchema));
		superFormReady = true;
	});

	$effect(() => {
		groceryList = data.groceryList as GroceryListExtended[];
	});
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{data.list.name}</h2>
	{#each groceryList as item, index}
		{#if !item.completed}
			<GroceryDetail bind:groceryList={groceryList[index]} />
		{/if}
	{/each}
	{#if data.thereAreCompletedGroceries}
		<h3 class="text-xl m-2">{$t('list.completed')}</h3>
	{/if}
	{#each groceryList as item, index}
		{#if item.completed}
			<GroceryDetail bind:groceryList={groceryList[index]} />
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
				<Combobox
					{form}
					field="id"
					type="grocery"
					valueArray={data.groceries}
					placeholder="ej: plátanos"
				/>
			{/snippet}
		</Form>
	{/if}
</div>
