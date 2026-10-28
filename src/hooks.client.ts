import { baseLocale, overwriteGetLocale, toLocale } from '$lib/paraglide/runtime.js';

// En el cliente la locale es SIEMPRE la que resolvió el SSR (cookie o
// Accept-Language) y dejó en `<html lang>` (`%paraglide.lang%`, ver
// `hooks.server.ts`). La estrategia por defecto de Paraglide la recalcularía
// con `navigator.languages`, que puede no coincidir con Accept-Language
// (proxies, extensiones): la hidratación cambiaría de idioma a mitad de
// página y, de paso, el primer `getLocale()` escribiría la cookie aunque nadie
// haya tocado el selector. La cookie solo la escribe `setLocale` (selector),
// que recarga y el SSR siguiente ya trae el `lang` nuevo.
overwriteGetLocale(() => toLocale(document.documentElement.lang) ?? baseLocale);
