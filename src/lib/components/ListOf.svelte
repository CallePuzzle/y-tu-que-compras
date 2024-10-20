<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import AddEditModal from '$lib/components/forms/AddEditModal.svelte';

	import { type SuperValidated, type Infer } from 'sveltekit-superforms';
	import type { Snippet } from 'svelte';

	let superform: SuperValidated<Infer<any>> = $state({}) as SuperValidated<Infer<any>>;
	let superFormReady = $state(false);

	let {
		h2title,
		items,
		forms,
		type,
		schema,
		schemaWithId,
		card
	}: {
		h2title: string;
		items: any[];
		forms: any[];
		type: string;
		schema: any;
		schemaWithId: any;
		card?: Snippet<[any]>;
	} = $props();

	onMount(async () => {
		superform = await superValidate(zod(schema));
		superFormReady = true;
	});
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{h2title}</h2>
	{#each items as item, index}
		<div class="card bg-neutral text-neutral-content w-96 my-1">
			<div class="card-body flex flex-row items-center">
				{#if card}
					{@render card(item)}
				{:else}
					<div class="flex flex-col basis-1/2">
						<h3 class="card-title">{item.name}</h3>
					</div>
				{/if}

				<div class="card-actions basis-1/2 justify-end">
					<AddEditModal
						id={String(item.id)}
						title="Edita el producto {item.name}"
						superform={forms[index]}
						schema={schemaWithId}
						{type}
						action="edit"
						iconSize="2em"
					/>
				</div>
			</div>
		</div>
	{/each}

	{#if superFormReady}
		<AddEditModal title="Crea un nuevo producto" {superform} {schema} {type} action="add" />
	{/if}
</div>
