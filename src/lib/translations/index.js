import i18n from 'sveltekit-i18n';
import { dev } from '$app/environment';
import lang from './lang.json';

//import type { Config } from 'sveltekit-i18n';

export const defaultLocale = 'es';

/** @type {import('sveltekit-i18n').Config} */
export const config = {
	loaders: [
		{
			locale: 'es',
			key: 'user',
			loader: async () => (await import('./es/user.json')).default
		},
		{
			locale: 'es',
			key: 'profile',
			loader: async () => (await import('./es/profile.json')).default
		}
	]
};

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
