<script setup lang="ts">
import type { NatalChart, NumerologyResult } from '~~/shared/types'

interface SharedReading {
  id: string
  createdAt: string
  chart: NatalChart
  numerology: NumerologyResult
  interpretation: string
  targetYear: number | null
  focus: string | null
  model: string | null
}

const route = useRoute()
const { data, error } = await useFetch<SharedReading>(`/api/readings/${route.params.id}`)
</script>

<template>
  <main class="wrap">
    <header class="hero">
      <h1>✦ Астро-нумерология</h1>
      <p class="sub">Разбор по натальной карте</p>
    </header>

    <div v-if="error" class="card err">Разбор не найден или был удалён.</div>
    <ReadingResult
      v-else-if="data"
      :chart="data.chart"
      :numerology="data.numerology"
      :interpretation="data.interpretation"
    />

    <NuxtLink to="/" class="back">← Построить свой разбор</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 5rem; flex-grow: 1; }
.hero { text-align: center; margin-bottom: 1.75rem; }
.hero h1 { margin: 0; font-size: 2rem; }
.sub { color: var(--text-dim); margin: 0.35rem 0 0; }
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.4rem;
}
.err { color: var(--danger); }
.back { display: inline-block; margin-top: 1.5rem; color: var(--accent); text-decoration: none; }
.back:hover { text-decoration: underline; }
</style>
