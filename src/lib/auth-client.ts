import { createCallepuzzleAuthClient } from '@callepuzzle/auth/client';

// Factoría: se instancia una sola vez aquí, sin plugins de momento. Cuando
// entren los plugins de login (p. ej. emailOTPClient), añádelos también al
// servidor para mantener el tipado de $Infer.Session en sincronía.
export const authClient = createCallepuzzleAuthClient();

export type AuthClient = typeof authClient;
