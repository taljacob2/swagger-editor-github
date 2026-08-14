const STORAGE_KEY = 'workspace-tabs';
const LEGACY_CONTENT_STORAGE_KEY = 'swagger-editor-content';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createTab(name, content = '') {
  return { id: generateId(), name, content };
}

export function saveWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

function migrateFromLegacyContent() {
  const legacyContent = localStorage.getItem(LEGACY_CONTENT_STORAGE_KEY);
  const tab = createTab('Tab 1', legacyContent || '');
  const workspace = { tabs: [tab], activeTabId: tab.id };
  saveWorkspace(workspace);
  if (legacyContent !== null) {
    localStorage.removeItem(LEGACY_CONTENT_STORAGE_KEY);
  }
  return workspace;
}

export function getWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fall through to migration/default below
  }
  return migrateFromLegacyContent();
}

export function getActiveTab(workspace) {
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) || workspace.tabs[0];
}

export function addTab(workspace) {
  const tab = createTab(`Tab ${workspace.tabs.length + 1}`);
  return { tabs: [...workspace.tabs, tab], activeTabId: tab.id };
}

export function duplicateTab(workspace, tabId) {
  const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return workspace;
  }
  const source = workspace.tabs[index];
  const tab = createTab(`${source.name} copy`, source.content);
  const tabs = [...workspace.tabs];
  tabs.splice(index + 1, 0, tab);
  return { tabs, activeTabId: tab.id };
}

export function closeTab(workspace, tabId) {
  if (workspace.tabs.length <= 1) {
    return workspace;
  }
  const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return workspace;
  }
  const tabs = workspace.tabs.filter((tab) => tab.id !== tabId);
  if (workspace.activeTabId !== tabId) {
    return { tabs, activeTabId: workspace.activeTabId };
  }
  const newActiveIndex = Math.max(0, index - 1);
  return { tabs, activeTabId: tabs[newActiveIndex].id };
}

export function setActiveTab(workspace, tabId) {
  if (!workspace.tabs.some((tab) => tab.id === tabId)) {
    return workspace;
  }
  return { ...workspace, activeTabId: tabId };
}

export function updateTabContent(workspace, tabId, content) {
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) => (tab.id === tabId ? { ...tab, content } : tab)),
  };
}

export function renameTab(workspace, tabId, name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return workspace;
  }
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) => (tab.id === tabId ? { ...tab, name: trimmed } : tab)),
  };
}

export async function copyTabContentToClipboard(content) {
  await navigator.clipboard.writeText(content);
}
