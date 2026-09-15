import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { IDBFactory } from 'fake-indexeddb';
import App from './App.vue';
import { useScanStore } from './stores/scan';
import { createScanDraftDb, draftLifetimeMs } from './services/scanDraftDb';
afterEach(() => vi.unstubAllGlobals());
it.each(['Resume scan', 'Discard draft'])(
  'offers recovery before mounting a screen: %s',
  async (choice) => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const db = createScanDraftDb(factory);
    await db.save(
      {
        version: 1,
        updatedAt: Date.now(),
        expiresAt: Date.now() + draftLifetimeMs,
        captureSequence: 4,
        cleanupEnabled: false,
        pages: [
          {
            id: 'saved-page',
            pageNumber: 1,
            capturePosition: 4,
            status: 'ready',
            rawText: 'raw',
            editedText: 'edited',
          },
        ],
      },
      new Map(),
      (await db.load()).revision,
    );
    const pinia = createPinia();
    const screen = { template: '<p>Document screen</p>' };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/scan', component: screen },
        { path: '/review', component: screen },
      ],
    });
    await router.push('/scan');
    const wrapper = mount(App, { global: { plugins: [pinia, router] } });
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Resume previous scan?'),
    );
    expect(wrapper.text()).not.toContain('Document screen');
    expect(useScanStore(pinia).pages).toHaveLength(0);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === choice)!
      .trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.text()).not.toContain('Resume previous scan?'),
    );
    await flushPromises();
    if (choice === 'Resume scan') {
      expect(useScanStore(pinia).pages[0]?.editedText).toBe('edited');
      expect(router.currentRoute.value.path).toBe('/review');
    } else {
      expect(useScanStore(pinia).pages).toHaveLength(0);
      expect((await db.load()).draft).toBeNull();
    }
    wrapper.unmount();
    await db.close();
  },
);
