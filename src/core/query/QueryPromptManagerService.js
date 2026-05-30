export const QUERY_PROMPT_MANAGER_IDENTIFIER = 'vectorsEnhancedQuery';
export const QUERY_PROMPT_MANAGER_NAME = 'Vectors Enhanced Query';
export const DEFAULT_QUERY_PROMPT_MANAGER_INJECTION_POSITION = 0;
const ABSOLUTE_QUERY_PROMPT_MANAGER_INJECTION_POSITION = 1;
const DEFAULT_PROMPT_ORDER = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: false },
  { identifier: 'nsfw', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
];

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function findPrompt(settings, identifier) {
  return Array.isArray(settings?.prompts)
    ? settings.prompts.find(prompt => prompt?.identifier === identifier)
    : null;
}

function insertOrderReference(order, identifier, enabled = true) {
  if (!Array.isArray(order)) return false;
  if (order.some(entry => entry?.identifier === identifier)) return false;

  const reference = { identifier, enabled };
  const chatHistoryIndex = order.findIndex(entry => entry?.identifier === 'chatHistory');
  if (chatHistoryIndex >= 0) {
    order.splice(chatHistoryIndex + 1, 0, reference);
  } else {
    order.push(reference);
  }
  return true;
}

function cloneOrder(order) {
  return Array.isArray(order)
    ? order.filter(entry => entry?.identifier).map(entry => ({
      identifier: entry.identifier,
      enabled: entry.enabled !== false,
    }))
    : [];
}

function createInitialOrder(settings, identifier) {
  const sourceOrder = settings.prompt_order.find(list => Array.isArray(list?.order) && list.order.length > 0)?.order;
  const order = cloneOrder(sourceOrder);
  if (order.length === 0) {
    const existingIdentifiers = new Set((settings.prompts || []).map(prompt => prompt?.identifier).filter(Boolean));
    for (const entry of DEFAULT_PROMPT_ORDER) {
      if (existingIdentifiers.has(entry.identifier)) {
        order.push({ ...entry });
      }
    }
  }
  insertOrderReference(order, identifier, true);
  return order.length > 0 ? order : [{ identifier, enabled: true }];
}

function ensureOrderReferences(promptManager, identifier) {
  const settings = promptManager?.serviceSettings;
  if (!settings) return { changed: false, activeEnabled: false, orderCount: 0 };

  settings.prompt_order = Array.isArray(settings.prompt_order) ? settings.prompt_order : [];

  let changed = false;
  for (const list of settings.prompt_order) {
    if (!list || !Array.isArray(list.order)) continue;
    changed = insertOrderReference(list.order, identifier, true) || changed;
  }

  if (promptManager?.activeCharacter) {
    const characterId = promptManager.activeCharacter.id;
    let activeList = settings.prompt_order.find(list => String(list?.character_id) === String(characterId));
    if (!activeList) {
      activeList = {
        character_id: characterId,
        order: createInitialOrder(settings, identifier),
      };
      settings.prompt_order.push(activeList);
      changed = true;
    } else if (!Array.isArray(activeList.order) || activeList.order.length === 0) {
      activeList.order = createInitialOrder(settings, identifier);
      changed = true;
    } else {
      changed = insertOrderReference(activeList.order, identifier, true) || changed;
    }
  }

  const activeEntry = typeof promptManager?.getPromptOrderEntry === 'function'
    ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
    : null;

  return {
    changed,
    activeEnabled: activeEntry?.enabled === true,
    orderCount: settings.prompt_order.filter(list => Array.isArray(list?.order)).length,
  };
}

export function createQueryPromptManagerPrompt(options = {}) {
  const injectionPosition = Number.isFinite(Number(options.injectionPosition))
    ? Number(options.injectionPosition)
    : DEFAULT_QUERY_PROMPT_MANAGER_INJECTION_POSITION;
  const prompt = {
    identifier: options.identifier || QUERY_PROMPT_MANAGER_IDENTIFIER,
    name: options.name || QUERY_PROMPT_MANAGER_NAME,
    role: options.role || 'system',
    content: String(options.content || ''),
    system_prompt: false,
    position: 0,
    injection_position: injectionPosition,
    injection_trigger: [],
    forbid_overrides: false,
    extension: true,
  };

  if (injectionPosition === ABSOLUTE_QUERY_PROMPT_MANAGER_INJECTION_POSITION) {
    prompt.injection_depth = clampInteger(options.depth, 2, 0, 999);
    prompt.injection_order = clampInteger(options.order, 100, -10000, 10000);
  }

  return prompt;
}

export function ensureQueryPromptManagerEntry(promptManager, options = {}) {
  const settings = promptManager?.serviceSettings;
  if (!settings || typeof settings !== 'object') {
    return { ok: false, reason: 'prompt-manager-settings-missing' };
  }

  settings.prompts = Array.isArray(settings.prompts) ? settings.prompts : [];

  const identifier = options.identifier || QUERY_PROMPT_MANAGER_IDENTIFIER;
  const injectionPosition = Number.isFinite(Number(options.injectionPosition))
    ? Number(options.injectionPosition)
    : DEFAULT_QUERY_PROMPT_MANAGER_INJECTION_POSITION;
  let changed = false;
  let prompt = findPrompt(settings, identifier);

  if (!prompt) {
    prompt = createQueryPromptManagerPrompt({
      identifier,
      injectionPosition,
      depth: options.depth,
      order: options.order,
      content: options.content,
    });
    settings.prompts.push(prompt);
    changed = true;
  } else {
    const previousInjectionPosition = prompt.injection_position;
    const updates = {
      name: QUERY_PROMPT_MANAGER_NAME,
      role: 'system',
      system_prompt: false,
      extension: true,
    };
    Object.entries(updates).forEach(([key, value]) => {
      if (prompt[key] !== value) {
        prompt[key] = value;
        changed = true;
      }
    });

    if (!Number.isFinite(Number(previousInjectionPosition)) || Number(previousInjectionPosition) !== injectionPosition) {
      prompt.injection_position = injectionPosition;
      changed = true;
    }

    const resolvedInjectionPosition = Number.isFinite(Number(prompt.injection_position))
      ? Number(prompt.injection_position)
      : injectionPosition;
    if (resolvedInjectionPosition !== ABSOLUTE_QUERY_PROMPT_MANAGER_INJECTION_POSITION) {
      if (Object.hasOwn(prompt, 'injection_depth')) {
        delete prompt.injection_depth;
        changed = true;
      }
      if (Object.hasOwn(prompt, 'injection_order')) {
        delete prompt.injection_order;
        changed = true;
      }
    } else {
      if (!Number.isFinite(Number(prompt.injection_depth))) {
        prompt.injection_depth = 2;
        changed = true;
      }
      if (!Number.isFinite(Number(prompt.injection_order))) {
        prompt.injection_order = 100;
        changed = true;
      }
    }

    if (options.content !== undefined && prompt.content !== String(options.content || '')) {
      prompt.content = String(options.content || '');
      changed = true;
    }
  }

  const orderResult = ensureOrderReferences(promptManager, identifier);
  changed = orderResult.changed || changed;

  return {
    ok: true,
    changed,
    prompt,
    identifier,
    activeEnabled: orderResult.activeEnabled,
    orderCount: orderResult.orderCount,
  };
}

export function setQueryPromptManagerContent(promptManager, content = '', options = {}) {
  const ensured = ensureQueryPromptManagerEntry(promptManager, options);
  if (!ensured.ok) return ensured;

  const value = String(content || '');
  const changed = ensured.prompt.content !== value;
  ensured.prompt.content = value;

  return {
    ...ensured,
    changed: ensured.changed || changed,
    contentLength: value.length,
  };
}

export function clearQueryPromptManagerContent(promptManager, reason = '', options = {}) {
  const result = setQueryPromptManagerContent(promptManager, '', options);
  return {
    ...result,
    cleared: result.ok === true,
    reason: String(reason || ''),
  };
}

export function getQueryPromptManagerStatus(promptManager, options = {}) {
  const settings = promptManager?.serviceSettings;
  if (!settings || typeof settings !== 'object') {
    return { ok: false, reason: 'prompt-manager-settings-missing' };
  }

  const identifier = options.identifier || QUERY_PROMPT_MANAGER_IDENTIFIER;
  const prompt = findPrompt(settings, identifier);
  const activeEntry = typeof promptManager?.getPromptOrderEntry === 'function'
    ? promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier)
    : null;

  return {
    ok: true,
    exists: !!prompt,
    identifier,
    activeEnabled: activeEntry?.enabled === true,
    contentLength: String(prompt?.content || '').length,
    role: prompt?.role || '',
    injectionPosition: prompt?.injection_position,
    injectionDepth: prompt?.injection_depth,
    injectionOrder: prompt?.injection_order,
    orderReferenced: !!activeEntry,
  };
}
