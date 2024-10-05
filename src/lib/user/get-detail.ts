import type { PrismaClient, User } from '@prisma/client';

export async function GetDetail(db: PrismaClient, userId: string): Promise<User | null> {
	return db.user.findUnique({
		where: {
			id: userId
		}
	});
}
