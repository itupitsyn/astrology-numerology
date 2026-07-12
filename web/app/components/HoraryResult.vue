<script setup lang="ts">
import type { HoraryChart } from '~~/shared/types'

const props = defineProps<{
  horary: HoraryChart
  interpretation: string
  streaming?: boolean
}>()
// point / sign / deg / pointLine / renderMarkdown from app/utils (auto-imported)
// VERDICT / PERFECTION_MODE_RU / dignitySummary / aspectPhrase from horaryDisplay

const j = computed(() => props.horary.judgment)
const verdict = computed(() => VERDICT[j.value.verdict])
const radFlags = computed(() => {
  const r = props.horary.radicality
  const out: string[] = []
  if (r.ascendant_too_early) out.push('Асцендент в ранних градусах (<3°) — вопрос, возможно, преждевременный')
  if (r.ascendant_too_late) out.push('Асцендент в поздних градусах (>27°) — дело, возможно, уже решено')
  if (r.moon_void_of_course) out.push('Луна без курса — признак «без развития»')
  if (r.moon_via_combusta) out.push('Луна в выжженном пути — суждение с осторожностью')
  if (r.saturn_in_first_or_seventh) out.push('Сатурн в 1-м или 7-м доме — предостережение')
  return out
})
</script>

<template>
  <section class="results">
    <!-- ВЕРДИКТ -->
    <div class="card verdict-card" :class="verdict.cls">
      <div class="verdict-badge">
        <span class="v-icon">{{ verdict.icon }}</span>
        <span class="v-label">{{ verdict.ru }}</span>
      </div>
      <div class="verdict-meta">
        <p class="question">«{{ horary.question }}»</p>
        <p class="sub">
          {{ horary.moment_local }} · {{ horary.timezone }} ·
          {{ horary.is_day_chart ? 'дневная карта' : 'ночная карта' }}
        </p>
        <p class="mode">
          {{ PERFECTION_MODE_RU[j.perfection_mode ?? 'none'] ?? j.perfection_mode }}
        </p>
      </div>
    </div>

    <div class="grid">
      <!-- СИГНИФИКАТОРЫ + СУЖДЕНИЕ -->
      <div class="card">
        <h2>Сигнификаторы</h2>
        <div class="sig">
          <div class="sig-role">Спрашивающий · {{ horary.querent.house }}-й дом</div>
          <div class="sig-body">
            <strong>{{ point(horary.querent.planet) }}</strong>
            {{ sign(horary.querent.sign).glyph }} {{ sign(horary.querent.sign).ru }}
            {{ deg(horary.querent.position) }}
            <span v-if="horary.querent.house_of_planet" class="dim">· {{ horary.querent.house_of_planet }} дом</span>
            <span v-if="horary.querent.retrograde" class="retro">· R</span>
          </div>
          <div class="sig-dign">{{ dignitySummary(horary.querent.dignity) }}
            <span class="score" :class="{ neg: horary.querent.dignity.score < 0 }">
              {{ horary.querent.dignity.score >= 0 ? '+' : '' }}{{ horary.querent.dignity.score }}
            </span>
          </div>
        </div>
        <div class="sig">
          <div class="sig-role">Предмет вопроса · {{ horary.quesited.house }}-й дом</div>
          <div class="sig-body">
            <strong>{{ point(horary.quesited.planet) }}</strong>
            {{ sign(horary.quesited.sign).glyph }} {{ sign(horary.quesited.sign).ru }}
            {{ deg(horary.quesited.position) }}
            <span v-if="horary.quesited.house_of_planet" class="dim">· {{ horary.quesited.house_of_planet }} дом</span>
            <span v-if="horary.quesited.retrograde" class="retro">· R</span>
          </div>
          <div class="sig-dign">{{ dignitySummary(horary.quesited.dignity) }}
            <span class="score" :class="{ neg: horary.quesited.dignity.score < 0 }">
              {{ horary.quesited.dignity.score >= 0 ? '+' : '' }}{{ horary.quesited.dignity.score }}
            </span>
          </div>
        </div>

        <details class="detail">
          <summary>Разбор карты</summary>
          <div class="detail-body">
            <p><strong>Луна:</strong>
              {{ horary.moon.void_of_course ? 'без курса' : 'в ходу' }}<template v-if="horary.moon.via_combusta">, в выжженном пути</template>.
              <template v-if="horary.moon.next_aspect"><br />Следующий аспект: {{ aspectPhrase(horary.moon.next_aspect) }}.</template>
              <template v-if="horary.moon.last_aspect"><br />Последний аспект: {{ aspectPhrase(horary.moon.last_aspect) }}.</template>
            </p>
            <p v-if="horary.receptions.mutual"><strong>Рецепция:</strong> взаимная — сильное содействие.</p>
            <p v-else-if="horary.receptions.p1_receives_p2.length || horary.receptions.p2_receives_p1.length">
              <strong>Рецепция:</strong> односторонняя.
            </p>
            <div v-if="radFlags.length" class="rad">
              <strong>Предостережения:</strong>
              <ul><li v-for="(f, i) in radFlags" :key="i">{{ f }}</li></ul>
            </div>
          </div>
        </details>
      </div>

      <!-- КАРТА -->
      <div class="card">
        <h2>Карта момента <span class="dim">Regiomontanus</span></h2>
        <div class="planets">
          <div v-for="p in horary.chart.axes" :key="p.name" class="prow axis">
            <span v-for="(seg, i) in pointLine(p)" :key="i" :class="['seg', i === 0 ? 'name' : '']">{{ seg }}</span>
          </div>
          <div v-for="p in horary.chart.planets" :key="p.name" class="prow">
            <span v-for="(seg, i) in pointLine(p)" :key="i" :class="['seg', i === 0 ? 'name' : '']">{{ seg }}</span>
          </div>
        </div>
        <details class="detail">
          <summary>Аспекты ({{ horary.chart.aspects.length }})</summary>
          <ul class="asp-list">
            <li v-for="(a, i) in horary.chart.aspects" :key="i">
              {{ point(a.p1_name) }} — {{ a.aspect }} — {{ point(a.p2_name) }} ({{ Math.abs(a.orbit).toFixed(1) }}°)
            </li>
          </ul>
        </details>
      </div>
    </div>

    <!-- ИНТЕРПРЕТАЦИЯ -->
    <div class="card interp">
      <h2>Толкование <span v-if="streaming" class="pulse">генерируется…</span></h2>
      <div v-if="interpretation" class="md" v-html="renderMarkdown(interpretation)" />
      <p v-else class="muted">Ждём первые строки…</p>
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.results { display: flex; flex-direction: column; gap: 1.25rem; }
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.4rem;
  box-shadow: 0 10px 40px -20px rgba(0, 0, 0, 0.7);
}
h2 { margin: 0 0 0.9rem; font-size: 1.15rem; }
.dim { color: var(--text-dim); font-weight: 400; font-size: 0.85rem; }
.muted { color: var(--text-dim); }

/* Verdict banner */
.verdict-card { display: flex; gap: 1.25rem; align-items: center; border-left-width: 4px; }
.verdict-badge { display: flex; flex-direction: column; align-items: center; min-width: 110px; }
.v-icon { font-size: 2.4rem; line-height: 1; }
.v-label { margin-top: 0.35rem; font-weight: 700; font-size: 0.95rem; text-align: center; }
.verdict-meta { flex: 1; }
.question { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.3rem; }
.verdict-meta .sub { color: var(--text-dim); font-size: 0.82rem; margin: 0 0 0.4rem; }
.verdict-meta .mode { margin: 0; font-size: 0.9rem; }
.v-yes { border-left-color: #34d399; }
.v-yes .v-icon, .v-yes .v-label { color: #34d399; }
.v-no { border-left-color: var(--danger); }
.v-no .v-icon, .v-no .v-label { color: var(--danger); }
.v-maybe { border-left-color: #fbbf24; }
.v-maybe .v-icon, .v-maybe .v-label { color: #fbbf24; }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

.sig { padding: 0.5rem 0; border-bottom: 1px dashed var(--border); }
.sig-role { font-size: 0.78rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.sig-body { margin: 0.2rem 0; }
.sig-body strong { color: var(--accent); }
.retro { color: var(--accent-2); }
.sig-dign { font-size: 0.85rem; color: var(--text-dim); }
.score { color: #34d399; font-weight: 700; }
.score.neg { color: var(--danger); }

.detail { margin-top: 0.9rem; }
.detail summary { cursor: pointer; color: var(--text-dim); }
.detail-body { margin-top: 0.6rem; font-size: 0.88rem; color: var(--text-dim); }
.detail-body p { margin: 0.4rem 0; }
.rad ul { margin: 0.3rem 0 0; padding-left: 1.2rem; }
.rad li { margin: 0.2rem 0; }

.planets { display: flex; flex-direction: column; gap: 0.3rem; }
.prow { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; padding: 0.25rem 0; border-bottom: 1px dashed var(--border); }
.prow.axis { color: var(--accent-2); }
.seg { font-size: 0.9rem; color: var(--text-dim); }
.seg.name { min-width: 110px; color: var(--text); font-weight: 600; }
.asp-list { max-height: 240px; overflow-y: auto; font-size: 0.85rem; color: var(--text-dim); margin: 0.4rem 0 0; }

.interp .pulse { font-size: 0.8rem; color: var(--accent); font-weight: 400; animation: blink 1.2s infinite; }
@keyframes blink { 50% { opacity: 0.4; } }
.md :deep(h2) { font-size: 1.1rem; margin: 1.2rem 0 0.5rem; color: var(--accent); }
.md :deep(h3) { font-size: 1rem; margin: 1rem 0 0.4rem; color: var(--accent-2); }
.md :deep(p) { margin: 0.5rem 0; }
.md :deep(ul), .md :deep(ol) { margin: 0.5rem 0; padding-left: 1.4rem; }
.md :deep(li) { margin: 0.25rem 0; }
.md :deep(strong) { color: var(--text); }
</style>
