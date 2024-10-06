<script lang="ts">
	import { Routes } from '$lib/routes';
	import { UserSchema } from '$lib/schemas';
	import Form from '$lib/components/forms/Form.svelte';
	import { t } from '$lib/translations';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
</script>

<div class="flex flex-col">
	<div class="hero">
		<div class="hero-content text-center">
			<div class="max-w-md">
				<h1 class="text-5xl font-bold">
					{$t('profile.hello')}
					{#if data.user.name}{data.user.name}{/if}
				</h1>
				<p class="py-6">
					Tienes {data.notificationsCount} notificaciones pendientes
					<a href={Routes.notification_my.url} class="btn">Ver notificaciones</a>
				</p>
			</div>
		</div>
	</div>
	<div class="container mx-auto px-4">
		<Form schema={UserSchema} {superform} type="user" />
	</div>
</div>
