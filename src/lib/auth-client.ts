import { createCallepuzzleAuthClient } from '@callepuzzle/auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { tenancyClient } from '@zytera/better-auth-tenancy/client';
import { getLocale } from '$lib/paraglide/runtime.js';

// `locale` como getter: `tenancyClient` lo evalúa en cada petición para poner
// la cabecera `Accept-Language` en las rutas `/tenancy/*`, así que el plugin
// usa siempre la locale activa de Paraglide, no una fija. La respuesta del
// servidor (errores, nombres de rol traducidos) sale en ese idioma. Envuelto en
// una flecha: `hooks.client.ts` sustituye `getLocale` con `overwriteGetLocale`
// y la referencia directa podría quedarse con la implementación original.
const tenancyPlugin = tenancyClient({ locale: () => getLocale() });

// Factoría: se instancia una sola vez aquí. El plugin emailOTP da al cliente
// los endpoints que consume FormLoginOtp (pedir el código y canjearlo) y
// tenancyClient los de familias (organizaciones, roles, miembros e
// invitaciones) para la UI de la issue #58; si entran más plugins, añádelos
// también al servidor para mantener el tipado de $Infer.Session en sincronía.
export const authClient = createCallepuzzleAuthClient({
	plugins: [emailOTPClient(), tenancyPlugin]
});

export type AuthClient = typeof authClient;
