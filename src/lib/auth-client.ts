import { createCallepuzzleAuthClient } from '@callepuzzle/auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';

// Factoría: se instancia una sola vez aquí. El plugin emailOTP da al cliente
// los endpoints que consume FormLoginOtp (pedir el código y canjearlo); si
// entran más plugins, añádelos también al servidor para mantener el tipado de
// $Infer.Session en sincronía.
export const authClient = createCallepuzzleAuthClient({
	plugins: [emailOTPClient()]
});

export type AuthClient = typeof authClient;
