// Functional test for the markdown renderer extracted from lib/client.js
'use strict'
const fs = require('fs')
const path = require('path')

const CLIENT = path.join(__dirname, '..', 'lib', 'client.js')
const src = fs.readFileSync(CLIENT, 'utf8')
// markers carry alignment spaces, so locate by keyword instead of exact match
const segStart = src.indexOf('*/', src.indexOf('md:begin')) + 2
const segEnd = src.lastIndexOf('/*', src.indexOf('md:end'))
const seg = src.slice(segStart, segEnd)

// React stub: elements become plain objects so the tree is inspectable
const h = (type, props, ...kids) => ({
  t: type,
  p: props || {},
  k: kids.filter((x) => x !== null && x !== undefined && x !== false && x !== '')
})
const React = { useMemo: (fn) => fn() }

const factory = new Function('h', 'React', `${seg}; return { mdBlocks, mdInline, MarkdownView, mdSplitRow, mdIsTableSep }`)
const md = factory(h, React)

let failures = 0
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures += 1
}
const types = (nodes) => nodes.map((n) => (typeof n === 'string' ? `"${n}"` : n.t))
const walk = (nodes, fn) => {
  for (const n of nodes) {
    fn(n)
    if (n && typeof n === 'object') walk(n.k ?? [], fn)
  }
}

// ---------------------------------------------------------------- sample doc
const doc = [
  '# 主标题',
  '',
  '第一段，含 **加粗**、*斜体*、~~删除~~、`code span`、[链接](https://example.com) 和 https://auto.link/path。',
  '第二行用 br 连接。',
  '',
  '## 列表',
  '',
  '- 项目一',
  '- 项目二',
  '  - 嵌套 1.1',
  '  - 嵌套 1.2',
  '- [ ] 待办事项',
  '- [x] 已完成',
  '',
  '1. 第一',
  '2. 第二',
  '',
  '> 引用第一行',
  '> 引用第二行',
  '',
  '```js',
  'const a = 1 // <script>alert(1)</script>',
  '```',
  '',
  '| 列A | 列B | 列C |',
  '| --- | :--: | --: |',
  '| a1 | a2 | a3 |',
  '',
  '---',
  '',
  '普通文本 <b>不解析HTML</b> & <img src=x onerror=alert(1)>'
].join('\n')

const nodes = md.mdBlocks(doc.split('\n'), 't')

const flat = []
walk(nodes, (n) => { if (n && typeof n === 'object') flat.push(n) })

ok(types(nodes).includes('h1'), 'h1 heading parsed')
ok(types(nodes).includes('h2'), 'h2 heading parsed')
ok(types(nodes).includes('p'), 'paragraph parsed')
ok(types(nodes).includes('ul'), 'unordered list parsed')
ok(types(nodes).includes('ol'), 'ordered list parsed')
ok(types(nodes).includes('blockquote'), 'blockquote parsed')
ok(types(nodes).includes('pre'), 'fenced code parsed')
ok(types(nodes).includes('table'), 'table parsed')
ok(types(nodes).includes('hr'), 'hr parsed')

const ul = nodes.find((n) => n.t === 'ul')
ok(ul.k.filter((x) => x.t === 'li').length === 4, 'ul has 4 top-level items')
const nestedLi = ul.k[1]
ok((nestedLi.k ?? []).some((x) => x.t === 'ul'), 'nested list inside item 2')
const taskLi = ul.k[2]
ok((taskLi.k ?? []).some((x) => x.t === 'input' && x.p.type === 'checkbox' && x.p.checked === false), 'task [ ] checkbox unchecked')
const taskLi2 = ul.k[3]
ok((taskLi2.k ?? []).some((x) => x.t === 'input' && x.p.checked === true), 'task [x] checkbox checked')

const pre = nodes.find((n) => n.t === 'pre')
const preText = JSON.stringify(pre)
ok(preText.includes('<script>'), 'code block keeps <script> as raw TEXT (escaped via React)')
ok(!preText.includes('<b>'), 'no raw <b> element injected')

// HTML in body must never become an element — only text nodes
const allStrings = []
walk(nodes, (n) => { if (typeof n === 'string') allStrings.push(n) })
ok(!flat.some((n) => n.t === 'b' || n.t === 'img' || n.t === 'script'), 'no foreign HTML elements in tree')
ok(allStrings.some((s) => s.includes('<img src=x onerror=alert(1)>')), 'HTML stays as literal text')

// inline details
const p1 = nodes.find((n) => n.t === 'p')
const inlineTypes = []
walk(p1.k, (n) => { if (n && typeof n === 'object') inlineTypes.push(n.t) })
for (const t of ['strong', 'em', 'del', 'code', 'a', 'br']) {
  ok(inlineTypes.includes(t), `inline <${t}> rendered`)
}
const links = []
walk(p1.k, (n) => { if (n && typeof n === 'object' && n.t === 'a') links.push(n) })
ok(links.some((n) => n.p.href === 'https://example.com' && n.p.target === '_blank'), 'markdown link href/target')
ok(links.some((n) => n.p.href === 'https://auto.link/path'), 'autolink rendered')

// table alignment
const table = nodes.find((n) => n.t === 'table')
const ths = []
walk(table.k, (n) => { if (n && typeof n === 'object' && n.t === 'th') ths.push(n) })
ok(ths.length === 3, 'table has 3 header cells')
ok(ths[1].p.style.textAlign === 'center' && ths[2].p.style.textAlign === 'right', 'table column alignment')

// ------------------------------------------------------------ edge cases
// empty + whitespace-only
ok(md.mdBlocks(['', '   '], 'e').length === 0, 'blank-only doc → no nodes')

// bold not confused by bullets: "-5°C" is not a list
const neg = md.mdBlocks(['-5°C 今天很冷'], 'x')
ok(neg[0].t === 'p' && JSON.stringify(neg).includes('-5°C'), 'leading "-5" stays paragraph text')

// ordered marker "2024." at line start is a list item (standard behavior)
const yr = md.mdBlocks(['2024. 年度总结'], 'y')
ok(yr[0].t === 'ol', '"2024." parses as ordered list (standard markdown)')

// snake_case / __init__ untouched (underscore emphasis intentionally unsupported)
const snake = md.mdBlocks(['call __init__ and my_var_name here'], 's')
ok(JSON.stringify(snake).includes('__init__') && !snake.some((n) => n.t === 'strong'), 'underscores stay literal')

// stray/unpaired markers stay literal
const stray = md.mdBlocks(['a * b ** c ~~ d ` e'], 'z')
ok(stray[0].t === 'p' && !JSON.stringify(stray).includes('"em"'), 'unpaired markers stay literal')

// unclosed fence swallows to EOF without throwing
const unclosed = md.mdBlocks(['```js', 'const x = 1'], 'u')
ok(unclosed[0].t === 'pre', 'unclosed fence → still a code block, no crash')

// deep nesting 3 levels
const deep = md.mdBlocks(['- a', '  - b', '    - c'], 'd')
let depth = 0
{
  let cur = deep[0]
  while (cur && cur.t === 'ul') { depth += 1; cur = (cur.k[0].k ?? []).find((x) => x.t === 'ul') }
}
ok(depth === 3, 'three-level nested list')

// CRLF input
const crlf = md.mdBlocks('# 标题\r\n\r\n正文\r\n'.replace(/\r\n/g, '\n').split('\n'), 'w')
ok(crlf.some((n) => n.t === 'h1'), 'CRLF-normalized input works')

// MarkdownView wrapper
const mv = md.MarkdownView({ body: '# hi' })
ok(mv.t === 'div' && String(mv.p.className).includes('kb-md'), 'MarkdownView wraps in .kb-md div')
const mvClass = md.MarkdownView({ body: 'x', className: 'kb-tail-md' })
ok(String(mvClass.p.className).includes('kb-tail-md'), 'MarkdownView merges extra className')

// perf sanity: 200KB doc parses fast
const big = ('# 标题\n\n正文 **加粗** [链接](https://e.com) 内容行。\n\n- 列表项 **粗**\n').repeat(2500)
const t0 = Date.now()
md.mdBlocks(big.split('\n'), 'big')
const dt = Date.now() - t0
ok(dt < 3000, `200KB doc parsed in ${dt}ms (<3s)`)

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
