import { ProtectedRoutes } from '$lib/routes';
import { JWK, APP_URL } from '$env/static/private'; // TODO https://github.com/sveltejs/kit/issues/8882
import { GetDetail as UserGetDetail } from '$lib/user/get-detail';
import { GetUserNotifications } from '$lib/notification/get-user-notifications';
import { initializePrisma } from '$lib/server/db';
import { getPublicKeyFromJwk } from 'cf-webpush';
import { logger } from '$lib/server/logger';

import type { PageServerLoad, PageServerLoadEvent } from './$types';
import type { UserNotifications } from '$lib/notification/get-user-notifications';

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	let user = null;
	let userNotification: UserNotifications = {
		notifications: [],
		notificationsCount: 0
	};

	if (event.locals.user) {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		user = await UserGetDetail(prisma, event.locals.user.id);
		logger.debug(user, 'current user');
		userNotification = await GetUserNotifications(prisma, event.locals.user.id);
	}

	const path = event.route.id;

	return {
		isProtectedRoute: ProtectedRoutes.some((route) => route.path === path),
		protectedRouteMessage: ProtectedRoutes.find((route) => route.path === path)?.message,
		appUrl: APP_URL,
		path: path,
		userIsLogged: event.locals.user ? true : false,
		user: user,
		JWKpublicKey: getPublicKeyFromJwk(JSON.parse(JWK)),
		notifications: userNotification.notifications,
		notificationsCount: userNotification.notificationsCount
	};
};
