// Only the local workerd/D1 emulator is used; no production binding or fetch.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('..', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'twikoo-local-regression-'))
const cli = resolve(root, 'node_modules/.bin/wrangler')
const config = join(tmp, 'wrangler.toml')
writeFileSync(
	config,
	`name = "review-fixture"\nmain = ${JSON.stringify(resolve(root, 'src/index.js'))}\ncompatibility_flags = ["nodejs_compat"]\ncompatibility_date = "2024-09-23"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "review-fixture"\ndatabase_id = "00000000-0000-0000-0000-000000000001"\n[vars]\nTWIKOO_PROXY_SECRET = "synthetic-local-only"\n`
)
const seed = join(tmp, 'seed.sql')
const comment = (id, url, rid, spam, time) =>
	`INSERT INTO comment VALUES ('${id}','fixture','Fixture','fixture@example.test','','','','192.0.2.1',0,'${url}','','Synthetic comment','','${rid}',${spam},${time},${time},'[]',0,'');`
writeFileSync(
	seed,
	readFileSync(resolve(root, 'schema.sql'), 'utf8') +
		'\n' +
		comment('public', '/posts/public/', '', 0, 1) +
		comment('hidden', '/posts/hidden/', '', 0, 2) +
		comment('reply', '/posts/public/', 'public', 0, 3) +
		comment('spam', '/posts/public/', '', 1, 4)
)
const args = ['--config', config, '--persist-to', join(tmp, 'state')]
let server,
	logs = ''
try {
	execFileSync(cli, ['d1', 'execute', 'review-fixture', '--local', ...args, '--file', seed], {
		stdio: 'pipe',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
	})
	server = spawn(cli, ['dev', '--local', ...args, '--port', '5101'], {
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
		stdio: ['ignore', 'pipe', 'pipe']
	})
	server.stdout.on('data', (c) => (logs += c))
	server.stderr.on('data', (c) => (logs += c))
	const call = async (event, article, secret = 'synthetic-local-only') => {
		const res = await fetch('http://127.0.0.1:5101/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Twikoo-Proxy-Secret': secret,
				...(article ? { 'X-Twikoo-Guest-Article': article } : {})
			},
			body: JSON.stringify(event)
		})
		return { status: res.status, body: await res.json() }
	}
	let ready = false
	for (let i = 0; i < 90; i++) {
		try {
			const res = await call({ event: 'GET_FUNC_VERSION' })
			if (res.status === 200) {
				ready = true
				break
			}
		} catch {}
		await new Promise((r) => setTimeout(r, 300))
	}
	assert.ok(ready, logs.slice(-2000))
	assert.equal((await call({ event: 'COMMENT_GET_OWNER', id: 'public' })).body.url, '/posts/public/')
	for (const id of ['missing', 'spam']) assert.equal((await call({ event: 'COMMENT_GET_OWNER', id })).body.url, null)
	assert.equal((await call({ event: 'COMMENT_GET_OWNER', id: 'public' }, null, 'wrong')).status, 403)
	for (const event of [{ event: 'GET_RECENT_COMMENTS' }, { event: 'GET_RECENT_COMMENTS', urls: [] }]) {
		const r = await call(event)
		assert.ok(!r.body.code, JSON.stringify(r))
		assert.equal(r.body.data.length, 2)
	}
	const recent = await call({ event: 'GET_RECENT_COMMENTS', urls: ['/posts/public/'], includeReply: true })
	assert.ok(!recent.body.code)
	assert.equal(recent.body.data.length, 2)
	const good = await call({ event: 'COMMENT_LIKE', id: 'public' }, '/posts/public/')
	assert.ok(!good.body.code, JSON.stringify(good))
	const bad = await call({ event: 'COMMENT_LIKE', id: 'hidden' }, '/posts/public/')
	assert.ok(bad.body.code)
	const missing = await call({ event: 'COMMENT_LIKE', id: 'missing' }, '/posts/public/')
	assert.ok(missing.body.code)
	const spam = await call({ event: 'COMMENT_LIKE', id: 'spam' }, '/posts/public/')
	assert.ok(spam.body.code)
	const main = await call({ event: 'COMMENT_LIKE', id: 'hidden' })
	assert.ok(!main.body.code, JSON.stringify(main))
	console.log(
		'Local workerd HTTP: owner lookup/missing/spam, secret, absent/empty/filtered recent comments, guest like/reject, main like: passed'
	)
} catch (e) {
	console.error(logs.slice(-6000))
	throw e
} finally {
	if (server) {
		server.kill('SIGTERM')
		await new Promise((r) => server.once('exit', r))
	}
	rmSync(tmp, { recursive: true, force: true })
}
