const STORAGE_KEY = 'workspace-tabs';
const LEGACY_CONTENT_STORAGE_KEY = 'swagger-editor-content';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function contentStorageKey(tabId) {
  return `${STORAGE_KEY}:content:${tabId}`;
}

export function createTab(name) {
  return { id: generateId(), name };
}

export function saveWorkspaceMeta(meta) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
}

// Raw string, no JSON object wrapping it -- this is the hot path, called on
// every debounced keystroke, so it has to stay as cheap as the old
// single-workspace editor-content-persistence plugin it replaced: one
// localStorage.setItem of exactly the tab being edited, never touching (or
// even reading) any other tab's content.
export function setTabContent(tabId, content) {
  localStorage.setItem(contentStorageKey(tabId), content);
}

export function getTabContent(tabId) {
  return localStorage.getItem(contentStorageKey(tabId)) || '';
}

export function removeTabContent(tabId) {
  localStorage.removeItem(contentStorageKey(tabId));
}

function migrateFromLegacyContent() {
  const legacyContent = localStorage.getItem(LEGACY_CONTENT_STORAGE_KEY);
  const tab = createTab('Tab 1');
  setTabContent(tab.id, legacyContent || '');
  const meta = { tabs: [tab], activeTabId: tab.id };
  saveWorkspaceMeta(meta);
  if (legacyContent !== null) {
    localStorage.removeItem(LEGACY_CONTENT_STORAGE_KEY);
  }
  return meta;
}

// Migrates the previous shape of this same key -- {tabs: [{id, name,
// content}], activeTabId} -- where every tab's full content lived inline in
// one blob. That meant every keystroke's debounced autosave had to
// JSON.parse + JSON.stringify *all* open tabs' content, not just the tab
// being edited, which is what made saves feel slow as tabs/content grew.
// This splits each tab's content out to its own key so the metadata blob
// stays tiny (just ids/names) and the hot save path only ever touches one
// tab's raw string.
function migrateFromInlineContent(parsed) {
  const tabs = parsed.tabs.map(({ id, name, content }) => {
    setTabContent(id, content || '');
    return { id, name };
  });
  const meta = { tabs, activeTabId: parsed.activeTabId };
  saveWorkspaceMeta(meta);
  return meta;
}

export function getWorkspaceMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        if (parsed.tabs[0].content !== undefined) {
          return migrateFromInlineContent(parsed);
        }
        return parsed;
      }
    }
  } catch {
    // fall through to migration/default below
  }
  return migrateFromLegacyContent();
}

export function getActiveTab(meta) {
  return meta.tabs.find((tab) => tab.id === meta.activeTabId) || meta.tabs[0];
}

export function addTab(meta) {
  const tab = createTab(`Tab ${meta.tabs.length + 1}`);
  return { tabs: [...meta.tabs, tab], activeTabId: tab.id };
}

export function duplicateTab(meta, tabId) {
  const index = meta.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return meta;
  }
  const source = meta.tabs[index];
  const tab = createTab(`${source.name} copy`);
  const tabs = [...meta.tabs];
  tabs.splice(index + 1, 0, tab);
  return { tabs, activeTabId: tab.id };
}

export function closeTab(meta, tabId) {
  if (meta.tabs.length <= 1) {
    return meta;
  }
  const index = meta.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return meta;
  }
  const tabs = meta.tabs.filter((tab) => tab.id !== tabId);
  if (meta.activeTabId !== tabId) {
    return { tabs, activeTabId: meta.activeTabId };
  }
  const newActiveIndex = Math.max(0, index - 1);
  return { tabs, activeTabId: tabs[newActiveIndex].id };
}

export function setActiveTab(meta, tabId) {
  if (!meta.tabs.some((tab) => tab.id === tabId)) {
    return meta;
  }
  return { ...meta, activeTabId: tabId };
}

export function renameTab(meta, tabId, name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return meta;
  }
  return {
    ...meta,
    tabs: meta.tabs.map((tab) => (tab.id === tabId ? { ...tab, name: trimmed } : tab)),
  };
}

export async function copyTabContentToClipboard(content) {
  await navigator.clipboard.writeText(content);
}
