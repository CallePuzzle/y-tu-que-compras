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
			key: 'index',
			loader: async () => (await import('./es/index.json')).default
		},
		{
			locale: 'es',
			key: 'user',
			loader: async () => (await import('./es/user.json')).default
		},
		{
			locale: 'es',
			key: 'home',
			loader: async () => (await import('./es/home.json')).default
		},
		{
			locale: 'es',
			key: 'profile',
			loader: async () => (await import('./es/profile.json')).default
		},
		{
			locale: 'es',
			key: 'grocery',
			loader: async () => (await import('./es/grocery.json')).default
		},
		{
			locale: 'es',
			key: 'list',
			loader: async () => (await import('./es/list.json')).default
		},
		{
			locale: 'es',
			key: 'store',
			loader: async () => (await import('./es/store.json')).default
		}
	]
};

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
