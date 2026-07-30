<template>
  <div class="chat">
    <h2 style="margin-bottom:24px">对话测试</h2>
    <div class="messages" ref="msgBox">
      <div v-for="(m, i) in messages" :key="i" :class="'msg msg-' + m.role">
        <div class="bubble">{{ m.content }}</div>
      </div>
    </div>
    <div class="input-row">
      <input
        v-model="input"
        placeholder="输入问题..."
        @keydown.enter="send"
        :disabled="loading"
      />
      <button @click="send" :disabled="loading || !input.trim()">发送</button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const messages = ref([])
const input = ref('')
const loading = ref(false)
const msgBox = ref(null)
const sessionId = `test_${Date.now()}`

async function send() {
  const q = input.value.trim()
  if (!q) return
  messages.value.push({ role: 'user', content: q })
  input.value = ''
  loading.value = true

  const resp = await fetch('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message: q, stream: true })
  })

  const botMsg = { role: 'assistant', content: '' }
  messages.value.push(botMsg)

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') break
      botMsg.content += payload
      await nextTick()
      msgBox.value?.scrollTo(0, msgBox.value.scrollHeight)
    }
  }
  loading.value = false
}
</script>

<style scoped>
.chat { display: flex; flex-direction: column; height: calc(100vh - 96px); }
.messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 16px; }
.msg { display: flex; }
.msg-user { justify-content: flex-end; }
.msg-assistant { justify-content: flex-start; }
.bubble {
  max-width: 70%; padding: 10px 16px; border-radius: 12px;
  white-space: pre-wrap; line-height: 1.6;
}
.msg-user .bubble { background: #1a1a2e; color: #fff; border-bottom-right-radius: 4px; }
.msg-assistant .bubble { background: #fff; color: #111; border-bottom-left-radius: 4px; }
.input-row { display: flex; gap: 8px; }
.input-row input {
  flex: 1; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px;
}
.input-row button {
  padding: 10px 20px; background: #1a1a2e; color: #fff; border: none; border-radius: 8px; cursor: pointer;
}
.input-row button:disabled { opacity: .4; cursor: default; }
</style>
