import db from './db';
// import sender from './sender';
import { getAuth } from 'storybook-svelte';
export const auth = getAuth(db);
