/**
 * Workflow presets for DeepSeek Harness.
 *
 * One workflow is active per session (durably selected with `/workflow <id>`).
 * A workflow bundles:
 *  - skill tiers: a per-agent skill provider that rewrites descriptions and can
 *    make a skill user-only (`hidden`) or one-line (`compact`);
 *  - global tool gating: `tools.restrict` for tools registered at the Host;
 *  - persona: a dynamic system-prompt section;
 *  - a prompt template, an optional model and an optional permission preset.
 *
 * `/workflow status` and `/workflow check` return JSON for the Web UI; `/enhance`
 * rewrites a draft with the model.
 */
import { appendFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const inject = ['skills', 'tools', 'commands', 'agents', 'systemPrompt', 'llm']

const DEFAULT_POLICY = '{}'
const ENTRY_ID = 'dsh-workflows'
const DEBUG_LOG = join(homedir(), '.dsh', 'dsh-workflows.log')
const MAX_INPUT = 6000

function dbg(line) {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics are best effort */
  }
}

export const Config = Schema.object({
  policy: Schema.string()
    .default(DEFAULT_POLICY)
    .description('Workflow policy JSON: workflows, skill tiers, personas, templates.')
    .volatile(),
})

/* ------------------------------------------------------------------ policy */

function parseJson(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_POLICY)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeWorkflow(row) {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' && row.name !== '' ? row.name : String(row.id),
    description: typeof row.description === 'string' ? row.description : '',
    persona: typeof row.persona === 'string' ? row.persona : '',
    template: typeof row.template === 'string' ? row.template : '',
    tiers: row.tiers !== null && typeof row.tiers === 'object' && !Array.isArray(row.tiers) ? row.tiers : {},
    hiddenPrefixes: Array.isArray(row.hiddenPrefixes) ? row.hiddenPrefixes.filter((value) => typeof value === 'string') : [],
    deniedGlobalTools: Array.isArray(row.deniedGlobalTools)
      ? row.deniedGlobalTools.filter((value) => typeof value === 'string')
      : [],
    permission: typeof row.permission === 'string' ? row.permission : '',
    model:
      row.model !== null && typeof row.model === 'object' && typeof row.model.model === 'string'
        ? {
            provider: typeof row.model.provider === 'string' ? row.model.provider : '',
            model: row.model.model,
            ...(typeof row.model.effort === 'string' ? { effort: row.model.effort } : {}),
          }
        : null,
  }
}

function normalizePolicy(raw) {
  const source = parseJson(raw)
  const workflows =
    Array.isArray(source.workflows) && source.workflows.length > 0
      ? source.workflows.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string').map(normalizeWorkflow)
      : [{ id: 'general', name: '通用', tiers: {} }].map(normalizeWorkflow)
  const ids = new Set(workflows.map((row) => row.id))
  const fallback = workflows[0].id
  return {
    ...source,
    workflows,
    defaultWorkflow: ids.has(source.defaultWorkflow) ? source.defaultWorkflow : fallback,
  }
}

/* -------------------------------------------------------------- skill scan */

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end < 0) return {}
  const meta = {}
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    meta[match[1]] = value
  }
  return meta
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  const after = text.indexOf('\n', end + 4)
  return after < 0 ? '' : text.slice(after + 1)
}

function skillRoots() {
  return [
    join(process.cwd(), '.dsh', 'skills'),
    join(process.cwd(), '.agents', 'skills'),
    join(homedir(), '.dsh', 'skills'),
    join(homedir(), '.agents', 'skills'),
  ]
}

function createScanner() {
  let cached
  let cachedAt = 0
  return async function scan() {
    if (cached && Date.now() - cachedAt < 3000) return cached
    const byName = new Map()
    for (const root of skillRoots()) {
      let entries
      try {
        entries = await readdir(root)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const target = join(root, entry)
        let info
        try {
          info = await stat(target)
        } catch {
          continue
        }
        let file
        if (info.isDirectory()) file = join(target, 'SKILL.md')
        else if (info.isFile() && entry.endsWith('.md')) file = target
        if (file === undefined) continue
        let text
        try {
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        const meta = parseFrontmatter(text)
        const name = meta.name ?? (info.isFile() ? entry.slice(0, -3) : entry)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue
        if (byName.has(name)) continue
        byName.set(name, {
          name,
          description: meta.description ?? '',
          whenToUse: meta.whenToUse,
          file,
          dir: dirname(file),
        })
      }
    }
    cached = byName
    cachedAt = Date.now()
    return byName
  }
}

/* ------------------------------------------------------------------ plugin */

export function apply(ctx, config) {
  const readLivePolicy = () => normalizePolicy(typeof config?.policy?.get === 'function' ? config.policy.get() : config?.policy)
  let policy = readLivePolicy()
  const scan = createScanner()
  const installed = new Map()
  const sessionWorkflow = new Map()
  const generation = Math.random().toString(36).slice(2, 8)
  // Unique per install: a leaked registration can never collide with a fresh one.
  let installSeq = 0

  function workflowById(id) {
    return policy.workflows.find((row) => row.id === id)
  }

  function workflowFor(agent) {
    const key = String(agent.id)
    if (!sessionWorkflow.has(key)) {
      let current = policy.defaultWorkflow
      try {
        for (const event of agent.session?.ownEvents?.() ?? []) {
          if (event.type !== 'command/run' || event.data?.name !== 'workflow') continue
          const arg = String(event.data.args ?? '').trim()
          if (arg !== '' && workflowById(arg) !== undefined) current = arg
        }
      } catch {
        /* a detached session keeps the default */
      }
      sessionWorkflow.set(key, current)
    }
    return workflowById(sessionWorkflow.get(key)) ?? workflowById(policy.defaultWorkflow)
  }

  function tierFor(workflow, name) {
    const tiers = workflow?.tiers ?? {}
    const explicit = tiers[name]
    if (explicit === 'compact' || explicit === 'hidden' || explicit === 'full') return explicit
    const hidden = workflow?.hiddenPrefixes ?? []
    if (hidden.some((prefix) => name.startsWith(prefix))) return 'hidden'
    const fallback = tiers['*'] ?? 'full'
    return fallback === 'compact' || fallback === 'hidden' ? fallback : 'full'
  }

  function compactDescription(workflow, skill) {
    const first = (skill.description || skill.name).split(/[。.!?；;]/)[0] || skill.name
    // The registry rejects an empty description as fatal, so never return whitespace.
    return first.slice(0, 60).trim() || skill.name
  }

  async function load(candidate) {
    const path = candidate.locator?.path
    if (typeof path !== 'string') return undefined
    const text = await readFile(path, 'utf8')
    return {
      name: candidate.name,
      description: candidate.description,
      ...(candidate.whenToUse === undefined ? {} : { whenToUse: candidate.whenToUse }),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: candidate.provider,
      path,
      resourceBase: candidate.resourceBase,
      content: stripFrontmatter(text),
    }
  }

  function removeAgent(id) {
    const entry = installed.get(id)
    if (entry === undefined) return
    installed.delete(id)
    // `ctx.inject()` yields a Fiber (a thenable), not a disposer — release it directly.
    const fiber = entry.fiber
    if (fiber !== undefined && fiber !== null && typeof fiber.dispose === 'function') {
      try {
        const pending = fiber.dispose()
        if (pending !== null && typeof pending?.catch === 'function') pending.catch(() => {})
      } catch (error) {
        dbg(`dispose failed ${id}: ${error?.message ?? error}`)
      }
    }
    try {
      const pending = entry.release?.()
      if (pending !== null && typeof pending?.catch === 'function') pending.catch(() => {})
    } catch {
      /* the plugin effect cleanup already ran */
    }
  }

  function installAgent(agent) {
    if (agent === undefined || agent === null || agent.ctx === undefined) return
    const id = String(agent.id)
    removeAgent(id)
    const workflow = workflowFor(agent)
    const tag = `${generation}-${++installSeq}`
    // The skill registry hard-validates `candidate.provider === provider.name`, so every
    // candidate must carry the exact registered (per-install unique) name. Returning the
    // bare plugin id here throws `... returned skill "x" for provider "dsh-workflows"`
    // and aborts the whole turn during catalog collection.
    const providerName = `dsh-workflows-${tag}-${id}`
    let fiber
    try {
      fiber = agent.ctx.inject(['skills', 'tools', 'systemPrompt'], (sctx) => {
        const offs = []
        try {
          offs.push(
            sctx.skills.registerProvider(() => ({
              name: providerName,
              list: async () => {
                const active = workflowFor(agent)
                const catalog = await scan()
                const candidates = []
                for (const skill of catalog.values()) {
                  const tier = tierFor(active, skill.name)
                  if (tier === 'full') continue
                  candidates.push({
                    name: skill.name,
                    description: tier === 'hidden' ? String(skill.description ?? '').trim() || skill.name : compactDescription(active, skill),
                    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
                    invocation: { modelInvocable: tier !== 'hidden', userInvocable: true },
                    source: 'custom',
                    provider: providerName,
                    rank: 0,
                    path: skill.file,
                    resourceBase: { kind: 'directory', path: skill.dir },
                    locator: { path: skill.file },
                  })
                }
                return { candidates, complete: true }
              },
              get: async (candidate) => await load(candidate),
            })),
          )
        } catch (error) {
          dbg(`registerProvider failed ${id}: ${error?.message ?? error}`)
        }
        const deny = Array.isArray(workflow.deniedGlobalTools) ? workflow.deniedGlobalTools : []
        if (deny.length > 0) {
          try {
            offs.push(sctx.tools.restrict({ deny }))
          } catch (error) {
            dbg(`restrict failed ${id}: ${error?.message ?? error}`)
          }
        }
        if (typeof workflow.persona === 'string' && workflow.persona.trim() !== '') {
          try {
            offs.push(
              sctx.systemPrompt.section({
                name: `dsh-workflows-persona-${tag}-${id}`,
                order: 900,
                text: () => workflowFor(agent).persona ?? '',
              }),
            )
          } catch (error) {
            dbg(`persona failed ${id}: ${error?.message ?? error}`)
          }
        }
        dbg(`installed ${id} workflow=${workflow.id} generation=${tag}`)
        return () => {
          for (const off of offs.reverse()) {
            try {
              off()
            } catch {
              /* already disposed */
            }
          }
        }
      })
    } catch (error) {
      dbg(`inject failed ${id}: ${error?.message ?? error}`)
      return
    }
    // The effect must return a *function* disposer. Returning the fiber itself makes
    // cordis treat it as a thenable and reject with `TypeError: Invalid effect`,
    // which escapes as a fatal host load failure.
    let release
    try {
      release = ctx.effect(() => () => {
        if (typeof fiber.dispose !== 'function') return
        return fiber.dispose()
      })
    } catch (error) {
      dbg(`effect failed ${id}: ${error?.message ?? error}`)
      return
    }
    installed.set(id, { agent, fiber, release })
  }

  function reinstallAll() {
    for (const entry of [...installed.values()]) installAgent(entry.agent)
  }

  function applyPermission(agent, workflow) {
    if (typeof workflow.permission !== 'string' || workflow.permission === '') return { applied: false }
    const presets = ctx.get('permissionPresets')
    if (presets === undefined) return { applied: false, reason: 'no-permission-service' }
    try {
      presets.set(agent.session, workflow.permission)
      return { applied: true }
    } catch (error) {
      dbg(`permission failed ${agent?.id}: ${error?.message ?? error}`)
      return { applied: false, reason: String(error?.message ?? error) }
    }
  }

  async function audit(agent) {
    const scope = agent?.scope
    let skills = []
    try {
      skills = await ctx.skills.list({ scope })
    } catch (error) {
      dbg(`audit skills failed: ${error?.message ?? error}`)
    }
    let tools = []
    try {
      tools = [...ctx.tools.definitions(scope)]
    } catch (error) {
      dbg(`audit tools failed: ${error?.message ?? error}`)
    }
    const workflow = workflowFor(agent)
    const counts = { full: 0, compact: 0, hidden: 0 }
    for (const skill of skills) counts[tierFor(workflow, skill.name)] += 1
    return {
      workflow: workflow.id,
      workflowName: workflow.name,
      workflows: policy.workflows.length,
      skills: {
        total: skills.length,
        modelVisible: skills.filter((skill) => skill.invocation?.modelInvocable !== false).length,
        ...counts,
      },
      tools: tools.length,
      mcp: tools.filter((tool) => String(tool.name).startsWith('mcp__')).map((tool) => tool.name),
      deniedGlobalTools: workflow.deniedGlobalTools ?? [],
      templateLength: workflow.template?.length ?? 0,
    }
  }

  /* -------------------------------------------------------------- commands */

  ctx.commands.register({
    name: 'workflow',
    description: '切换本会话的工作流（技能分级、工具、人格、预设模板），或查看状态。',
    input: { hint: '<id | status | check | 留空查看>' },
    handler: async (invocation) => {
      const arg = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
      const agent = invocation.agent
      if (arg === 'check') {
        try {
          return { kind: 'success', text: JSON.stringify(await audit(agent)) }
        } catch (error) {
          return { kind: 'error', text: `检查失败：${error?.message ?? error}` }
        }
      }
      if (arg === 'status') {
        const current = workflowFor(agent)
        return {
          kind: 'success',
          text: JSON.stringify({ id: current.id, name: current.name, template: current.template ?? '' }),
        }
      }
      if (arg.startsWith('crash ')) {
        try {
          dbg(`client crash: ${decodeURIComponent(arg.slice(6))}`)
        } catch {
          dbg(`client crash (undecodable): ${arg.slice(0, 200)}`)
        }
        return { kind: 'success', text: 'crash report recorded' }
      }
      if (arg === '') {
        const current = workflowFor(agent)
        const rows = policy.workflows.map(
          (row) => `${row.id === current.id ? '*' : ' '} ${row.id} — ${row.name}${row.description ? `（${row.description}）` : ''}`,
        )
        return { kind: 'success', text: `当前工作流：${current.name}\n${rows.join('\n')}` }
      }
      const workflow = workflowById(arg)
      if (workflow === undefined) {
        return { kind: 'error', text: `未知工作流 "${arg}"。可选：${policy.workflows.map((row) => row.id).join('、')}` }
      }
      sessionWorkflow.set(String(agent.id), workflow.id)
      installAgent(agent)
      const permission = applyPermission(agent, workflow)
      return {
        kind: 'success',
        text: `工作流已切换：${workflow.name}${permission.applied ? `（审查=${workflow.permission}）` : ''}`,
      }
    },
  })

  const SYSTEM_PROMPT = [
    'You are a prompt editor for a coding agent. Rewrite the user prompt so the agent can act on it.',
    'Keep every fact, constraint, name and intention from the original. Do not invent facts, files, paths, tools, names or examples.',
    'Remove filler and ambiguity. Turn vague wishes into explicit requirements. Keep the original language; Chinese stays Chinese.',
    'Use short Markdown sections only when they help: goal, context, requirements, constraints, output format, acceptance checks.',
    'When the original lacks information, add one short "待补充 / open questions" list naming exactly what is missing instead of guessing.',
    'Return only the rewritten prompt. No preface, no explanation, no wrapping code fence.',
  ].join('\n')

  function pickRoute() {
    const providers = ctx.llm.listProviders()
    if (providers.length === 0) throw new Error('没有可用的模型路由')
    return (
      providers.find((row) => String(row.id).includes('deepseek')) ?? providers[0]
    )
  }

  async function rewrite(text, signal) {
    const provider = pickRoute()
    const models = await ctx.llm.listModels(provider.id)
    if (models.length === 0) throw new Error(`模型路由 ${provider.id} 没有可用模型`)
    const model = models.find((row) => String(row.id).includes('flash'))?.id ?? models[0].id
    let out = ''
    let finish
    for await (const chunk of ctx.llm.stream({
      provider: provider.id,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      temperature: 0.3,
      maxTokens: 1200,
      signal,
    })) {
      if (chunk.type === 'text-delta') out += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish === undefined) throw new Error('模型流没有结束标记')
    if (finish.kind !== 'stop') throw new Error(`模型流以 ${finish.kind} 结束`)
    const trimmed = out.trim()
    if (trimmed === '') throw new Error('模型返回了空内容')
    return { text: trimmed, route: `${provider.id}/${model}` }
  }

  ctx.commands.register({
    name: 'enhance',
    description: '用模型把这段文字改写为更清晰、可执行的提示词。',
    input: { hint: '<要改写的草稿文本>' },
    recordInput: false,
    handler: async (invocation) => {
      const text = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
      if (text === '') return { kind: 'error', text: '没有可改写的内容' }
      if (text.length > MAX_INPUT) return { kind: 'error', text: `内容过长（上限 ${MAX_INPUT} 字符）` }
      try {
        const result = await rewrite(text, invocation.signal)
        dbg(`enhance ok route=${result.route} in=${text.length} out=${result.text.length}`)
        return { kind: 'success', text: result.text }
      } catch (error) {
        dbg(`enhance failed: ${error?.message ?? error}`)
        return { kind: 'error', text: `改写失败：${error?.message ?? error}` }
      }
    },
  })

  /* ---------------------------------------------------------------- events */

  for (const agent of ctx.agents.list()) installAgent(agent)
  ctx.on('agent/created', (payload) => {
    installAgent(payload?.agent)
  })
  ctx.on('agent/disposed', (payload) => {
    if (payload?.agent !== undefined) {
      const id = String(payload.agent.id)
      removeAgent(id)
      sessionWorkflow.delete(id)
    }
  })
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'command/run' || event.data?.name !== 'workflow') return
    const key = String(session.id)
    const next = String(event.data.args ?? '').trim()
    if (next === '' || next === 'status' || next === 'check' || next.startsWith('crash ')) return
    if (workflowById(next) === undefined) return
    if (sessionWorkflow.get(key) === next) return
    sessionWorkflow.set(key, next)
    const agent = ctx.agents.get(session.id)
    if (agent !== undefined) installAgent(agent)
  })
  ctx.on('settings/document-updated', (ns, revision) => {
    dbg(`settings/document-updated ns=${ns} revision=${revision}`)
    if (ns !== ENTRY_ID) return
    const next = readLivePolicy()
    if (JSON.stringify(next) === JSON.stringify(policy)) return
    policy = next
    reinstallAll()
  })

  dbg(`apply workflows=${policy.workflows.length} default=${policy.defaultWorkflow}`)
}
