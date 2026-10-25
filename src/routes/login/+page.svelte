<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { FormLoginOtp } from '@callepuzzle/svelte-ui/otp';
	import { createLoginSchema } from '@callepuzzle/core/schema';
	import { m } from '$lib/paraglide/messages.js';
	import { authClient } from '$lib/auth-client.js';
	import { sanitizeInvitedEmail, sanitizeRedirectTo } from '$lib/redirect.js';

	// Redirección post-login: el guard manda aquí con `?redirectTo=<url original>`.
	// Se acepta sólo si es una ruta interna (`sanitizeRedirectTo`), nunca una URL
	// externa: sin esa validación, el login sería un open redirect.
	const redirectTo = $derived(sanitizeRedirectTo(page.url.searchParams.get('redirectTo')));

	// Destino tras el login: la página que pidió el usuario (o el inicio). El cast
	// a `Pathname` hace creer a `resolve` que es una ruta del proyecto, cuando
	// `redirectTo` es un pathname interno arbitrario. (El cast anterior vía
	// `Parameters<typeof resolve>[0]` colapsaba a `never` en cuanto el proyecto
	// estrenó su primera ruta con parámetro: /invitations/[token].)
	const afterLoginHref = $derived(resolve((redirectTo ?? '/') as Pathname));

	// Invitación pendiente de responder (issue #61): quien llega del enlace del
	// correo sin sesión aterriza aquí con `?email=<email del invitado>`, para no
	// volver a teclearlo. Entrada de usuario por query: pasa por el saneado.
	const invitedEmail = $derived(sanitizeInvitedEmail(page.url.searchParams.get('email')));

	// La libreria no invalida ni navega: aqui repintamos la sesion (el layout
	// la recibe del load) y volvemos a la página que pidió el usuario (o al inicio).
	async function onLoginSuccess() {
		await invalidateAll();
		await goto(afterLoginHref);
	}

	// El schema se construye EN RENDER, nunca en scope de modulo (regla i18n de
	// la libreria): los textos de Paraglide se resuelven con el locale activo.
	// Con email de invitación se añade como `.default()` del campo: superforms
	// toma los valores iniciales del formulario de los defaults del schema, así
	// que ese `.default()` ES el prefill. El cast recupera el tipo de
	// `createLoginSchema` porque el default envuelve el campo en `ZodDefault`.
	const loginSchema = $derived.by(() => {
		const base = createLoginSchema({
			emailDescription: m.schema_login_email_describe(),
			emailError: m.schema_login_email_error()
		});
		if (!invitedEmail) return base;
		// El `as unknown` es porque zod tipa el campo con default como
		// `ZodDefault<ZodEmail>`, sin solape con el `ZodEmail` original: para el
		// formulario es el mismo schema de un campo, ahora con valor inicial.
		return base.extend({ email: base.shape.email.default(invitedEmail) }) as unknown as typeof base;
	});
</script>

<svelte:head>
	<title>{m.form_login_sign_in()} · {m.app_brand()}</title>
</svelte:head>

<section class="flex min-h-[60vh] flex-col items-center justify-center gap-4">
	{#if invitedEmail}
		<!-- Aviso del flujo de invitación (#61): el email del formulario va ya
		     relleno con el del enlace del correo. -->
		<div class="alert alert-info max-w-xs text-sm" role="status">
			{m.login_invitation({ email: invitedEmail })}
		</div>
	{/if}
	<!-- «Empezar de nuevo» recarga esta misma pagina (la libreria pone
	     data-sveltekit-reload en el enlace): vuelve al paso 1 sin sacar al
	     usuario del login. -->
	<FormLoginOtp
		{authClient}
		schema={loginSchema}
		startOverHref="/login"
		onSuccess={onLoginSuccess}
		strings={{
			signIn: m.form_login_sign_in(),
			stepEmail: m.form_login_step_email(),
			stepOtp: m.form_login_step_otp(),
			otpLabel: m.form_login_otp_label(),
			otpDescription: (digits) => m.form_login_otp_description({ digits }),
			success: m.form_login_success(),
			rateLimited: m.form_login_rate_limited(),
			invalidCode: m.form_login_invalid_code(),
			error: m.form_login_error(),
			startOver: m.form_login_start_over(),
			required: m.form_required(),
			optional: m.form_optional()
		}}
	/>
</section>
