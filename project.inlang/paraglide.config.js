import { defineConfig } from '@inlang/paraglide-js';

// Única fuente de la configuración de Paraglide: la leen tanto el plugin de
// Vite como el CLI del postinstall (`paraglide-js compile`), así que no hay
// dos copias de la estrategia que mantener a la par.
//
// Estrategia de detección (issue #78): la cookie manda (la escribe solo el
// selector de idioma); sin cookie, la inicial sale de `Accept-Language` en el
// servidor (`preferredLanguage`); la base, último recurso. Sin
// `globalVariable`: en el servidor esa variable es única para todo el proceso
// y, en cuanto algo la fijara fuera del contexto de request, taparía el
// Accept-Language de todas las visitas siguientes.
//
// En el cliente `getLocale()` no usa esta estrategia: `src/hooks.client.ts` la
// sustituye por la locale que el SSR dejó en `<html lang>`, para que la
// hidratación no cambie de idioma ni se escriba la cookie sin pasar por el
// selector.
export default defineConfig({
	strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
	cookieSameSite: 'lax',
	cookieSecure: 'auto'
});
