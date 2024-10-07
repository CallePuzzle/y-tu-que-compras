<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import { GrocerySchema, GrocerySchemaWithId } from '$lib/schemas';
	import AddEditModal from '$lib/components/forms/AddEditModal.svelte';

	import type { PageData } from './$types';
	import type { Grocery } from '@prisma/client';

	let superform = $state();
	let superFormReady = $state(false);

	let {
		data
	}: {
		data: PageData;
	} = $props();

	onMount(async () => {
		superform = await superValidate(zod(GrocerySchema));
		superFormReady = true;
	});

	const groceries: Grocery[] = data.groceries;
	const groceriesForm = data.forms;
</script>

<div class="flex flex-col place-items-center">
	<h2>Listado de productos</h2>
	{#each groceries as grocery, index}
		<div class="card bg-neutral text-neutral-content w-96 my-1">
			<div class="card-body flex flex-row items-center">
				<div class="flex flex-col basis-1/2">
					<h3 class="card-title">{grocery.name}</h3>
					<p>{grocery.description}</p>
				</div>
				<div class="card-actions basis-1/2 justify-end">
					<AddEditModal
						id={String(grocery.id)}
						title="Edita el producto {grocery.name}"
						superform={groceriesForm[index]}
						schema={GrocerySchemaWithId}
						type="grocery"
						action="edit"
						iconSize="2em"
					/>
				</div>
			</div>
		</div>
	{/each}

	{#if superFormReady}
		<AddEditModal
			title="Crea un nuevo producto"
			{superform}
			schema={GrocerySchema}
			type="grocery"
			action="add"
		/>
	{/if}
</div>
