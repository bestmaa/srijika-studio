import { beforeEach, describe, expect, it } from 'vitest';

import { createBlankDocument } from '@sutra/contracts';
import { validateDocumentGraph } from '@sutra/document-engine';

import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function activePage() {
  const state = useStudioStore.getState();
  const page = state.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) throw new Error('Expected an active page');
  return page;
}

describe('canonical multi-page Studio state', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('starts with one blank canonical Home Page locked to a 100% root surface', () => {
    const state = useStudioStore.getState();
    const page = activePage();
    const root = state.document.nodes[state.document.rootNodeId];

    expect(state.pages).toHaveLength(1);
    expect(page).toMatchObject({
      id: 'page_home',
      name: 'Home Page',
      functionName: 'HomePage',
      width: 100,
      height: 100,
      locked: true,
    });
    expect(page.document).toBe(state.document);
    expect(Object.keys(state.document.nodes)).toEqual([state.document.rootNodeId]);
    expect(root).toMatchObject({
      kind: 'element',
      componentId: 'sutra.page',
      style: {
        base: {
          width: { mode: 'percent', value: 100 },
          height: { mode: 'percent', value: 100 },
        },
      },
    });
    expect(validateDocumentGraph(state.document)).toEqual([]);
  });

  it('isolates documents and restores each page selection and active condition branch', () => {
    const store = useStudioStore.getState();
    const homePageId = store.selectedPageId;
    const containerId = store.addComponent('sutra.container');
    const conditionId = useStudioStore.getState().addIfNode();
    if (!containerId || !conditionId) throw new Error('Expected Home Page nodes');
    useStudioStore.getState().setActiveIfBranch(conditionId, 'whenFalse');
    useStudioStore.getState().selectNode(containerId);

    const dashboardPageId = useStudioStore.getState().createPage('Dashboard Page');
    if (!dashboardPageId) throw new Error('Expected Dashboard Page');
    const textId = useStudioStore.getState().addComponent('sutra.text');
    if (!textId) throw new Error('Expected Dashboard text');
    useStudioStore.getState().setLiteralProp(textId, 'text', 'Dashboard only');

    useStudioStore.getState().selectPage(homePageId);
    let state = useStudioStore.getState();
    expect(state.document.nodes[containerId]).toBeDefined();
    expect(state.document.nodes[conditionId]).toBeDefined();
    expect(state.document.nodes[textId]).toBeUndefined();
    expect(state.selectedNodeId).toBe(containerId);
    expect(state.activeIfBranches[conditionId]).toBe('whenFalse');
    expect(activePage().document).toBe(state.document);

    state.selectPage(dashboardPageId);
    state = useStudioStore.getState();
    expect(state.document.nodes[textId]).toMatchObject({
      kind: 'element',
      props: { text: { kind: 'literal', value: 'Dashboard only' } },
    });
    expect(state.document.nodes[containerId]).toBeUndefined();
    expect(state.selectedNodeId).toBe(textId);
    expect(state.activeIfBranches).toEqual({});
    expect(activePage().document).toBe(state.document);
  });

  it('keeps undo and redo histories independent per page', () => {
    const homePageId = useStudioStore.getState().selectedPageId;
    const homeContainerId = useStudioStore.getState().addComponent('sutra.container');
    if (!homeContainerId) throw new Error('Expected Home Page container');

    const dashboardPageId = useStudioStore.getState().createPage('Dashboard Page');
    if (!dashboardPageId) throw new Error('Expected Dashboard Page');
    const dashboardTextId = useStudioStore.getState().addComponent('sutra.text');
    if (!dashboardTextId) throw new Error('Expected Dashboard text');

    useStudioStore.getState().undo();
    expect(useStudioStore.getState().document.nodes[dashboardTextId]).toBeUndefined();

    useStudioStore.getState().selectPage(homePageId);
    expect(useStudioStore.getState().document.nodes[homeContainerId]).toBeDefined();
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().document.nodes[homeContainerId]).toBeUndefined();
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().document.nodes[homeContainerId]).toBeDefined();

    useStudioStore.getState().selectPage(dashboardPageId);
    expect(useStudioStore.getState().document.nodes[dashboardTextId]).toBeUndefined();
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().document.nodes[dashboardTextId]).toBeDefined();
  });

  it('synchronizes rename and import with the active page wrapper', () => {
    const homePageId = useStudioStore.getState().selectedPageId;
    const dashboardPageId = useStudioStore.getState().createPage('Dashboard Page');
    if (!dashboardPageId) throw new Error('Expected Dashboard Page');

    useStudioStore.getState().renamePage(homePageId, 'Landing Page');
    const renamedHome = useStudioStore.getState().pages.find((page) => page.id === homePageId);
    expect(renamedHome).toMatchObject({ name: 'Landing Page', functionName: 'LandingPage' });
    expect(renamedHome?.document.name).toBe('Landing Page');

    const imported = createBlankDocument('external_page', 'Imported Page');
    expect(useStudioStore.getState().loadDocument(imported)).toBe(true);
    const state = useStudioStore.getState();
    expect(state.selectedPageId).toBe(dashboardPageId);
    expect(state.document.id).toBe(dashboardPageId);
    expect(state.document.name).toBe('Imported Page');
    expect(activePage()).toMatchObject({
      id: dashboardPageId,
      name: 'Imported Page',
      functionName: 'ImportedPage',
    });
    expect(activePage().document).toBe(state.document);
  });

  it('rejects a replacement command that would change the active page identity', () => {
    const state = useStudioStore.getState();
    const original = state.document;
    const foreign = createBlankDocument('foreign_page', 'Foreign Page');

    expect(state.dispatch({ kind: 'replaceDocument', document: foreign })).toBe(false);
    expect(useStudioStore.getState().document).toBe(original);
    expect(activePage().document).toBe(original);
    expect(useStudioStore.getState().notice?.message).toContain(
      'A replacement document must target the active page',
    );
  });

  it('resets only the active document to the starter demo while resetProject stays blank', () => {
    const homePageId = useStudioStore.getState().selectedPageId;
    const dashboardPageId = useStudioStore.getState().createPage('Dashboard Page');
    if (!dashboardPageId) throw new Error('Expected Dashboard Page');

    useStudioStore.getState().resetDocument();
    expect(useStudioStore.getState().document.nodes['hero']).toBeDefined();
    expect(activePage().document).toBe(useStudioStore.getState().document);

    useStudioStore.getState().selectPage(homePageId);
    expect(Object.keys(useStudioStore.getState().document.nodes)).toEqual(['root']);

    useStudioStore.getState().resetProject();
    expect(useStudioStore.getState().pages).toHaveLength(1);
    expect(useStudioStore.getState().selectedPageId).toBe('page_home');
    expect(Object.keys(useStudioStore.getState().document.nodes)).toEqual(['root']);
  });
});
