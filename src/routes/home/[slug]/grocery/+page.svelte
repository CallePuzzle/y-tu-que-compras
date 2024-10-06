<script lang="ts">
	import { Routes } from '$lib/routes';
	import { GrocerySchema } from '$lib/schemas';
	import Form from '$lib/components/forms/Form.svelte';
	import { t } from '$lib/translations';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
	const groceries = data.groceries;

	function showModal() {
		const modal = document.getElementById('add_edit_grocery');
		modal.showModal();
	}
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

<button onclick={showModal}><Icon src={AiOutlinePlusSquare} size="4em" /></button>

<dialog id="add_edit_grocery" class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-bold">Crea una nueva casa</h3>
		<Form schema={GrocerySchema} {superform} type="grocery" action="?/addHome" />
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">{$t('index.close')}</button>
			</form>
		</div>
	</div>
</dialog>
