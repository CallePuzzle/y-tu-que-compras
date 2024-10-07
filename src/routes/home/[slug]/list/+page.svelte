<script lang="ts">
	import { onMount } from 'svelte';
	import { superValidate } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import { ListSchema } from '$lib/schemas';
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
	/>
{/if}
