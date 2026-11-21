window.__ModuleLoader__.load({
  id: 'dsh-workflow-presets',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ENTRY = 'dsh-workflows'
    const TAB_KIND = 'dsh-workflows-assistant'
    const TAB_ID = 'dsh-workflows/assistant'

    let pluginCtx

    /* ------------------------------------------------------------ utilities */
    function t(zhText) {
      return zhText
    }
    function clone(value) {
      return JSON.parse(JSON.stringify(value))
    }
    function parsePolicyText(text) {
      try {
        const parsed = JSON.parse(text)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    }
    function tiersToText(tiers) {
      return Object.entries(tiers ?? {})
        .map(([name, tier]) => `${name}=${tier}`)
        .join('\n')
    }
    function textToTiers(text) {
      const tiers = {}
      for (const line of String(text).split(/\r?\n/)) {
        const match = /^([a-z0-9][a-z0-9-]*)\s*=\s*(full|compact|hidden)\s*$/.exec(line.trim())
        if (match !== null) tiers[match[1]] = match[2]
      }
      return tiers
    }
    function commaToArray(text) {
      return String(text)
        .split(/[,，\s]+/)
        .map((part) => part.trim())
        .filter((part) => part !== '')
    }
    function arrayToText(values) {
      return (values ?? []).join(', ')
    }

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 24px', height: '100%', overflow: 'auto', fontSize: 13 },
      row: { display: 'flex', gap: 10, alignItems: 'center' },
      col: { display: 'flex', flexDirection: 'column', gap: 10 },
      card: { border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)', borderRadius: 12, padding: '12px 14px', background: 'var(--dsw-alias-bg-secondary, rgba(0,0,0,0.02))' },
      label: { display: 'block', fontSize: 11, opacity: 0.65, marginBottom: 4 },
      input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, borderRadius: 8, border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)', background: 'transparent', color: 'inherit' },
      textarea: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12, lineHeight: 1.55, borderRadius: 8, border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)', background: 'transparent', color: 'inherit', resize: 'vertical', fontFamily: 'inherit' },
      btn: { padding: '4px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      btnOn: { padding: '4px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--dsw-alias-border-strong, #b8c2cc)', background: 'var(--dsw-alias-bg-selected, #e8f0fe)', color: 'inherit', cursor: 'pointer' },
      h1: { fontSize: 16, fontWeight: 600, margin: 0 },
      h2: { fontSize: 13, fontWeight: 600, margin: '0 0 6px' },
      small: { fontSize: 11, opacity: 0.65, lineHeight: 1.5 },
      listItem: (active) => ({ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: active ? 'var(--dsw-alias-bg-selected, #e8f0fe)' : 'transparent', border: '1px solid transparent' }),
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
      grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 },
      pre: { margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap', borderRadius: 8, border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)', background: 'var(--dsw-alias-bg-secondary, rgba(0,0,0,0.03))', maxHeight: 220, overflow: 'auto' },
    }

    /* --------------------------------------------------------------- store */
    function readApplyTemplate() {
      try {
        return localStorage.getItem('dsh.workflows.applyTemplate') !== '0'
      } catch {
        return true
      }
    }
    function writeApplyTemplate(value) {
      try {
        localStorage.setItem('dsh.workflows.applyTemplate', value ? '1' : '0')
      } catch {
        /* storage is optional */
      }
    }
    const store = { pendingText: '', focus: 'workflow', applyTemplate: readApplyTemplate(), statusBySession: {}, listeners: new Set() }
    function patchStore(next) {
      Object.assign(store, next)
      for (const listener of store.listeners) listener()
    }
    function useStoreValue() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((value) => value + 1)
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      }, [])
      return store
    }

    /* ---------------------------------------------------------------- data */
    function diag(key, value) {
      try {
        localStorage.setItem(`dsh.workflows.diag.${key}`, JSON.stringify(value))
      } catch {
        /* diagnostics are best effort */
      }
    }
    let formCache = null
    function configFormsService() {
      const injected = pluginCtx?.configForms
      if (injected !== undefined) return injected
      try {
        return pluginCtx?.get?.('configForms')
      } catch {
        return undefined
      }
    }
    // The settings service registers after this plugin applies, so every lookup
    // retries instead of caching the first (empty) answer.
    function formFor() {
      if (formCache !== null) return formCache
      const forms = configFormsService()
      if (forms === undefined) return null
      try {
        formCache = forms.get(ENTRY)
      } catch {
        return null
      }
      return formCache
    }
    function useForm() {
      const [snapshot, setSnapshot] = React.useState({ status: 'idle' })
      React.useEffect(() => {
        let alive = true
        let timer
        let off
        const attach = () => {
          if (!alive) return
          const form = formFor()
          if (form === null) {
            diag('form', { status: 'no-configForms', ts: Date.now() })
            timer = setTimeout(attach, 500)
            return
          }
          const read = () => {
            const next = form.getSnapshot()
            diag('form', { status: next.status, writable: next.writable, revision: next.revision, ts: Date.now() })
            if (alive) setSnapshot(next)
          }
          off = form.subscribe(read)
          read()
        }
        attach()
        return () => {
          alive = false
          clearTimeout(timer)
          if (typeof off === 'function') off()
        }
      }, [])
      return snapshot
    }

    function useSkills(sessionId) {
      const [state, setState] = React.useState({ status: 'idle', skills: [] })
      React.useEffect(() => {
        if (sessionId === undefined || pluginCtx === undefined) {
          setState({ status: 'unavailable', skills: [] })
          return undefined
        }
        let alive = true
        setState({ status: 'loading', skills: [] })
        pluginCtx.remote.skills
          .list({ sessionId })
          .then((result) => {
            if (!alive) return
            if (result.ok !== true) {
              setState({ status: 'error', skills: [], error: result.error?.code ?? 'failed' })
            } else {
              setState({ status: 'ready', skills: [...(result.value?.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name)) })
            }
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', skills: [], error: String(error?.message ?? error) })
          })
        return () => {
          alive = false
        }
      }, [sessionId])
      return state
    }

    function policyOf(snapshot) {
      const text = typeof snapshot.value?.policy === 'string' ? snapshot.value.policy : '{}'
      return parsePolicyText(text)
    }

    async function writePolicy(target, nextPolicy) {
      // Callers pass the form snapshot; the writable controller is the only
      // object with `set`. Resolving here keeps every save path working.
      const form = target !== null && typeof target?.set === 'function' ? target : formFor()
      if (form === null || form === undefined) {
        diag('write', { ok: false, error: 'form unavailable', ts: Date.now() })
        return false
      }
      const payload = JSON.stringify(nextPolicy)
      try {
        let accepted = await form.set('policy', payload)
        if (accepted !== true) {
          // Every accepted edit bumps the entry revision, so the very next save
          // from a page that has not re-derived yet is refused once. The form
          // reloads its snapshot on failure; retry with that fresh revision.
          await new Promise((resolve) => setTimeout(resolve, 250))
          accepted = await form.set('policy', payload)
        }
        diag('write', { ok: accepted === true, len: payload.length, ts: Date.now() })
        return accepted === true
      } catch (error) {
        diag('write', { ok: false, error: String(error?.message ?? error), ts: Date.now() })
        return false
      }
    }

    async function execute(sessionId, line) {
      if (pluginCtx?.remote?.commands === undefined) return { ok: false, text: 'remote.commands 不可用' }
      try {
        const result = await pluginCtx.remote.commands.execute(sessionId, line, [])
        if (result.ok !== true) return { ok: false, text: `${result.error?.code ?? ''} ${result.error?.message ?? ''}` }
        if (result.value === undefined) return { ok: false, text: '命令未识别' }
        return { ok: result.value.result.kind === 'success', text: result.value.result.text ?? '' }
      } catch (error) {
        return { ok: false, text: String(error?.message ?? error) }
      }
    }

    /* ------------------------------------------------------ local enhancer */
    function enhanceLocal(text) {
      const raw = String(text).trim()
      if (raw === '') return ''
      const lines = raw.split(/\r?\n/)
      const requirements = []
      const constraints = []
      const formats = []
      const rest = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const bullet = /^(?:[-*]|\d+[.)、])\s*/.exec(trimmed)
        if (bullet !== null) {
          requirements.push(trimmed.slice(bullet[0].length))
          continue
        }
        if (/(不要|禁止|必须|只能|仅|务必|不得|不能|不超过|至少)/.test(trimmed)) {
          constraints.push(trimmed)
          continue
        }
        if (/(输出|格式|表格|JSON|Markdown|字数|字以内|列表|分点)/.test(trimmed)) {
          formats.push(trimmed)
          continue
        }
        rest.push(trimmed)
      }
      const sentences = raw.split(/[。.!?！？\n]/).map((part) => part.trim()).filter(Boolean)
      const goal = rest.shift() ?? sentences[0] ?? raw
      const sections = [`【目标】${goal}`]
      if (rest.length > 0) sections.push(`【背景】\n${rest.map((line) => `- ${line}`).join('\n')}`)
      sections.push(`【要求】\n${requirements.length > 0 ? requirements.map((line) => `- ${line}`).join('\n') : `- ${goal}`}`)
      sections.push(`【约束】\n${constraints.length > 0 ? constraints.map((line) => `- ${line}`).join('\n') : '- 未指定；请补充不能违反的条件'}`)
      sections.push(`【输出格式】\n${formats.length > 0 ? formats.map((line) => `- ${line}`).join('\n') : '- 未指定'}`)
      const questions = []
      if (formats.length === 0) questions.push('希望的输出格式与长度？')
      if (constraints.length === 0) questions.push('有哪些绝对不能做、必须满足的条件？')
      if (goal.length < 12) questions.push('验收标准是什么（怎样算做完）？')
      if (questions.length > 0) {
        sections.push(`【待补充】\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`)
      }
      return sections.join('\n\n')
    }

    /* ------------------------------------------------------------- boundary */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        const sessionId = this.props.sessionId
        if (sessionId === undefined || pluginCtx?.remote?.commands === undefined) return
        try {
          const payload = encodeURIComponent(JSON.stringify({ message: String(error?.message ?? error), stack: String(error?.stack ?? '') }))
          void pluginCtx.remote.commands.execute(sessionId, `/workflow crash ${payload}`, [])
        } catch {
          /* diagnostics never rethrow */
        }
      }
      render() {
        if (this.state.error !== null) {
          return h('div', { style: { ...S.card, color: 'var(--dsw-alias-text-danger, #b42318)' } }, `${t('界面渲染失败', 'Render failed')}：${String(this.state.error?.message ?? this.state.error)}`)
        }
        return this.props.children
      }
    }

    /* ---------------------------------------------------------------- icons */
    function WorkflowsIcon(props) {
      const size = props?.size ?? 16
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 6h7M4 12h10M4 18h6' }),
        h('path', { d: 'M16 6l3 3-3 3M19 12l-3 3 3 3' }),
      )
    }

    function PromptsIcon(props) {
      const size = props?.size ?? 16
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' }),
        h('circle', { cx: 18.5, cy: 17.5, r: 1.8 }),
      )
    }

    /* ------------------------------------------------------- workflows page */
    function WorkflowsPage() {
      const form = useForm()
      const policy = policyOf(form)
      const [selectedId, setSelectedId] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [confirmDelete, setConfirmDelete] = React.useState(false)

      React.useEffect(() => {
        if (policy === null || draft !== null) return
        const id = selectedId ?? policy.defaultWorkflow
        const workflow = (policy.workflows ?? []).find((row) => row.id === id) ?? policy.workflows?.[0]
        if (workflow) {
          setSelectedId(workflow.id)
          setDraft(clone(workflow))
        }
      }, [policy])

      if (form.status !== 'ready' && form.status !== 'loading') {
        return h('div', { style: S.page }, `${t('工作流配置不可用', 'Workflow config unavailable')}: ${form.status}`)
      }
      if (policy === null) {
        return h('div', { style: S.page }, t('配置 JSON 解析失败，请检查 policy。', 'The policy JSON could not be parsed.'))
      }

      const select = (id) => {
        const workflow = (policy.workflows ?? []).find((row) => row.id === id)
        if (workflow === undefined) return
        setSelectedId(id)
        setDraft(clone(workflow))
        setDirty(false)
        setConfirmDelete(false)
      }
      const change = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setDirty(true)
        setConfirmDelete(false)
      }
      const save = async () => {
        if (draft === null) return
        const next = clone(policy)
        const index = (next.workflows ?? []).findIndex((row) => row.id === draft.id)
        if (index < 0) next.workflows = [...(next.workflows ?? []), clone(draft)]
        else next.workflows[index] = clone(draft)
        const accepted = await writePolicy(form, next)
        setNotice(accepted ? t('已保存', 'Saved') : t('保存失败（可能与他人同时修改）', 'Save failed'))
        if (accepted) setDirty(false)
      }
      const addPreset = () => {
        const base = draft ?? { id: 'preset', name: '新预设', description: '', persona: '', template: '', tiers: {}, hiddenPrefixes: [], deniedGlobalTools: [], permission: '', model: null }
        let index = 1
        const existing = new Set((policy.workflows ?? []).map((row) => row.id))
        while (existing.has(`preset-${index}`)) index += 1
        const created = { ...clone(base), id: `preset-${index}`, name: t('新预设', 'New preset'), description: '' }
        setSelectedId(created.id)
        setDraft(created)
        setDirty(true)
        setNotice(t('填写后点保存即可新增', 'Click Save to add it'))
      }
      const duplicate = () => {
        if (draft === null) return
        let index = 1
        const existing = new Set((policy.workflows ?? []).map((row) => row.id))
        while (existing.has(`${draft.id}-copy-${index}`)) index += 1
        const copy = { ...clone(draft), id: `${draft.id}-copy-${index}`, name: `${draft.name} 副本` }
        setSelectedId(copy.id)
        setDraft(copy)
        setDirty(true)
        setNotice(t('副本待保存', 'Copy pending save'))
      }
      const remove = async () => {
        if (draft === null) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        const next = clone(policy)
        next.workflows = (next.workflows ?? []).filter((row) => row.id !== draft.id)
        if (next.defaultWorkflow === draft.id) next.defaultWorkflow = next.workflows[0]?.id ?? 'general'
        const accepted = await writePolicy(form, next)
        setNotice(accepted ? t('已删除', 'Deleted') : t('删除失败', 'Delete failed'))
        setConfirmDelete(false)
      }

      const tiersText = tiersToText(draft?.tiers)
      const starTier = draft?.tiers?.['*'] ?? 'full'
      const model = draft?.model ?? { provider: '', model: '', effort: '' }

      return h('div', { style: S.page },
        h('div', { style: S.row },
          h('h1', { style: S.h1 }, t('工作流预设', 'Workflow presets')),
          h('span', { style: S.grow }),
          h('span', { style: S.small }, form.status === 'ready' ? t('配置已就绪', 'Config ready') : form.status),
          h('button', { type: 'button', style: S.btn, onClick: addPreset }, t('新建预设', 'New')),
          h('button', { type: 'button', style: S.btn, disabled: !dirty, onClick: () => void save() }, dirty ? t('保存修改', 'Save') : t('已保存', 'Saved')),
        ),
        notice === '' ? null : h('div', { style: S.small }, notice),
        h('div', { style: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' } },
          h('div', { style: S.col },
            h('h2', { style: S.h2 }, t('全部预设', 'All presets')),
            ...(policy.workflows ?? []).map((row) =>
              h('div', { key: row.id, style: S.listItem(row.id === selectedId), onClick: () => select(row.id) },
                h('div', { style: { fontWeight: 500 } }, row.name),
                h('div', { style: S.small }, row.id, row.description ? ` · ${row.description}` : ''),
              ),
            ),
            h('div', { style: S.small }, t('预设之间互相独立；同一会话只生效一个。', 'One preset is active per session.')),
          ),
          draft === null
            ? h('div', { style: S.card }, t('选择一个预设开始编辑。', 'Select a preset to edit.'))
            : h('div', { style: S.col },
                h('div', { style: S.card },
                  h('h2', { style: S.h2 }, t('基本信息', 'Basics')),
                  h('div', { style: S.grid2 },
                    h('div', null, h('label', { style: S.label }, t('名称', 'Name')), h('input', { style: S.input, value: draft.name, onChange: (event) => change('name', event.target.value) })),
                    h('div', null, h('label', { style: S.label }, t('说明', 'Description')), h('input', { style: S.input, value: draft.description, onChange: (event) => change('description', event.target.value) })),
                  ),
                  h('div', { style: { marginTop: 10 } },
                    h('label', { style: S.label }, t('人格段落（可选，进入系统提示）', 'Persona section (optional)')),
                    h('textarea', { style: { ...S.textarea, minHeight: 56 }, value: draft.persona, onChange: (event) => change('persona', event.target.value) }),
                  ),
                ),
                h('div', { style: S.card },
                  h('h2', { style: S.h2 }, t('提示词模板', 'Prompt template')),
                  h('textarea', { style: { ...S.textarea, minHeight: 140 }, value: draft.template, placeholder: t('目标：…\n材料：…\n约束：…\n验收：…', 'Goal: …\nContext: …\nConstraints: …\nAcceptance: …'), onChange: (event) => change('template', event.target.value) }),
                  h('div', { style: S.small }, t('会话里选中该工作流后，右侧小窗会给出这份模板，草稿为空时自动插入。', 'The assistant tab offers this template; it is inserted when the draft is empty.')),
                ),
                h('div', { style: S.card },
                  h('h2', { style: S.h2 }, t('技能分级', 'Skill tiers')),
                  h('div', { style: S.grid2 },
                    h('div', null,
                      h('label', { style: S.label }, t('默认档位（*）', 'Default tier (*)')),
                      h('select', { style: S.input, value: starTier, onChange: (event) => { const tiers = { ...(draft.tiers ?? {}) }; tiers['*'] = event.target.value; change('tiers', tiers) } },
                        h('option', { value: 'full' }, t('完整（不压缩）', 'Full')),
                        h('option', { value: 'compact' }, t('一行摘要', 'One line')),
                        h('option', { value: 'hidden' }, t('隐藏（仅 /技能名）', 'Hidden')),
                      ),
                    ),
                    h('div', null,
                      h('label', { style: S.label }, t('批量隐藏前缀（逗号分隔）', 'Hidden prefixes')),
                      h('input', { style: S.input, value: arrayToText(draft.hiddenPrefixes), onChange: (event) => change('hiddenPrefixes', commaToArray(event.target.value)) }),
                    ),
                  ),
                  h('div', { style: { marginTop: 10 } },
                    h('label', { style: S.label }, t('逐个覆盖：每行 `技能名=full|compact|hidden`', 'Per-skill overrides: `name=tier` per line')),
                    h('textarea', { style: { ...S.textarea, minHeight: 90, fontFamily: 'ui-monospace, monospace' }, value: tiersText, onChange: (event) => { const tiers = textToTiers(event.target.value); if (starTier !== 'full') tiers['*'] = starTier; change('tiers', tiers) } }),
                  ),
                ),
                h('div', { style: S.card },
                  h('h2', { style: S.h2 }, t('工具、模型与审查', 'Tools, model, review')),
                  h('div', { style: S.grid2 },
                    h('div', null, h('label', { style: S.label }, t('禁止的全局工具（逗号分隔）', 'Denied global tools')), h('input', { style: S.input, value: arrayToText(draft.deniedGlobalTools), onChange: (event) => change('deniedGlobalTools', commaToArray(event.target.value)) })),
                    h('div', null,
                      h('label', { style: S.label }, t('审查（权限预设）', 'Review (permission preset)')),
                      h('select', { style: S.input, value: draft.permission ?? '', onChange: (event) => change('permission', event.target.value) },
                        h('option', { value: '' }, t('不改', 'Unchanged')),
                        h('option', { value: 'read-only' }, 'read-only'),
                        h('option', { value: 'workspace-write' }, 'workspace-write'),
                        h('option', { value: 'danger-full-access' }, 'danger-full-access'),
                        h('option', { value: 'auto' }, 'auto'),
                      ),
                    ),
                  ),
                  h('div', { style: { ...S.grid3, marginTop: 10 } },
                    h('div', null, h('label', { style: S.label }, 'provider'), h('input', { style: S.input, value: model.provider ?? '', placeholder: 'deepseek-official', onChange: (event) => change('model', { ...model, provider: event.target.value }) })),
                    h('div', null, h('label', { style: S.label }, 'model'), h('input', { style: S.input, value: model.model ?? '', placeholder: 'deepseek-v4-pro', onChange: (event) => change('model', { ...model, model: event.target.value }) })),
                    h('div', null, h('label', { style: S.label }, 'effort'), h('input', { style: S.input, value: model.effort ?? '', placeholder: 'high', onChange: (event) => change('model', { ...model, effort: event.target.value }) })),
                  ),
                  h('div', { style: S.small }, t('模型留空则不改；审查由 /workflow 切换时写入会话。', 'An empty model is left unchanged.')),
                ),
                h('div', { style: S.row },
                  h('button', { type: 'button', style: S.btn, onClick: duplicate }, t('复制预设', 'Duplicate')),
                  h('button', { type: 'button', style: S.btn, onClick: () => void remove() }, confirmDelete ? t('再点一次确认删除', 'Click again to delete') : t('删除', 'Delete')),
                  h('span', { style: S.grow }),
                  h('span', { style: S.small }, t('技能全集与逐项勾选在右侧“工作流助手”里。', 'The full skill picker is in the right-side assistant.')),
                ),
              ),
        ),
      )
    }

    /* ---------------------------------------------------------- prompts page */
    function PromptsPage() {
      const form = useForm()
      const policy = policyOf(form)
      const [selectedId, setSelectedId] = React.useState(null)
      const [template, setTemplate] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [inputText, setInputText] = React.useState('')
      const [result, setResult] = React.useState('')

      React.useEffect(() => {
        if (policy === null || template !== null) return
        const id = selectedId ?? policy.defaultWorkflow
        const workflow = (policy.workflows ?? []).find((row) => row.id === id) ?? policy.workflows?.[0]
        if (workflow) {
          setSelectedId(workflow.id)
          setTemplate(workflow.template ?? '')
        }
      }, [policy])

      if (policy === null) {
        return h('div', { style: S.page }, t('配置 JSON 解析失败。', 'The policy JSON could not be parsed.'))
      }

      const select = (id) => {
        const workflow = (policy.workflows ?? []).find((row) => row.id === id)
        if (workflow === undefined) return
        setSelectedId(id)
        setTemplate(workflow.template ?? '')
        setNotice('')
      }
      const save = async () => {
        const next = clone(policy)
        const target = (next.workflows ?? []).find((row) => row.id === selectedId)
        if (target === undefined) return
        target.template = template ?? ''
        const accepted = await writePolicy(form, next)
        setNotice(accepted ? t('模板已保存', 'Template saved') : t('保存失败', 'Save failed'))
      }
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(result)
          setNotice(t('已复制', 'Copied'))
        } catch {
          setNotice(t('复制失败', 'Copy failed'))
        }
      }

      return h('div', { style: S.page },
        h('div', { style: S.row },
          h('h1', { style: S.h1 }, t('提示词', 'Prompts')),
          h('span', { style: S.small }, t('模板库 + 本地改写台；模型改写与会话草稿在右侧“工作流助手”。', 'Templates and a local rewriter; model rewrite lives in the right-side assistant.')),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' } },
          h('div', { style: S.col },
            h('h2', { style: S.h2 }, t('按预设', 'By preset')),
            ...(policy.workflows ?? []).map((row) =>
              h('div', { key: row.id, style: S.listItem(row.id === selectedId), onClick: () => select(row.id) },
                h('div', { style: { fontWeight: 500 } }, row.name),
                h('div', { style: S.small }, (row.template ?? '').slice(0, 60) || t('（无模板）', '(no template)')),
              ),
            ),
          ),
          h('div', { style: S.col },
            h('div', { style: S.card },
              h('div', { style: S.row }, h('h2', { style: S.h2 }, t('模板编辑', 'Template')), h('span', { style: S.grow }), h('button', { type: 'button', style: S.btn, onClick: () => void save() }, t('保存模板', 'Save'))),
              h('textarea', { style: { ...S.textarea, minHeight: 160 }, value: template ?? '', onChange: (event) => setTemplate(event.target.value) }),
              notice === '' ? null : h('div', { style: S.small }, notice),
            ),
            h('div', { style: S.card },
              h('div', { style: S.row }, h('h2', { style: S.h2 }, t('本地改写台', 'Local rewriter')), h('span', { style: S.grow }), h('span', { style: S.small }, t('不上传、不花 token', 'Offline, no tokens'))),
              h('textarea', { style: { ...S.textarea, minHeight: 80 }, placeholder: t('把要说的话贴进来…', 'Paste a rough prompt…'), value: inputText, onChange: (event) => setInputText(event.target.value) }),
              h('div', { style: { ...S.row, marginTop: 8 } },
                h('button', { type: 'button', style: S.btnOn, onClick: () => setResult(enhanceLocal(inputText)) }, t('本地增强', 'Enhance locally')),
                h('button', { type: 'button', style: S.btn, disabled: result === '', onClick: () => void copy() }, t('复制结果', 'Copy')),
                h('span', { style: S.small }, t('结果可直接粘回输入框；会话内的“用增强版”会写回草稿。', 'Paste the result back, or use the assistant tab.')),
              ),
              result === '' ? null : h('pre', { style: { ...S.pre, marginTop: 8 } }, result),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------- assistant tab */
    function Assistant(props) {
      const { sessionId, useInput, inputActions } = props
      const form = useForm()
      const policy = policyOf(form)
      const storeValue = useStoreValue()
      const skills = useSkills(sessionId)
      const input = typeof useInput === 'function' ? useInput((snapshot) => snapshot) : undefined
      const [view, setView] = React.useState(store.focus)
      const [applyTemplate, setApplyTemplate] = React.useState(store.applyTemplate)
      const [pendingTemplate, setPendingTemplate] = React.useState(null)
      const [activeId, setActiveId] = React.useState(null)
      const [template, setTemplate] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [enhanceText, setEnhanceText] = React.useState('')
      const [enhanced, setEnhanced] = React.useState('')
      const [original, setOriginal] = React.useState('')
      const [audit, setAudit] = React.useState(null)

      React.useEffect(() => {
        setView(store.focus)
      }, [storeValue.focus])

      React.useEffect(() => {
        if (template !== '' || policy === null) return
        const workflow = (policy.workflows ?? []).find((row) => row.id === policy.defaultWorkflow)
        if (workflow !== undefined) {
          setActiveId(workflow.id)
          setTemplate(workflow.template ?? '')
        }
      }, [policy, template])

      React.useEffect(() => {
        if (sessionId === undefined) return
        const cached = store.statusBySession[sessionId]
        if (cached !== undefined) {
          setActiveId(cached.id)
          setTemplate(cached.template)
          return undefined
        }
        let alive = true
        void execute(sessionId, '/workflow status').then((result) => {
          if (!alive || !result.ok) return
          try {
            const parsed = JSON.parse(result.text)
            if (typeof parsed.id === 'string') {
              const next = { id: parsed.id, template: typeof parsed.template === 'string' ? parsed.template : '' }
              store.statusBySession[sessionId] = next
              setActiveId(next.id)
              setTemplate(next.template)
            }
          } catch {
            /* 保留默认值 */
          }
        })
        return () => {
          alive = false
        }
      }, [sessionId])

      React.useEffect(() => {
        const pending = store.pendingText
        if (pending !== '') {
          setEnhanceText(pending)
          setOriginal(pending)
          setEnhanced(enhanceLocal(pending))
          patchStore({ pendingText: '' })
        }
      }, [storeValue.pendingText])

      if (policy === null) {
        return h('div', { style: S.page }, '配置不可用：policy 不是合法 JSON。')
      }

      const workflow = (policy.workflows ?? []).find((row) => row.id === activeId) ?? (policy.workflows ?? [])[0]
      const currentId = workflow?.id ?? policy.defaultWorkflow
      const draft = String(input?.draft ?? '')

      const switchWorkflow = async (id) => {
        if (sessionId === undefined) return
        setBusy(true)
        const result = await execute(sessionId, `/workflow ${id}`)
        if (result.ok) {
          setActiveId(id)
          const next = (policy.workflows ?? []).find((row) => row.id === id)
          const nextTemplate = next?.template ?? ''
          if (sessionId !== undefined) store.statusBySession[sessionId] = { id, template: nextTemplate }
          setTemplate(nextTemplate)
          if (applyTemplate && nextTemplate !== '') {
            if (draft.trim() === '') {
              inputActions?.setDraft?.(nextTemplate)
              setNotice('已切换预设，并套用它的提示词模板。')
            } else {
              setPendingTemplate(nextTemplate)
              setNotice('已切换预设。草稿非空，请选择是否套用新模板。')
            }
          } else {
            setNotice(result.text)
          }
        } else {
          setNotice(result.text)
        }
        setBusy(false)
      }

      const toggleApplyTemplate = (value) => {
        setApplyTemplate(value)
        store.applyTemplate = value
        writeApplyTemplate(value)
      }

      const insertTemplate = () => {
        if (template.trim() === '') return
        inputActions?.setDraft?.(draft.trim() === '' ? template : `${draft}\n\n${template}`)
        setNotice('模板已插入草稿。')
      }

      const runCheck = async () => {
        if (sessionId === undefined) return
        setBusy(true)
        const counts = { full: 0, compact: 0, hidden: 0 }
        for (const skill of skills.skills) counts[tierOf(skill.name)] += 1
        const base = {
          total: skills.skills.length,
          modelVisible: skills.skills.filter((skill) => skill.modelInvocable !== false).length,
          ...counts,
          tools: 0,
          mcp: [],
        }
        const result = await execute(sessionId, '/workflow check')
        if (result.ok) {
          try {
            const hostAudit = JSON.parse(result.text)
            base.tools = hostAudit.tools ?? 0
            base.mcp = Array.isArray(hostAudit.mcp) ? hostAudit.mcp : []
          } catch {
            /* 保留本地统计 */
          }
        } else setNotice(result.text)
        setAudit(base)
        setBusy(false)
      }

      const setTier = async (name, tier) => {
        const next = clone(policy)
        const target = (next.workflows ?? []).find((row) => row.id === currentId)
        if (target === undefined) return
        target.tiers = target.tiers ?? {}
        target.tiers[name] = tier
        const accepted = await writePolicy(form, next)
        setNotice(accepted ? '已保存。' : '保存失败（可能与他人同时修改）。')
      }

      const tierOf = (name) => {
        const tiers = workflow?.tiers ?? {}
        const value = tiers[name] ?? tiers['*'] ?? 'full'
        if (value === 'full' && (workflow?.hiddenPrefixes ?? []).some((prefix) => name.startsWith(prefix))) return 'hidden'
        return value
      }

      const modelRewrite = async () => {
        if (sessionId === undefined) return
        const text = enhanceText.trim()
        if (text === '') return
        setBusy(true)
        setOriginal((current) => current || text)
        const result = await execute(sessionId, `/enhance ${text}`)
        if (result.ok) {
          setEnhanced(result.text)
          setNotice('模型改写完成。')
        } else {
          setNotice(result.text)
        }
        setBusy(false)
      }

      const filtered = skills.skills.filter((skill) => query === '' || skill.name.includes(query))
      const segmented = (active, label, onClick) =>
        h('button', { type: 'button', style: active ? S.btnOn : S.btn, onClick }, label)

      return h('div', { style: { ...S.page, padding: '14px 14px', gap: 12 } },
        h('div', { style: S.row },
          h('h1', { style: { ...S.h1, fontSize: 14 } }, '工作流助手'),
          h('span', { style: S.grow }),
          h('button', { type: 'button', style: S.btn, disabled: busy, onClick: () => void runCheck() }, '检查'),
        ),
        h('div', { style: { display: 'flex', gap: 6 } },
          segmented(view === 'workflow', '预设', () => setView('workflow')),
          segmented(view === 'enhance', '提示词', () => setView('enhance')),
        ),
        notice === '' ? null : h('div', { style: S.small }, notice),
        audit === null
          ? null
          : h('div', { style: S.card },
              h('div', { style: S.small }, `技能 ${audit.total} · 模型可见 ${audit.modelVisible} · 完整 ${audit.full} · 一行 ${audit.compact} · 隐藏 ${audit.hidden}`),
              h('div', { style: S.small }, `全局工具 ${audit.tools} · MCP ${audit.mcp.length}`),
              audit.mcp.length === 0 ? null : h('div', { style: { ...S.small, wordBreak: 'break-all' } }, audit.mcp.join('、')),
            ),
        view === 'workflow'
          ? [
              h('div', { key: 'wf', style: S.card },
                h('h2', { style: S.h2 }, '选择预设'),
                ...(policy.workflows ?? []).map((row) =>
                  h('div', { key: row.id, style: S.row },
                    h('span', { style: { ...S.small, flex: 1, opacity: row.id === currentId ? 1 : 0.65 } }, `${row.id === currentId ? '● ' : '○ '}${row.name}`),
                    h('button', { type: 'button', style: row.id === currentId ? S.btnOn : S.btn, disabled: busy || row.id === currentId, onClick: () => void switchWorkflow(row.id) }, row.id === currentId ? '当前' : '切换'),
                  ),
                ),
              ),
              pendingTemplate === null
                ? null
                : h('div', { key: 'pending', style: S.card },
                    h('div', { style: S.small }, '草稿里已经有内容，是否套用新预设的提示词模板？'),
                    h('div', { style: S.row },
                      h('button', { type: 'button', style: S.btnOn, onClick: () => { inputActions?.setDraft?.(pendingTemplate); setPendingTemplate(null); setNotice('已用模板替换草稿。') } }, '替换草稿'),
                      h('button', { type: 'button', style: S.btn, onClick: () => { inputActions?.setDraft?.(`${draft}\n\n${pendingTemplate}`); setPendingTemplate(null); setNotice('已追加模板。') } }, '追加'),
                      h('button', { type: 'button', style: S.btn, onClick: () => { setPendingTemplate(null); setNotice('保留原草稿。') } }, '不套用'),
                    ),
                  ),
              h('div', { key: 'tpl', style: S.card },
                h('div', { style: S.row },
                  h('h2', { style: S.h2 }, '提示词模板'),
                  h('span', { style: S.grow }),
                  h('button', { type: 'button', style: S.btn, onClick: insertTemplate }, '插入草稿'),
                ),
                h('label', { key: 'toggle', style: { ...S.small, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
                  h('input', { type: 'checkbox', checked: applyTemplate, onChange: (event) => toggleApplyTemplate(event.target.checked) }),
                  '切换预设时套用它的提示词模板',
                ),
                template === '' ? h('div', { style: S.small }, '这个预设还没有模板。') : h('pre', { style: { ...S.pre, maxHeight: 160 } }, template),
              ),
              h('div', { key: 'skills', style: S.card },
                h('div', { style: S.row },
                  h('h2', { style: S.h2 }, '技能分级'),
                  h('span', { style: S.grow }),
                  h('input', { style: { ...S.input, width: 110 }, placeholder: '搜索技能', value: query, onChange: (event) => setQuery(event.target.value) }),
                ),
                skills.status === 'loading' ? h('div', { style: S.small }, '读取目录…') : null,
                skills.status === 'error' ? h('div', { style: S.small }, `读取失败：${skills.error}`) : null,
                ...filtered.map((skill) =>
                  h('div', { key: skill.name, style: S.row },
                    h('span', { style: { ...S.small, flex: 1 } }, skill.name),
                    ...['full', 'compact', 'hidden'].map((tier) =>
                      h('button', { key: tier, type: 'button', style: tierOf(skill.name) === tier ? S.btnOn : S.btn, disabled: form.writable === false, onClick: () => void setTier(skill.name, tier) },
                        tier === 'full' ? '完整' : tier === 'compact' ? '一行' : '隐藏',
                      ),
                    ),
                  ),
                ),
              ),
            ]
          : [
              h('div', { key: 'enh', style: S.card },
                h('h2', { style: S.h2 }, '优化当前提示词'),
                h('div', { style: S.small }, '只改草稿，不会改动预设或它的模板。'),
                h('textarea', { style: { ...S.textarea, minHeight: 90, marginTop: 6 }, value: enhanceText, placeholder: '把草稿贴进来，或直接在输入框写好后点“提示词优化”。', onChange: (event) => { setEnhanceText(event.target.value); setOriginal(event.target.value); setEnhanced('') } }),
                h('div', { style: { ...S.row, marginTop: 6, flexWrap: 'wrap' } },
                  h('button', { type: 'button', style: S.btnOn, onClick: () => { setOriginal(enhanceText); setEnhanced(enhanceLocal(enhanceText)) } }, '本地优化'),
                  h('button', { type: 'button', style: S.btn, disabled: busy, onClick: () => void modelRewrite() }, busy ? '…' : '模型优化'),
                  h('button', { type: 'button', style: S.btn, disabled: enhanced === '', onClick: () => { inputActions?.setDraft?.(enhanced); setNotice('已写入草稿。') } }, '用优化版'),
                  h('button', { type: 'button', style: S.btn, disabled: original === '', onClick: () => { inputActions?.setDraft?.(original); setNotice('已恢复原文。') } }, '恢复原文'),
                ),
                enhanced === '' ? null : h('pre', { style: { ...S.pre, maxHeight: 200, marginTop: 6 } }, enhanced),
              ),
            ],
      )
    }

    const AssistantBoundary = (props) => h(Boundary, { sessionId: props.sessionId }, h(Assistant, props))

    /* --------------------------------------------------------- composer pills */
    const pillStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      fontSize: 12,
      lineHeight: '18px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-subtle, #d9dee5)',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    function FlowGlyph() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 7h10M4 12h14M4 17h8' }),
        h('path', { d: 'M17 5l2 2-2 2' }),
      )
    }

    function SparkGlyph() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 3l1.7 4.9L18.6 9.6l-4.9 1.7L12 16.2l-1.7-4.9L5.4 9.6l4.9-1.7z' }),
        h('path', { d: 'M18.5 15.5v3M17 17h3' }),
      )
    }

    function openAssistant() {
      try {
        pluginCtx?.sidebarRight?.openTab?.(TAB_KIND)
        return true
      } catch (error) {
        console.warn('[dsh-workflows] openTab failed', error)
        return false
      }
    }

    function WorkflowButton() {
      return h('button', {
        type: 'button',
        style: pillStyle,
        title: '选择工作流预设（在右侧小窗打开）',
        'aria-label': '选择工作流预设',
        onClick: () => {
          patchStore({ focus: 'workflow' })
          openAssistant()
        },
      }, h(FlowGlyph), h('span', null, '工作流'))
    }

    function EnhanceButton(props) {
      const { useInput } = props
      const input = typeof useInput === 'function' ? useInput((snapshot) => snapshot) : undefined
      const onClick = () => {
        const text = String(input?.draft ?? '')
        patchStore(text.trim() === '' ? { focus: 'enhance' } : { focus: 'enhance', pendingText: text })
        openAssistant()
      }
      return h('button', {
        type: 'button',
        style: pillStyle,
        title: '优化当前提示词（在右侧小窗打开）',
        'aria-label': '优化提示词',
        onClick,
      }, h(SparkGlyph), h('span', null, '提示词优化'))
    }

    /* ---------------------------------------------------------------- apply */
    return {
      inject: ['slots', 'remote', 'remote.commands', 'remote.skills', 'sidebarRight', 'sidebarRightTabs', 'configForms'],
      apply(ctx) {
        pluginCtx = ctx
        const withBoundary = (component) => (props) => h(Boundary, { sessionId: props?.sessionId }, h(component, props))

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-workflows', order: 30, label: () => t('工作流预设', 'Workflows') }, WorkflowsIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'dsh-workflows' }, withBoundary(WorkflowsPage)),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-prompts', order: 31, label: () => t('提示词', 'Prompts') }, PromptsIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'dsh-prompts' }, withBoundary(PromptsPage)),
        )
        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => t('工作流助手', 'Workflow assistant'),
            guide: [{ id: TAB_ID, title: t('工作流助手', 'Workflow assistant'), description: t('切换工作流、套模板、增强提示词', 'Switch workflows, insert templates, enhance prompts') }],
          }),
        )
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, AssistantBoundary),
        )
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-workflows-workflow-button', order: 880 }, WorkflowButton),
        )
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-workflows-enhance-button', order: 890 }, EnhanceButton),
        )
        ctx.effect(() => () => {
          if (pluginCtx === ctx) pluginCtx = undefined
        })
      },
    }
  },
})
