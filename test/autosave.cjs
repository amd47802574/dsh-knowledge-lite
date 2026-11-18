// Functional test for the auto-save state machine extracted from lib/client.js
'use strict'
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'lib', 'client.js')
const src = fs.readFileSync(FILE, 'utf8')
const start = src.indexOf('/* autosave:begin')
const end = src.indexOf('/* autosave:end')
if (start === -1 || end === -1) { console.log('FAIL  autosave markers not found'); process.exit(1) }
const seg = src.slice(src.indexOf('*/', start) + 2, src.lastIndexOf('/*', end))

let failures = 0
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures += 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function makeEnv(rpcImpl) {
  const calls = []
  const S = { current: null, dirty: false, saving: false, error: '', status: '', subs: new Set() }
  const api = new Function('S', 'rpc', 'emit', 'reloadList', 'reloadTags', `
    ${seg}
    return { saveNote, flushSave, markDirty, markClean, scheduleSave, snapshotOf, getDirty: () => dirtySince }
  `)
  const bound = api(
    S,
    async (method, args) => { calls.push({ method, args }); return rpcImpl(method, args) },
    () => {},
    async () => [],
    async () => []
  )
  return { S, calls, ...bound }
}

async function main() {
  // ------------------------------------------------------------- test 1: clean no-op
  {
    const env = await makeEnv(async () => { throw new Error('should not be called') })
    env.S.current = { id: 'a1', title: 't', body: 'b', tags: [], files: [] }
    env.markClean()
    await env.flushSave()
    ok(env.calls.length === 0, 'clean flush is a no-op (no rpc)')
  }

  // ------------------------------------------------------------- test 2: dirty flush saves once
  {
    const env = await makeEnv(async (method, args) => ({ id: args.id, title: args.title }))
    env.S.current = { id: 'a1', title: 't', body: 'b', tags: [], files: [] }
    env.markClean()
    env.S.current.body = 'edited'
    env.markDirty()
    await env.flushSave()
    ok(env.calls.length === 1 && env.calls[0].method === 'save', 'dirty flush calls save once')
    ok(env.calls[0].args.body === 'edited', 'rpc carries the edited body')
    ok(env.S.dirty === false, 'dirty flag cleared after save')
    await env.flushSave()
    ok(env.calls.length === 1, 'second flush skipped (snapshot matches)')
  }

  // ------------------------------------------------------------- test 3: new note gets id
  {
    const env = await makeEnv(async () => ({ id: 'NEW-ID' }))
    env.S.current = { id: '', title: 'hello', body: 'x', tags: [], files: [] }
    env.markClean()
    env.S.current.body = 'y'
    env.markDirty()
    await env.flushSave()
    ok(env.calls.length === 1, 'new note saved')
    ok(env.S.current.id === 'NEW-ID', 'server-assigned id merged into S.current')
    ok(env.calls[0].args.id === undefined, 'create save sends no id')
  }

  // ------------------------------------------------------------- test 4: mid-flight edits survive
  {
    let resolveFirst
    let rpcCount = 0
    const env = await makeEnv(() => {
      rpcCount += 1
      // first call hangs until the test resolves it; later calls succeed at once
      return rpcCount === 1
        ? new Promise((resolve) => { resolveFirst = resolve })
        : Promise.resolve({ id: 'a1' })
    })
    env.S.current = { id: 'a1', title: 't', body: 'v1', tags: [], files: [] }
    env.markClean()
    env.S.current.body = 'v2'
    env.markDirty()
    const p = env.flushSave()          // starts save, rpc pending
    await sleep(30)                    // let saveNote capture cur=v2 and enter rpc
    // mimic touch(): every edit REPLACES the S.current object (never mutates)
    env.S.current = { ...env.S.current, body: 'v3' }
    env.markDirty()
    resolveFirst({ id: 'a1' })         // server acks v2
    await p
    ok(env.S.current.body === 'v3', 'mid-flight edit kept (not reverted to v2)')
    ok(env.S.dirty === true, 'still dirty after mid-flight edit')
    ok(env.calls.length === 1, 'one rpc so far')
    await sleep(700)                   // trailing 400ms flush fires
    ok(env.calls.length === 2, 'trailing flush saved the mid-flight edit')
    ok(env.calls[1].args.body === 'v3', 'trailing rpc carries v3')
    ok(env.S.dirty === false, 'converged clean')
  }

  // ------------------------------------------------------------- test 5: queued manual save
  {
    let resolveFirst
    let rpcCount = 0
    const env = await makeEnv(() => {
      rpcCount += 1
      return rpcCount === 1
        ? new Promise((resolve) => { resolveFirst = resolve })
        : Promise.resolve({ id: 'a1' })
    })
    env.S.current = { id: 'a1', title: 't', body: 'v1', tags: [], files: [] }
    env.markClean()
    env.S.current.body = 'v2'
    env.markDirty()
    const p = env.flushSave()
    await sleep(30)
    env.saveNote({ manual: true })     // user hits Ctrl+S while autosave in flight
    resolveFirst({ id: 'a1' })
    await p
    await sleep(120)
    ok(env.calls.length === 2, 'queued save ran after in-flight completed')
    ok(env.S.status === '已保存', 'manual status text shown')
    ok(env.S.dirty === false, 'clean after queued save')
  }

  // ------------------------------------------------------------- test 6: failure retry, bounded
  {
    let n = 0
    const env = await makeEnv(async () => { n += 1; throw new Error('disk full') })
    env.S.current = { id: 'a1', title: 't', body: 'x', tags: [], files: [] }
    env.markClean()
    env.S.current.body = 'y'
    env.markDirty()
    await env.flushSave()
    ok(n === 1 && env.S.error.includes('保存失败'), 'save failure surfaces error')
    ok(env.S.dirty === true, 'still dirty after failure')
    await sleep(5300)                  // 5s quiet retry
    ok(n === 2, 'quiet retry fired after 5s')
    await sleep(5300)
    ok(n === 3, 'second retry fired')
    await sleep(5300)
    ok(n === 3, 'retries stop after 3 attempts (no infinite loop)')
  }

  // ------------------------------------------------------------- test 7: snapshot skip in autosave path
  {
    const env = await makeEnv(async () => ({ id: 'a1' }))
    env.S.current = { id: 'a1', title: 't', body: 'same', tags: [], files: [] }
    env.markClean()
    env.markDirty()                    // dirty flag without real change
    await env.saveNote()
    ok(env.calls.length === 0, 'autosave skips when snapshot unchanged')
    ok(env.S.dirty === false, 'dirty cleared on snapshot match')
  }

  console.log(failures === 0 ? '\nALL AUTOSAVE TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
