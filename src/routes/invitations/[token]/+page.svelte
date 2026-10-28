<script lang="ts">
	import { enhance } from '$app/forms';
	import { m } from '$lib/paraglide/messages.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Aceptar y rechazar con `enhance` y deshabilitados mientras hay una
	// respuesta en vuelo (#115): un doble toque mandaba dos POST y el 2.º
	// respondía «ya no está disponible» tras el éxito. Una sola bandera para
	// los dos: tampoco tiene sentido rechazar mientras se acepta.
	let respondiendo = $state(false);

	const responder: SubmitFunction = ({ cancel }) => {
		if (respondiendo) return cancel();
		respondiendo = true;
		return async ({ update }) => {
			await update();
			respondiendo = false;
		};
	};

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

			<!-- Respuesta a la invitación (issue #61): solo el invitado con sesión
			     la ve activa; el load ya redirigió al login sin ella. -->
			{#if data.viewer?.canRespond}
				{#if form?.error}
					<div class="alert alert-error text-sm" role="alert">{form.error}</div>
				{/if}

				<div class="flex flex-col gap-2 sm:flex-row">
					<form method="POST" action="?/accept" use:enhance={responder} class="flex-1">
						<button class="btn btn-accent w-full" type="submit" disabled={respondiendo}>
							{m.invitations_accept()}
						</button>
					</form>
					<form method="POST" action="?/reject" use:enhance={responder} class="flex-1">
						<button class="btn btn-error btn-outline w-full" type="submit" disabled={respondiendo}>
							{m.invitations_reject()}
						</button>
					</form>
				</div>
			{:else if data.viewer && data.invitation.status === 'pending'}
				<!-- Con sesión pero ajena a la invitación (checklist #61): ni botones
				     ni rastro del error, solo la explicación. -->
				<div class="alert alert-warning text-sm" role="alert">
					{m.invitations_not_yours()}
				</div>
			{/if}
		</div>
	{/if}
</section>
