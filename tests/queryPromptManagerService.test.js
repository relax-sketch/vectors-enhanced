import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUERY_PROMPT_MANAGER_IDENTIFIER,
  clearQueryPromptManagerContent,
  ensureQueryPromptManagerEntry,
  getQueryPromptManagerStatus,
  setQueryPromptManagerContent,
} from '../src/core/query/QueryPromptManagerService.js';

function makePromptManager() {
  const promptManager = {
    activeCharacter: { id: 1 },
    serviceSettings: {
      prompts: [
        { identifier: 'main', name: 'Main', content: 'main', system_prompt: true },
        { identifier: 'chatHistory', name: 'Chat History', content: '', marker: true },
      ],
      prompt_order: [
        {
          character_id: 1,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
        },
      ],
    },
  };
  promptManager.getPromptOrderForCharacter = character => {
    return promptManager.serviceSettings.prompt_order
      .find(list => String(list.character_id) === String(character?.id))?.order || [];
  };
  promptManager.getPromptOrderEntry = (character, identifier) => {
    return promptManager.getPromptOrderForCharacter(character)
      .find(entry => entry.identifier === identifier) || null;
  };
  return promptManager;
}

test('ensureQueryPromptManagerEntry creates a relative prompt after chatHistory', () => {
  const promptManager = makePromptManager();
  const result = ensureQueryPromptManagerEntry(promptManager);

  assert.equal(result.ok, true);
  const prompt = promptManager.serviceSettings.prompts.find(item => item.identifier === QUERY_PROMPT_MANAGER_IDENTIFIER);
  assert.equal(prompt.name, 'Vectors Enhanced Query');
  assert.equal(prompt.role, 'system');
  assert.equal(prompt.injection_position, 0);
  assert.equal(Object.hasOwn(prompt, 'injection_depth'), false);
  assert.equal(Object.hasOwn(prompt, 'injection_order'), false);
  assert.equal(prompt.extension, true);

  const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
  assert.deepEqual(order.map(item => item.identifier), ['main', 'chatHistory', QUERY_PROMPT_MANAGER_IDENTIFIER]);
});

test('setQueryPromptManagerContent forces relative placement and removes depth/order', () => {
  const promptManager = makePromptManager();
  ensureQueryPromptManagerEntry(promptManager);
  const prompt = promptManager.serviceSettings.prompts.find(item => item.identifier === QUERY_PROMPT_MANAGER_IDENTIFIER);
  prompt.injection_position = 2;
  prompt.injection_depth = 7;
  prompt.injection_order = 250;

  const result = setQueryPromptManagerContent(promptManager, 'query results');

  assert.equal(result.ok, true);
  assert.equal(prompt.content, 'query results');
  assert.equal(prompt.injection_position, 0);
  assert.equal(Object.hasOwn(prompt, 'injection_depth'), false);
  assert.equal(Object.hasOwn(prompt, 'injection_order'), false);
});

test('relative query prompt removes legacy depth and order', () => {
  const promptManager = makePromptManager();
  promptManager.serviceSettings.prompts.push({
    identifier: QUERY_PROMPT_MANAGER_IDENTIFIER,
    name: 'Vectors Enhanced Query',
    role: 'system',
    content: '',
    system_prompt: false,
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
    extension: true,
  });

  const result = ensureQueryPromptManagerEntry(promptManager);

  assert.equal(result.ok, true);
  assert.equal(result.prompt.injection_position, 0);
  assert.equal(Object.hasOwn(result.prompt, 'injection_depth'), false);
  assert.equal(Object.hasOwn(result.prompt, 'injection_order'), false);
});

test('clearQueryPromptManagerContent keeps entry and clears content', () => {
  const promptManager = makePromptManager();
  setQueryPromptManagerContent(promptManager, 'old content');

  const result = clearQueryPromptManagerContent(promptManager, 'skip');
  const status = getQueryPromptManagerStatus(promptManager);

  assert.equal(result.ok, true);
  assert.equal(result.cleared, true);
  assert.equal(status.exists, true);
  assert.equal(status.contentLength, 0);
});
