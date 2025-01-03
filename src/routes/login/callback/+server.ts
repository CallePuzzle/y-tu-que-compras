import { AUTH0_DOMAIN } from '$env/static/private';
import { auth0, initializeLucia } from '$lib/server/auth';
import { initializePrisma } from '$lib/server/db';
import { OAuth2RequestError } from 'arctic';
import { logger } from '$lib/server/logger';

import type { RequestEvent } from '@sveltejs/kit';
import { Routes } from '$lib/routes';

export async function GET(event: RequestEvent): Promise<Response> {
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const storedState = event.cookies.get('auth0_oauth_state') ?? null;
	if (!code || !state || !storedState || state !== storedState) {
		return new Response(null, {
			status: 400
		});
	}

	const db = event.platform!.env.DB;
	const lucia = initializeLucia(db);
	const prisma = initializePrisma(db);

	try {
		const tokens = await auth0.validateAuthorizationCode(code);
		const response = await fetch('https://' + AUTH0_DOMAIN + '/userinfo', {
			headers: {
				Authorization: `Bearer ${tokens.data.access_token}`
			}
		});
		const user = await response.json();
		logger.info(user, 'user info from auth0');
		const existingUser = await prisma.user.findUnique({
			where: {
				id: user.sub
			}
		});
		if (existingUser) {
			const session = await lucia.createSession(existingUser.id, {});
			const sessionCookie = lucia.createSessionCookie(session.id);
			event.cookies.set(sessionCookie.name, sessionCookie.value, {
				path: '.',
				...sessionCookie.attributes
			});
			await prisma.user.update({
				where: {
					id: user.sub
				},
				data: {
					picture: user.picture
				}
			});
			logger.debug(existingUser, 'user updated');
		} else {
			const createdUser = await prisma.user.create({
				data: {
					id: user.sub,
					picture: user.picture,
					name: user.name
				}
			});
			logger.debug(createdUser, 'user created');
			const session = await lucia.createSession(user.sub, {});
			const sessionCookie = lucia.createSessionCookie(session.id);
			event.cookies.set(sessionCookie.name, sessionCookie.value, {
				path: '.',
				...sessionCookie.attributes
			});
		}

		return new Response(null, {
			status: 302,
			headers: new Headers({
				Location: Routes.profile.url as string
			})
		});
	} catch (e) {
		logger.error(e, 'error in login callback');
		if (e instanceof OAuth2RequestError && e.message === 'bad_verification_code') {
			// invalid code
			return new Response(null, {
				status: 400
			});
		}
		return new Response(null, {
			status: 500
		});
	}
}
