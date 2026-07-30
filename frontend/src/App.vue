<template>
  <div class="layout">
    <nav class="sidebar">
      <div class="logo">Verity</div>
      <router-link to="/documents">文档管理</router-link>
      <router-link to="/metrics">知识库健康</router-link>
      <router-link to="/chat">对话测试</router-link>
    </nav>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; }
.layout { display: flex; height: 100vh; }
.sidebar {
  width: 200px; background: #1a1a2e; color: #fff;
  display: flex; flex-direction: column; padding: 24px 16px; gap: 8px;
}
.sidebar .logo { font-size: 20px; font-weight: 700; margin-bottom: 24px; }
.sidebar a {
  color: #ccc; text-decoration: none;
  padding: 8px 12px; border-radius: 6px;
}
.sidebar a:hover, .sidebar a.router-link-active {
  background: #16213e; color: #fff;
}
.content { flex: 1; overflow-y: auto; padding: 32px; }
</style>
