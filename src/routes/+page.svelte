<script lang="ts">
	import { t } from '$lib/translations';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';
	import Form from '$lib/components/Form.svelte';
	import { homeSchema } from '$lib/schemas/home';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
	const houses = data.houses;

	function showModal() {
		const modal = document.getElementById('add_home');
		modal.showModal();
	}
</script>

<div class="hero bg-base-200 min-h-screen">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h1 class="text-5xl font-bold">{$t('profile.hello')} {data.user.name}</h1>
			<p class="py-6">
				{$t('index.selectHome')}
			</p>
			{#each houses as home}
				<div class="card bg-base-100 shadow-xl my-4">
					<div class="card-body">
						<h2 class="card-title">{home.name}</h2>
						<p>{home.description}</p>
					</div>
				</div>
			{/each}
			<button onclick={showModal}><Icon src={AiOutlinePlusSquare} size="4em" /></button>
		</div>
	</div>
</div>

<dialog id="add_home" class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-bold">Crea una nueva casa</h3>
		<Form schema={homeSchema} {superform} type="home" action="?/addHome" />
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">{$t('index.close')}</button>
			</form>
		</div>
	</div>
</dialog>
