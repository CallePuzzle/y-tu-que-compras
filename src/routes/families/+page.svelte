<script lang="ts">
	import { resolve } from '$app/paths';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Plus from '@lucide/svelte/icons/plus';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import { m } from '$lib/paraglide/messages.js';
	import { createFamilySchema, inviteFamilySchema } from '$lib/schemas/family.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Una fila de la lista de familias (con el permiso de invitar que trae el load). */
	type FamilyRow = PageProps['data']['families'][number];

	/** Familia elegida para invitar: título del modal compartido y query de la acción. */
	let familiaInvitada: FamilyRow | undefined = $state();

	// Referencia al `Modal` para cerrarlo cuando la operación sale bien (el
	// componente exporta `showModal` y `close`).
	let modal: { showModal(): void; close(): void } | undefined = $state();
	let inviteModal: { showModal(): void; close(): void } | undefined = $state();

	// Resultado de la última operación que se cuenta FUERA de la modal (el de
	// éxito; el de error se enseña dentro, junto al formulario, con `$message`).
	let exito: string | null = $state(null);

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se lee
	// una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en el login).
	const schema = createFamilySchema({
		nameError: m.schema_families_name_error(),
		nameLabel: m.schema_families_name_label(),
		namePlaceholder: m.schema_families_name_placeholder()
	});

	const fields = zodToFieldsJsonSchema(schema);

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				// La familia ya existe: el load que revalida superforms (por
				// defecto, sin `invalidateAll()` a mano) la trae a la lista y el
				// aviso de éxito queda en la página, no dentro del modal cerrado.
				exito = m.families_success();
				modal?.close();
			} else if (result.type === 'failure') {
				exito = null;
			}
		}
	});
	const { form: formData, enhance, delayed, message } = form;

	// Al (re)abrir el modal se limpia el rastro del intento anterior: ni el
	// mensaje de error antiguo ni el aviso de éxito de la familia ya creada.
	function abrirModal(showModal: () => void) {
		exito = null;
		message.set(undefined);
		showModal();
	}

	// Invitar por email (issue #60): un formulario y una modal compartidos por
	// todas las filas; cada fila admin la abre con su familia en el estado. La
	// familia viaja en la query de la acción (`?/invite&familia=<id>`), porque
	// el formulario solo pide el email (el rol de entrada es siempre `member`).
	const inviteSchema = inviteFamilySchema({
		emailError: m.schema_families_email_error(),
		emailLabel: m.schema_families_email_label(),
		emailPlaceholder: m.schema_families_email_placeholder()
	});

	const inviteFields = zodToFieldsJsonSchema(inviteSchema);

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const inviteForm = superForm(data.inviteForm, {
		id: 'invite',
		validators: zod4Client(inviteSchema),
		onResult({ result }) {
			if (result.type === 'success') {
				// La invitación ya está creada y el correo enviado (si el envío
				// falla, el hook del plugin deshace la invitación y llega failure):
				// aviso fuera del modal; el formulario queda a aire para la
				// siguiente (superforms lo resetea al aplicar el resultado).
				//
				// El email del aviso viaja en el RESULTADO de la acción (`message()`
				// lo deja en `form.message`) y no se lee de `$inviteData`: hasta
				// después de `onResult` superforms no aplica el resultado ni
				// resetea el formulario, y el aviso no debe depender de ese orden.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? m.families_invite_success({ email: $inviteData.email });
				inviteModal?.close();
			} else if (result.type === 'failure') {
				exito = null;
			}
		}
	});
	const {
		form: inviteData,
		enhance: enhanceInvite,
		delayed: inviteDelayed,
		message: inviteMessage,
		reset: resetInvite
	} = inviteForm;

	function abrirInvitacion(familia: FamilyRow) {
		exito = null;
		inviteMessage.set(undefined);
		resetInvite();
		familiaInvitada = familia;
		inviteModal?.showModal();
	}
</script>

<svelte:head>
	<title>{m.families_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.families_title()}</h1>

	<div class="mt-4 flex flex-wrap gap-2">
		<Modal
			bind:this={modal}
			type="X"
			boxClass="modal-box max-w-md"
			strings={{ close: m.ui_close() }}
		>
			{#snippet trigger({ showModal })}
				<button type="button" class="btn btn-primary" onclick={() => abrirModal(showModal)}>
					<Plus aria-hidden="true" />
					{m.families_create()}
				</button>
			{/snippet}

			<h2 class="text-lg font-bold">{m.families_create()}</h2>
			<form method="POST" action="?/create" use:enhance class="mt-4 flex flex-col gap-4">
				<FormFields
					{form}
					{formData}
					{fields}
					strings={{ required: m.form_required(), optional: m.form_optional() }}
				/>

				{#if $message}
					<div class="alert alert-error text-sm" role="alert">
						{$message}
					</div>
				{/if}

				<button type="submit" class="btn btn-primary" disabled={$delayed}>
					{#if $delayed}
						<span class="loading loading-spinner"></span>
					{/if}
					{m.families_create()}
				</button>
			</form>
		</Modal>

		<!-- Invitar (#60): sin disparador propio (`showButton={false}`), la abren
		     los botones «Invitar» de cada familia admin con `showModal()`. -->
		<Modal
			bind:this={inviteModal}
			type="X"
			showButton={false}
			boxClass="modal-box max-w-md"
			strings={{ close: m.ui_close() }}
		>
			<h2 class="text-lg font-bold">
				{m.families_invite_title({ family: familiaInvitada?.name ?? '' })}
			</h2>
			<p class="mt-1 text-sm opacity-70">{m.families_invite_role_hint()}</p>
			<!-- Toda invitación caduca (#102): que el admin lo sepa antes de enviar. -->
			<p class="mt-1 text-sm opacity-70">
				{m.families_invite_expiry_hint({ hours: data.invitationExpiryHours })}
			</p>

			<form
				method="POST"
				action={`?/invite&familia=${familiaInvitada?.id ?? ''}`}
				use:enhanceInvite
				class="mt-4 flex flex-col gap-4"
			>
				<FormFields
					form={inviteForm}
					formData={inviteData}
					fields={inviteFields}
					strings={{ required: m.form_required(), optional: m.form_optional() }}
				/>

				{#if $inviteMessage}
					<div class="alert alert-error text-sm" role="alert">
						{$inviteMessage}
					</div>
				{/if}

				<button type="submit" class="btn btn-primary" disabled={$inviteDelayed}>
					{#if $inviteDelayed}
						<span class="loading loading-spinner"></span>
					{/if}
					{m.families_invite()}
				</button>
			</form>
		</Modal>
	</div>

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

	{#if data.families.length === 0}
		<p class="mt-4 opacity-70">{m.families_empty()}</p>
	{:else}
		<ul class="mt-4 flex flex-col gap-2">
			{#each data.families as familia (familia.id)}
				<li
					class="bg-base-200 rounded-box flex flex-wrap items-center justify-between gap-2 px-4 py-3"
				>
					<!-- La gestión de miembros (issue #62) vive en su página: el
					     nombre enlaza a ella y hay botón propio por descubribilidad. -->
					<a
						href={resolve('/families/[familyId]', { familyId: familia.id })}
						class="min-w-0 flex-1 truncate font-medium hover:underline"
					>
						{familia.name}
					</a>
					<span class="flex items-center gap-1">
						<a
							href={resolve('/families/[familyId]', { familyId: familia.id })}
							class="btn btn-ghost btn-sm"
						>
							<Users aria-hidden="true" />
							{m.families_members()}
						</a>
						{#if familia.canInvite}
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								onclick={() => abrirInvitacion(familia)}
							>
								<UserPlus aria-hidden="true" />
								{m.families_invite()}
							</button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
