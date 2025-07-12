import { getDB } from 'storybook-svelte/server';
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$env/static/private';

export default getDB(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
