<script setup lang="ts">
import type { NatalChart, NumerologyResult } from '~~/shared/types'

defineProps<{
  chart: NatalChart
  numerology: NumerologyResult
  interpretation: string
  streaming?: boolean
}>()
// pointLine / point / numList / renderMarkdown are auto-imported from app/utils
</script>

<template>
  <section class="results">
    <div class="grid">
      <!-- Карта -->
      <div class="card">
        <h2>Натальная карта</h2>
        <div class="planets">
          <div v-for="p in chart.axes" :key="p.name" class="prow axis">
            <span v-for="(seg, i) in pointLine(p)" :key="i" :class="['seg', i === 0 ? 'name' : '']">{{ seg }}</span>
          </div>
          <div v-for="p in chart.planets" :key="p.name" class="prow">
            <span v-for="(seg, i) in pointLine(p)" :key="i" :class="['seg', i === 0 ? 'name' : '']">{{ seg }}</span>
          </div>
        </div>
        <p v-if="chart.lunar_phase.moon_phase_name" class="moon">
          🌙 Фаза Луны: {{ chart.lunar_phase.moon_phase_name }}
        </p>
        <details class="aspects">
          <summary>Аспекты ({{ chart.aspects.length }})</summary>
          <ul>
            <li v-for="(a, i) in chart.aspects" :key="i">
              {{ point(a.p1_name) }} — {{ a.aspect }} — {{ point(a.p2_name) }} ({{ Math.abs(a.orbit).toFixed(1) }}°)
            </li>
          </ul>
        </details>
      </div>

      <!-- Числа -->
      <div class="card">
        <h2>Нумерология</h2>
        <div class="numbers">
          <div v-for="item in numList(numerology)" :key="item.label" class="num">
            <div class="num-val" :class="{ master: item.n.isMaster }">{{ item.n.value }}</div>
            <div class="num-label">{{ item.label }}</div>
            <div v-if="item.n.isMaster" class="num-master">мастер</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Интерпретация -->
    <div class="card interp">
      <h2>
        Интерпретация
        <span v-if="streaming" class="pulse">генерируется…</span>
      </h2>
      <div v-if="interpretation" class="md" v-html="renderMarkdown(interpretation)" />
      <p v-else class="muted">Ждём первые строки…</p>
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.results { display: flex; flex-direction: column; gap: 1.25rem; }
.grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 1.25rem; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.4rem;
  box-shadow: 0 10px 40px -20px rgba(0, 0, 0, 0.7);
}
h2 { margin: 0 0 0.9rem; font-size: 1.15rem; }
.muted { color: var(--text-dim); }

.planets { display: flex; flex-direction: column; gap: 0.3rem; }
.prow { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; padding: 0.25rem 0; border-bottom: 1px dashed var(--border); }
.prow.axis { color: var(--accent-2); }
.seg { font-size: 0.9rem; color: var(--text-dim); }
.seg.name { min-width: 110px; color: var(--text); font-weight: 600; }
.moon { color: var(--accent-2); margin-top: 0.8rem; }
.aspects { margin-top: 0.8rem; }
.aspects summary { cursor: pointer; color: var(--text-dim); }
.aspects ul { max-height: 240px; overflow-y: auto; font-size: 0.85rem; color: var(--text-dim); }

.numbers { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.8rem; }
.num { background: var(--bg-input); border: 1px solid var(--border); border-radius: 12px; padding: 0.9rem; text-align: center; }
.num-val { font-size: 2rem; font-weight: 800; color: var(--accent); }
.num-val.master { color: var(--accent-2); }
.num-label { font-size: 0.8rem; color: var(--text-dim); }
.num-master { font-size: 0.68rem; color: var(--accent-2); text-transform: uppercase; letter-spacing: 0.05em; }

.interp .pulse { font-size: 0.8rem; color: var(--accent); font-weight: 400; animation: blink 1.2s infinite; }
@keyframes blink { 50% { opacity: 0.4; } }
.md :deep(h2) { font-size: 1.1rem; margin: 1.2rem 0 0.5rem; color: var(--accent); }
.md :deep(h3) { font-size: 1rem; margin: 1rem 0 0.4rem; color: var(--accent-2); }
.md :deep(p) { margin: 0.5rem 0; }
.md :deep(ul), .md :deep(ol) { margin: 0.5rem 0; padding-left: 1.4rem; }
.md :deep(li) { margin: 0.25rem 0; }
.md :deep(strong) { color: var(--text); }
</style>
