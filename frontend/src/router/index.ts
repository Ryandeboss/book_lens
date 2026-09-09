import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/scan', component: () => import('../views/ScanView.vue') },
    { path: '/review', component: () => import('../views/ReviewView.vue') },
    { path: '/library', component: () => import('../views/LibraryView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
