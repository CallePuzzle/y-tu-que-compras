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

<ul class="list-disc pl-5">
	{#each groceries as grocery, index}
		<li class="mb-2">
			<div class="card shadow-lg compact bg-base-100">
				<div class="card-body">
					<h2 class="card-title">{grocery.name}</h2>
					<p>{grocery.description}</p>
				</div>
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
		</li>
	{/each}
</ul>

{#if superFormReady}
	<AddEditModal
		title="Crea un nuevo producto"
		{superform}
		schema={GrocerySchema}
		type="grocery"
		action="add"
	/>
{/if}
