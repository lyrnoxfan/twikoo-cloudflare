import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { commentOwner, recentComments } from '../src/comment-access.js'
function fixture() {
	const sql = new DatabaseSync(':memory:')
	sql.exec(
		`CREATE TABLE comment (_id TEXT, url TEXT, rid TEXT, isSpam INTEGER, created INTEGER);INSERT INTO comment VALUES ('a','/posts/one/','',0,1),('b','/posts/two/','',0,3),('c','/posts/one/','a',0,4),('d','/posts/one/','',1,5);`
	)
	const DB = {
		prepare: (query) => ({
			bind: (...args) => ({
				first: async () => sql.prepare(query).get(...args),
				all: async () => ({ results: sql.prepare(query).all(...args) })
			})
		})
	}
	return { sql, DB }
}
test('owner resolves only existing nonspam article comments and malformed IDs return null', async () => {
	const { sql, DB } = fixture()
	try {
		assert.equal(await commentOwner(DB, 'a'), '/posts/one/')
		sql.exec("INSERT INTO comment VALUES ('duplicate','/posts/one/','',0,6),('duplicate','/posts/two/','',0,7)")
		for (const id of ['missing', 'd', 'duplicate', null, {}, '']) assert.equal(await commentOwner(DB, id), null)
	} finally {
		sql.close()
	}
})
test('real SQLite recent query supports absent/empty URLs, selected URLs, replies, order and cap', async () => {
	const { sql, DB } = fixture()
	try {
		assert.deepEqual(
			(await recentComments(DB, {})).map((c) => c._id),
			['b', 'a']
		)
		assert.deepEqual(
			(await recentComments(DB, { urls: [] })).map((c) => c._id),
			['b', 'a']
		)
		assert.deepEqual(
			(await recentComments(DB, { urls: ['/posts/one/'], includeReply: true })).map((c) => c._id),
			['c', 'a']
		)
		assert.deepEqual(
			(await recentComments(DB, { pageSize: 1, includeReply: true })).map((c) => c._id),
			['c']
		)
		assert.deepEqual(await recentComments(DB, { urls: ['/posts/missing/'] }), [])
		for (const event of [{ urls: 'bad' }, { urls: [7] }, { pageSize: 0 }, { pageSize: '10' }])
			await assert.rejects(() => recentComments(DB, event))
	} finally {
		sql.close()
	}
})
