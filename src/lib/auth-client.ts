import { createAuthClient } from 'better-auth/svelte';
import { magicLinkClient, organizationClient, adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [magicLinkClient(), organizationClient(), adminClient()]
});

export const { signIn, signUp, useSession } = authClient;

export const session = useSession();
