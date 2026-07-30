import axios from 'axios'

const http = axios.create({ baseURL: '/' })

export const listDocuments = () =>
  http.get('/api/ops/documents').then(r => r.data)

export const disableDocument = (docId) =>
  http.post(`/api/ops/documents/${docId}/disable`).then(r => r.data)

export const getMetrics = () =>
  http.get('/api/ops/metrics').then(r => r.data)

export const uploadDocument = (formData, onProgress) =>
  http.post('/api/pipeline/ingest', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round(e.loaded / e.total * 100))
  }).then(r => r.data)
