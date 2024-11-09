<script lang="ts">
	import { t } from '$lib/translations';
	import AddEditModal from '$lib/components/forms/AddEditModal.svelte';
	import { HomeSchema } from '$lib/schemas';
	import { Routes } from '$lib/routes';
	import IconComponent from '$lib/components/layout/IconComponent.svelte';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
</script>

<div class="hero bg-base-200 min-h-screen">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h1 class="text-5xl font-bold">{$t('profile.hello')} {data.user.name}</h1>
			<p class="py-6">
				{$t('index.selectHome')}
			</p>
			{#each data.houses as home, index}
				<div class="card bg-base-100 shadow-xl my-4">
					<a href={Routes.home_index.generateUrl({ id: home.id })}>
						<div class="card-body flex flex-row">
							<div class="basis-1/2">
								<IconComponent icon={home.icon} size="2.5em" />
							</div>
							<div class="basis-1/2">
								<h2 class="card-title">{home.name}</h2>
								<p class="flex">{home.description}</p>
							</div>
						</div>
					</a>
				</div>
			{/each}
			<AddEditModal
				title="Crea una nueva casa"
				{superform}
				schema={HomeSchema}
				type="home"
				action="add"
			/>
		</div>
	</div>
</div>
