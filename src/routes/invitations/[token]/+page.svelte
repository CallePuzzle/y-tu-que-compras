<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Mismos estados que la invitación (los del modelo del plugin); `expired` lo
	// calcula el load para no esperar al barrido del cron de cleanup.
	const statusMessages = {
		pending: m.invitations_status_pending(),
		accepted: m.invitations_status_accepted(),
		cancelled: m.invitations_status_cancelled(),
		rejected: m.invitations_status_rejected(),
		expired: m.invitations_status_expired()
	} as const;
</script>

<svelte:head>
	<title>{m.invitations_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.invitations_title()}</h1>

	{#if !data.invitation}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{m.invitations_invalid()}
		</div>
	{:else}
		<div class="bg-base-200 rounded-box mt-4 flex flex-col gap-3 px-4 py-4">
			<p class="text-lg font-semibold">
				{m.invitations_invited_by({ inviter: data.invitation.invitedBy })}
			</p>

			<dl class="flex flex-col gap-2 text-sm">
				<div class="flex items-center justify-between gap-2">
					<dt class="opacity-70">{m.invitations_family()}</dt>
					<dd class="font-medium">{data.invitation.familyName}</dd>
				</div>

				{#if data.invitation.identifier}
					<div class="flex items-center justify-between gap-2">
						<dt class="opacity-70">{m.invitations_email()}</dt>
						<dd class="font-medium">{data.invitation.identifier}</dd>
					</div>
				{/if}

				<div class="flex items-center justify-between gap-2">
					<dt class="opacity-70">{m.invitations_status()}</dt>
					<dd><span class="badge badge-outline">{statusMessages[data.invitation.status]}</span></dd>
				</div>
			</dl>

			<!-- Aceptar/rechazar (issue #61) entra aquí: la vista muestra el estado,
			     el flujo de login con `redirectTo` ya funciona sin sesión. -->
		</div>
	{/if}
</section>
