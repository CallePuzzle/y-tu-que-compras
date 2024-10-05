import type { Notification, PrismaClient } from '@prisma/client';

interface UserNotifications {
	notifications: Notification[];
	notificationsCount: number;
}

export { type UserNotifications, GetUserNotifications };

async function GetUserNotifications(
	prisma: PrismaClient,
	userId: string
): Promise<UserNotifications> {
	const notifications = await prisma.notification.findMany({
		where: {
			users: {
				some: {
					id: userId
				}
			}
		},
		orderBy: [
			{
				createdAt: 'desc'
			}
		]
	});
	const notificationsCount = await prisma.notification.count({
		where: {
			users: {
				some: {
					id: userId
				}
			},
			status: 'PENDING'
		}
	});

	return {
		notifications,
		notificationsCount
	} as UserNotifications;
}
