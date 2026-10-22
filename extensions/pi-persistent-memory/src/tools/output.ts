// Model-facing presentation only. Storage/service envelopes and renderer details stay unchanged.
type Data = Record<string, any>;
const inline = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

function owner(item: Data): string {
  const scope = item.scope ?? (item.scope_key ? JSON.parse(item.scope_key) : undefined);
  if (!scope) return '';
  const kind = Array.isArray(scope) ? scope[0] : scope.kind;
  const project = Array.isArray(scope) ? scope[1] : scope.project;
  return kind === 'global' ? 'global' : `project:${inline(project)}`;
}

function entity(item: Data): string {
  const name = item.display_name ?? item.canonical_name;
  return [`[${item.id}] ${inline(name)} (${item.type}; ${owner(item)})`,
    item.canonical_name && item.canonical_name !== name ? `Canonical name: ${inline(item.canonical_name)}` : '',
    item.aliases?.length ? `Aliases: ${item.aliases.map(inline).join(', ')}` : '',
    item.memory_id != null ? `Memory: [${item.memory_id}]` : '',
    item.memory_summary ? `${inline(item.memory_summary.title)}\n${item.memory_summary.excerpt}` : '',
    item.truncated || item.aliases_truncated ? 'Display abbreviated.' : '',
  ].filter(Boolean).join('\n');
}

function memoryList(items: Data[], label: string, showOwner: boolean): string {
  return [`${items.length} ${label} on this page.`, ...items.map((item) =>
    [`[${item.id}] ${inline(item.title)}${showOwner ? ` (${owner(item)})` : ''}`,
      item.excerpt && item.excerpt !== item.title ? item.excerpt : '',
      item.deleted_at ? `Deleted: ${item.deleted_at}` : '',
    ].filter(Boolean).join('\n'))].join('\n\n');
}

function continuation(data: Data): string {
  if (!data.has_more) return '';
  return data.next_cursor
    ? `\n\nMore available. Continue with the same selectors and cursor: ${data.next_cursor}`
    : '\n\nMore available. Use a focused graph root.';
}

export function formatMemoryOutput(data: Data): string {
  let text: string;
  if (data.action === 'save') {
    text = `Memory [${data.id}] saved${data.indexed ? ' and indexed.' : '; indexing pending. Do not save again to retry indexing.'}`;
    if (data.topic_key) text += `\nTopic key: ${data.topic_key}`;
  } else if (data.action === 'reindex') {
    text = `Reindex: ${data.processed} processed, ${data.succeeded} indexed, ${data.failed} failed, ${data.stale} stale, ${data.remaining} remaining.`;
  } else if (data.action === 'delete' || data.action === 'restore') {
    text = `Memory [${data.id}] ${data.action === 'delete' ? 'soft-deleted (recoverable).' : 'restored; indexing pending.'}`;
  } else if (data.operation === 'save_entity') {
    text = `Entity saved.\n${entity(data)}`;
  } else if (data.operation === 'save_relation') {
    text = `Relation [${data.id}] ${data.existed ? 'already exists' : 'saved'}: [${data.source_entity_id}] --${data.relation_type}--> [${data.target_entity_id}].`;
  } else if (data.operation === 'delete_relation') {
    text = `Relation [${data.id}] deleted.`;
  } else if (Array.isArray(data.results)) {
    text = memoryList(data.results, 'memory excerpts', !!data.scope?.explicit_global || data.scope?.kind === 'global');
    if (data.actual_mode !== data.requested_mode) text += `\nSearch fallback: ${data.actual_mode}.`;
  } else if (Array.isArray(data.nodes)) {
    text = `Graph root: [${data.root.id}]. ${data.nodes.length} entities, ${data.edges.length} relations.\n\n` +
      data.nodes.map(entity).join('\n\n');
    if (data.edges.length) text += '\n\n' + data.edges.map((edge: Data) =>
      `[${edge.id}] [${edge.source}] --${edge.type}--> [${edge.target}]`).join('\n');
    if (data.associations?.length) text += '\n\n' + data.associations.map((link: Data) =>
      `[${link.id}] Memory [${link.memory_id}] linked to entity [${link.entity_id}]`).join('\n');
    if (data.limits?.has_more) {
      const reached = ['depth', 'entity', 'byte'].filter((key) => data.limits[`${key}_limit`]);
      text += `\n\nPartial graph (${reached.join(', ')} limit). Use a focused graph root.`;
    }
  } else if (Array.isArray(data.entities)) {
    text = `${data.entities.length} entities on this page.\n\n${data.entities.map(entity).join('\n\n')}`;
  } else if (Array.isArray(data.records)) {
    text = `${data.records.length} user messages on this page.\n\n` + data.records.map((item: Data) =>
      `[${item.id}] ${item.created_at} (session:${item.session_id})\n${item.excerpt}`).join('\n\n');
  } else if (Array.isArray(data.items)) {
    const deleted = data.items[0]?.deleted_at !== undefined || !data.scope;
    text = memoryList(data.items, deleted ? 'deleted memories' : 'context excerpts', deleted || !!data.scope?.explicit_global);
  } else if (data.field) {
    const paged = data.has_more || data.offset > 0 || data.title_abbreviated;
    const progress = `${data.page_bytes} of ${data.total_field_bytes} bytes`;
    text = data.field === 'title'
      ? `[${data.id}] Title page (${progress})\n\n${data.title}`
      : `[${data.id}] ${data.title}${paged ? ` (content page; ${progress})` : ''}\n\n${data.content}`;
  } else if (typeof data.content === 'string' && data.session_id !== undefined) {
    const progress = data.has_more || data.offset > 0
      ? ` (bytes ${data.offset}–${data.offset + Buffer.byteLength(data.content, 'utf8')} of ${data.total_bytes})` : '';
    text = `Message [${data.id}] ${data.created_at} (session:${data.session_id})${progress}\n\n${data.content}`;
  } else if (data.canonical_name !== undefined) {
    text = entity(data);
  } else {
    // Unknown envelopes remain complete rather than silently losing fields.
    return JSON.stringify(data);
  }
  if (data.notice) text += `\nNotice: ${data.notice}`;
  if (data.warnings?.length) text += `\nWarning: ${data.warnings.join('; ')}`;
  return text + continuation(data);
}
