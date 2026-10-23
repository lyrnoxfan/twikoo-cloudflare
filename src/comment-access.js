// Only called after the request's proxy secret has been verified.
export async function commentOwner(DB, id) {
	if (typeof id !== 'string' || !id || id.length > 128) return null
	const { results } = await DB.prepare('SELECT url, isSpam FROM comment WHERE _id = ?1 LIMIT 2').bind(id).all()
	const row = results.length === 1 ? results[0] : null
	return row && !row.isSpam && typeof row.url === 'string' && row.url.startsWith('/posts/') ? row.url : null
}

export async function recentComments(DB, event) {
	if (event.urls != null && (!Array.isArray(event.urls) || event.urls.length > 50 || event.urls.some((url) => typeof url !== 'string')))
		throw new Error('Invalid urls')
	const urls = event.urls || []
	const size = event.pageSize == null ? 10 : event.pageSize
	if (!Number.isInteger(size) || size < 1) throw new Error('Invalid pageSize')
	const where = urls.length ? ` AND url IN (${urls.map(() => '?').join(', ')})` : ''
	const result = await DB.prepare(
		`SELECT * FROM comment WHERE NOT isSpam AND (? OR rid = '')${where} ORDER BY created DESC, _id DESC LIMIT ?`
	)
		.bind(Number(event.includeReply === true), ...urls, Math.min(size, 100))
		.all()
	return result.results
}
