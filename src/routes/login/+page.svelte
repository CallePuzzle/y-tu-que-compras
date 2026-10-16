<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { FormLoginOtp } from '@callepuzzle/svelte-ui/otp';
	import { createLoginSchema } from '@callepuzzle/core/schema';
	import { m } from '$lib/paraglide/messages.js';
	import { authClient } from '$lib/auth-client.js';

	// La libreria no invalida ni navega: aqui repintamos la sesion (el layout
	// la recibe del load) y volvemos al inicio.
	async function onLoginSuccess() {
		await invalidateAll();
		await goto(resolve('/'));
	}

	// El schema se construye EN RENDER, nunca en scope de modulo (regla i18n de
	// la libreria): los textos de Paraglide se resuelven con el locale activo.
	const loginSchema = $derived(
		createLoginSchema({
			emailDescription: m.schema_login_email_describe(),
			emailError: m.schema_login_email_error()
		})
	);
</script>

<svelte:head>
	<title>{m.form_login_sign_in()} · {m.app_brand()}</title>
</svelte:head>

<section class="flex min-h-[60vh] items-center justify-center">
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
