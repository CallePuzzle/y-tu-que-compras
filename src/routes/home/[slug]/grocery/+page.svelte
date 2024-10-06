<script lang="ts">
	import { Routes } from '$lib/routes';
	import { onMount } from 'svelte';
	import { superValidate } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import { GrocerySchema } from '$lib/schemas';
	import AddEditModal from '$lib/components/forms/AddEditModal.svelte';
	import { t } from '$lib/translations';

	import type { PageData } from './$types';

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

	const groceries = data.groceries;
</script>

<ul class="list-disc pl-5">
	{#each groceries as grocery}
		<li class="mb-2">
			<div class="card shadow-lg compact bg-base-100">
				<div class="card-body">
					<h2 class="card-title">{grocery.name}</h2>
					<p>{grocery.description}</p>
				</div>
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
		action="?/addGrocery"
	/>
{/if}
