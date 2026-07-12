<script setup lang="ts">
import type { HoraryChart } from '~~/shared/types'

interface SharedHorary {
  id: string
  createdAt: string
  question: string
  verdict: string
  horary: HoraryChart
  interpretation: string
  model: string | null
}

const route = useRoute()
const { data, error } = await useFetch<SharedHorary>(`/api/horary/${route.params.id}`)
</script>

<template>
  <main class="wrap">
    <header class="hero">
      <h1>☽ Хорарный ответ</h1>
      <p class="sub">Суждение по карте момента вопроса</p>
    </header>

    <div v-if="error" class="card err">Разбор не найден или был удалён.</div>
    <HoraryResult
      v-else-if="data"
      :horary="data.horary"
      :interpretation="data.interpretation"
    />

    <NuxtLink to="/horary" class="back">← Задать свой вопрос</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
.hero { text-align: center; margin-bottom: 1.75rem; }
.hero h1 { margin: 0; font-size: 2rem; }
.sub { color: var(--text-dim); margin: 0.35rem 0 0; }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem 1.4rem; }
.err { color: var(--danger); }
.back { display: inline-block; margin-top: 1.5rem; color: var(--accent); text-decoration: none; }
.back:hover { text-decoration: underline; }
</style>
