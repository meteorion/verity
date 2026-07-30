<template>
  <div>
    <div class="page-header">
      <h2>文档管理</h2>
      <label class="btn-upload">
        上传文档
        <input type="file" hidden accept=".pdf,.docx,.md" @change="handleUpload" />
      </label>
    </div>

    <div v-if="uploading" class="progress-bar">
      <div :style="{ width: progress + '%' }"></div>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>文档 ID</th><th>标题</th><th>业务线</th><th>状态</th><th>更新时间</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="doc in docs" :key="doc.doc_id">
          <td>{{ doc.doc_id }}</td>
          <td>{{ doc.title }}</td>
          <td>{{ doc.business_line }}</td>
          <td><span :class="'status-' + doc.status">{{ doc.status }}</span></td>
          <td>{{ doc.updated_at }}</td>
          <td>
            <button v-if="doc.status === 'active'" @click="disable(doc.doc_id)">下架</button>
          </td>
        </tr>
        <tr v-if="!docs.length">
          <td colspan="6" style="text-align:center;color:#999">暂无文档</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { listDocuments, disableDocument, uploadDocument } from '@/api'

const docs = ref([])
const uploading = ref(false)
const progress = ref(0)

onMounted(async () => { docs.value = (await listDocuments()).documents })

async function disable(docId) {
  await disableDocument(docId)
  docs.value = (await listDocuments()).documents
}

async function handleUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  fd.append('doc_id', `doc_${Date.now()}`)
  fd.append('owner', 'ops')
  uploading.value = true
  await uploadDocument(fd, p => { progress.value = p })
  uploading.value = false
  docs.value = (await listDocuments()).documents
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.btn-upload { padding: 8px 16px; background: #1a1a2e; color: #fff; border-radius: 6px; cursor: pointer; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
.table th, .table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
.table th { background: #f9f9f9; font-weight: 600; }
.status-active { color: #16a34a; } .status-rejected { color: #dc2626; }
.progress-bar { height: 4px; background: #eee; border-radius: 2px; margin-bottom: 16px; }
.progress-bar div { height: 100%; background: #1a1a2e; border-radius: 2px; transition: width .3s; }
button { padding: 4px 10px; border: 1px solid #dc2626; color: #dc2626; background: none; border-radius: 4px; cursor: pointer; }
</style>
