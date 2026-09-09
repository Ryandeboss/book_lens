import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeView from './HomeView.vue';

afterEach(() => vi.unstubAllGlobals());
describe('Home', () => {
  it('connects to the API and links to scanning', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', service: 'booklens-api' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: HomeView },
        { path: '/scan', component: { template: '<p>Scan</p>' } },
      ],
    });
    await router.push('/');
    const wrapper = mount(HomeView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('API connected');
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/health$/);
    await wrapper.get('a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/scan');
    wrapper.unmount();
  });
  it('shows an unobtrusive unavailable status on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const wrapper = mount(HomeView, {
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('API unavailable');
    wrapper.unmount();
  });
});
