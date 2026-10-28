// Formato localizado de fechas y precios (issue #76): la locale activa viaja
// SIEMPRE como argumento — quien la llama la resuelve con `getLocale()` de
// Paraglide en el momento de la petición (o del render), nunca en scope de
// módulo (regla i18n de la librería). Funciones puras: sin Paraglide ni
// imports de servidor, para que las pruebe el proyecto `server` de vitest.

/**
 * La zona horaria con la que se muestran las fechas. Fijarla (y no usar la
 * del sistema) evita la divergencia SSR/hidratación: el servidor suele ir en
 * UTC y el navegador del usuario no, y `Intl.DateTimeFormat` sin zona daría
 * horas distintas en cada lado. Es un producto español («¿Y tú qué
 * compras?»): la hora de península es la que esperan sus familias.
 */
const APP_TIME_ZONE = 'Europe/Madrid';

/**
 * Fecha y hora cortas en la locale dada («28 oct 2026, 19:45» en es): el
 * formato medio de fecha con la hora abreviada, la combinación estándar de
 * `Intl` para listados.
 */
export function formatDateTime(date: Date, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: APP_TIME_ZONE
	}).format(date);
}

/**
 * Precio en euros formateado con las convenciones de la locale dada: los
 * símbolos y separadores cambian («1.234,56 €» en es, «€1,234.56» en en) pero
 * la divisa no. El total del ticket se introduce a mano en euros (#70): la
 * moneda es del producto, solo su PRESENTACIÓN es local.
 */
export function formatPrice(amount: number, locale: string): string {
	return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
}
