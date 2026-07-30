import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',          redirect: '/documents' },
    { path: '/documents', component: () => import('./views/Documents.vue') },
    { path: '/metrics',   component: () => import('./views/Metrics.vue') },
    { path: '/chat',      component: () => import('./views/ChatTest.vue') },
  ]
})
