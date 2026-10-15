import { createCallepuzzleAuthClient } from '@callepuzzle/auth/client';

// Factoria: se instancia una sola vez aqui, sin plugins de momento. Cuando
// entren los plugins de login (p. ej. emailOTPClient) anadelos tambien al
// servidor para mantener el tipado de $Infer.Session en sincria.
export const authClient = createCallepuzzleAuthClient();

export type AuthClient = typeof authClient;
