<template>
  <div>
    <h2 style="margin-bottom:24px">知识库健康</h2>
    <div class="cards">
      <div class="card">
        <div class="card-label">文档总数</div>
        <div class="card-value">{{ data.doc_count ?? '—' }}</div>
      </div>
      <div class="card">
        <div class="card-label">Chunk 总数</div>
        <div class="card-value">{{ data.chunk_count ?? '—' }}</div>
      </div>
      <div class="card">
        <div class="card-label">语义缓存命中率</div>
        <div class="card-value">{{ data.cache_hit_rate != null ? (data.cache_hit_rate * 100).toFixed(1) + '%' : '—' }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getMetrics } from '@/api'

const data = ref({})
onMounted(async () => { data.value = await getMetrics() })
</script>

<style scoped>
.cards { display: flex; gap: 16px; }
.card {
  background: #fff; border-radius: 8px; padding: 24px 32px;
  min-width: 160px; box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.card-label { color: #666; font-size: 13px; margin-bottom: 8px; }
.card-value { font-size: 32px; font-weight: 700; color: #1a1a2e; }
</style>
