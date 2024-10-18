<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import { IdSchema } from '$lib/schemas';

	import type { PageData } from './$types';
	import Form from '$lib/components/forms/Form.svelte';
	import type { GroceryListExtended } from '$lib/schemas';

	let superform: SuperValidated<Infer<any>> = $state({}) as SuperValidated<Infer<any>>;
	let superFormReady = $state(false);
	let completedGroceries = $state([] as GroceryListExtended[]);
	let todoGroceries = $state([] as GroceryListExtended[]);

	let {
		data
	}: {
		data: PageData;
	} = $props();

	onMount(async () => {
		superform = await superValidate(zod(IdSchema));
		superFormReady = true;
	});

	$effect(() => {
		completedGroceries = data.list.groceries.filter((grocery) => grocery.completed);
		todoGroceries = data.list.groceries.filter((grocery) => !grocery.completed);
	});
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{data.list.name}</h2>
	{#each todoGroceries as item, index}
		<div class="card bg-neutral text-neutral-content w-96 my-1">
			<div class="card-body flex flex-row items-center">
				<div class="flex flex-col basis-1/2">
					<h3 class="card-title">
						<input type="checkbox" name="todo{index}" class="checkbox" checked={item.completed} />
						<button class="checkbox checked"></button>
						{item.grocery.name}
					</h3>
				</div>
			</div>
		</div>
	{/each}
	{#each completedGroceries as item, index}
		<div class="card bg-neutral text-neutral-content w-96 my-1">
			<div class="card-body flex flex-row items-center">
				<div class="flex flex-col basis-1/2">
					<h3 class="card-title">
						<input
							type="checkbox"
							name="completed{index}"
							class="checkbox"
							checked={item.completed}
						/>
						{item.grocery.name}
					</h3>
				</div>
			</div>
		</div>
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

<style>
	.checked {
		background-repeat: no-repeat;
		animation: checkmark var(--animation-input, 0.2s) ease-out;
		background-color: var(--chkbg);
		background-image: linear-gradient(-45deg, transparent 65%, var(--chkbg) 65.99%),
			linear-gradient(45deg, transparent 75%, var(--chkbg) 75.99%),
			linear-gradient(-45deg, var(--chkbg) 40%, transparent 40.99%),
			linear-gradient(
				45deg,
				var(--chkbg) 30%,
				var(--chkfg) 30.99%,
				var(--chkfg) 40%,
				transparent 40.99%
			),
			linear-gradient(-45deg, var(--chkfg) 50%, var(--chkbg) 50.99%);
	}
</style>
