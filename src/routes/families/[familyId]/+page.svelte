<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Crown from '@lucide/svelte/icons/crown';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Un miembro de la lista que trae el load. */
	type Member = PageProps['data']['family']['members'][number];

	const familia = $derived(data.family);
	const viewer = $derived(familia.viewer);

	/** Miembro elegido para expulsar: título del modal compartido y su form. */
	let miembroExpulsado: Member | undefined = $state();

	// Expulsar, salir y borrar confirman en un `ConfirmModal`: el error se
	// enseña DENTRO, que sigue abierto; el éxito cierra y el load revalidado
	// (o el redirect de salir/borrar) ya muestra el estado nuevo. El de
	// promover (sin modal) cae al aviso de página (`form.error`).
	let kickModal: ConfirmModal | undefined = $state();

	function abrirExpulsion(miembro: Member) {
		miembroExpulsado = miembro;
		kickModal?.showModal();
	}
</script>

<svelte:head>
	<title>{m.families_members_title({ family: familia.name })} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<p>
		<a href={resolve('/families')} class="btn btn-ghost btn-sm -ml-2">
			<ArrowLeft aria-hidden="true" />
			{m.ui_back()}
		</a>
	</p>

	<h1 class="text-2xl font-bold">{m.families_members_title({ family: familia.name })}</h1>

	<!-- Aviso de las acciones sin modal (promover); las de modal llevan el
	     suyo dentro. -->
	{#if form?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{form.error}
		</div>
	{/if}

	<ul class="mt-4 flex flex-col gap-2">
		{#each familia.members as miembro (miembro.id)}
			<li
				class="bg-base-200 rounded-box flex flex-wrap items-center justify-between gap-2 px-4 py-3"
			>
				<div class="min-w-0">
					<p class="flex items-center gap-2 font-medium">
						<span class="truncate">{miembro.name}</span>
						{#if miembro.id === viewer?.memberId}
							<span class="text-sm font-normal opacity-60">({m.families_member_you()})</span>
						{/if}
					</p>
					<p class="truncate text-sm opacity-70">{miembro.email}</p>
				</div>

				<div class="flex items-center gap-1">
					{#if miembro.isAdmin}
						<span class="badge badge-primary gap-1">
							<Crown aria-hidden="true" class="size-3" />
							{m.families_role_admin()}
						</span>
					{:else}
						<span class="badge badge-ghost">{m.families_role_member()}</span>
					{/if}

					<!-- Acciones de admin sobre OTROS miembros: promover (issue #62)
					     y expulsar con confirmación. El guard del endpoint es quien
					     autoriza de verdad; la UI solo no las pinta. -->
					{#if viewer?.isAdmin && miembro.id !== viewer.memberId}
						{#if !miembro.isAdmin}
							<form method="POST" action="?/promote" use:enhance>
								<input type="hidden" name="memberId" value={miembro.id} />
								<button type="submit" class="btn btn-ghost btn-sm" title={m.families_promote()}>
									<Crown aria-hidden="true" />
									<span class="sr-only">{m.families_promote()}</span>
								</button>
							</form>
						{/if}
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.families_kick()}
							onclick={() => abrirExpulsion(miembro)}
						>
							<UserMinus aria-hidden="true" />
							<span class="sr-only">{m.families_kick()}</span>
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	<!-- Invitaciones pendientes (issue #102): solo el admin las ve — llevan
	     emails de terceros — y puede cancelar cada una. La caducada se señala:
	     su enlace ya no sirve, pero sigue aquí hasta cancelarse (el cron la
	     marcará «expired» en la base). -->
	{#if viewer?.isAdmin && familia.pendingInvitations.length > 0}
		<section class="mt-8">
			<h2 class="text-sm font-bold opacity-70">{m.families_invitations_pending()}</h2>
			<ul class="mt-2 flex flex-col gap-2">
				{#each familia.pendingInvitations as invitacion (invitacion.id)}
					<li
						class="bg-base-200 rounded-box flex flex-wrap items-center justify-between gap-2 px-4 py-3"
					>
						<div class="min-w-0">
							<p class="truncate font-medium">{invitacion.email}</p>
							<p class="text-sm opacity-70">
								{#if invitacion.expired}
									{m.families_invitation_expired()}
								{:else if invitacion.expiresLabel}
									{m.families_invitation_expires({ date: invitacion.expiresLabel })}
								{/if}
							</p>
						</div>
						<form method="POST" action="?/cancel" use:enhance>
							<input type="hidden" name="invitationId" value={invitacion.id} />
							<button type="submit" class="btn btn-ghost btn-sm btn-error">
								{m.families_invitation_cancel()}
							</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Salir de la familia (issue #62): para cualquier miembro, admin o no;
	     si es el último admin, el servidor lo rechaza con la explicación. -->
	<div class="mt-6">
		<ConfirmModal
			title={m.families_leave_title({ family: familia.name })}
			description={m.families_leave_description()}
			confirmLabel={m.families_leave_confirm()}
			action="?/leave"
			fields={{ memberId: viewer?.memberId ?? '' }}
			errorFallback={m.families_members_error()}
		>
			{#snippet trigger({ showModal })}
				<button type="button" class="btn btn-outline" onclick={showModal}>
					<LogOut aria-hidden="true" />
					{m.families_leave()}
				</button>
			{/snippet}
		</ConfirmModal>
	</div>

	<!-- Zona de peligro (issue #62): borrar la familia, solo admin. -->
	{#if viewer?.isAdmin}
		<div class="border-error/40 rounded-box mt-8 flex flex-col gap-3 border p-4">
			<h2 class="text-error flex items-center gap-2 text-sm font-bold">
				<ShieldAlert aria-hidden="true" />
				{m.families_danger_zone()}
			</h2>

			<ConfirmModal
				title={m.families_delete_title({ family: familia.name })}
				description={m.families_delete_description()}
				confirmLabel={m.families_delete_confirm()}
				action="?/delete"
				errorFallback={m.families_members_error()}
			>
				{#snippet trigger({ showModal })}
					<button type="button" class="btn btn-error btn-outline" onclick={showModal}>
						<Trash2 aria-hidden="true" />
						{m.families_delete_title({ family: familia.name })}
					</button>
				{/snippet}
			</ConfirmModal>
		</div>
	{/if}
</section>

<!-- Expulsar (issue #62): una modal compartida; cada botón de la lista fija
     a quién se expulsa antes de abrirla. -->
<ConfirmModal
	bind:this={kickModal}
	title={m.families_kick_title({ name: miembroExpulsado?.name ?? '' })}
	description={m.families_kick_description()}
	confirmLabel={m.families_kick_confirm()}
	action="?/kick"
	fields={{ memberId: miembroExpulsado?.id ?? '' }}
	errorFallback={m.families_members_error()}
/>
