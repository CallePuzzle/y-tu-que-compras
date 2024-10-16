import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { logger } from '$lib/server/logger';

export async function add(
	request: Request,
	prismaObject: any,
	schema: any,
	type: string,
	homeId: number
) {
	const form = await superValidate(request, zod(schema));
	logger.info(form, 'add form: ' + type);
	if (!form.valid) {
		logger.debug('form invalid');
		return fail(400, { form });
	}

	try {
		const object = await prismaObject.create({
			data: {
				...form.data,
				homeId: homeId
			}
		});
		logger.info(object, type + ' created');
		return message(form, type + ' created successfully!');
	} catch (error) {
		logger.error(error);
		return message(form, 'Error creating ' + type);
	}
}

export async function edit(
	request: Request,
	prismaObject: any,
	schema: any,
	type: string,
	homeId: number
) {
	const form = await superValidate(request, zod(schema));
	logger.info(form, 'edit form: ' + type);
	if (!form.valid) {
		logger.debug('form invalid');
		return fail(400, { form });
	}
	const { id } = form.data as { id: number };
	try {
		const object = await prismaObject.update({
			where: {
				id: id
			},
			data: {
				...form.data,
				homeId: homeId
			}
		});
		logger.info(object, type + ' updated');
		return message(form, type + ' updated successfully!');
	} catch (error) {
		logger.error(error);
		return message(form, 'Error updating ' + type);
	}
}
