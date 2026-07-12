<script setup lang="ts">
import type { GeoLocation } from '~~/shared/types'
import { HORARY_CATEGORIES, categoryById } from '~~/shared/horary'

const question = ref('')
const categoryId = ref<string>('')
const askNow = ref(true)
const askDate = ref('') // yyyy-mm-dd
const askTime = ref('') // HH:MM
const cityQuery = ref('')
const selected = ref<GeoLocation | null>(null)
const showDropdown = ref(false)

const geocode = useGeocode()
const horary = useHorary()

const origin = ref('')
const copied = ref(false)
onMounted(() => { origin.value = window.location.origin })
const shareUrl = computed(() =>
  horary.horaryId.value ? `${origin.value}/h/${horary.horaryId.value}` : '',
)
async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch { /* clipboard blocked */ }
}

const selectedHint = computed(() => categoryById(categoryId.value)?.hint ?? '')

// Suggest a category from the question text (LLM classifies into our list).
const suggesting = ref(false)
const suggestError = ref('')
const suggestedNote = ref('')
async function suggestCategory() {
  const q = question.value.trim()
  if (!q || suggesting.value) return
  suggesting.value = true
  suggestError.value = ''
  suggestedNote.value = ''
  try {
    const { categoryId: id } = await $fetch<{ categoryId: string | null }>(
      '/api/horary/suggest-category',
      { method: 'POST', body: { question: q } },
    )
    const cat = id ? categoryById(id) : undefined
    if (cat) {
      categoryId.value = cat.id
      suggestedNote.value = `Тема подобрана: ${cat.label}. При необходимости поправьте вручную.`
    } else {
      suggestError.value = 'Не удалось определить тему — выберите вручную.'
    }
  } catch {
    suggestError.value = 'Не удалось подобрать тему — попробуйте ещё раз.'
  } finally {
    suggesting.value = false
  }
}

function onCityInput() {
  selected.value = null
  showDropdown.value = true
  geocode.search(cityQuery.value)
}
function pickCity(loc: GeoLocation) {
  selected.value = loc
  cityQuery.value = loc.display_name
  showDropdown.value = false
  geocode.clear()
}
function hideDropdownSoon() {
  setTimeout(() => (showDropdown.value = false), 150)
}

const busy = computed(() => horary.status.value === 'loading' || horary.status.value === 'streaming')
const canSubmit = computed(() =>
  question.value.trim().length > 0 &&
  !!categoryId.value &&
  !!selected.value &&
  (askNow.value || (!!askDate.value && !!askTime.value)) &&
  !busy.value,
)

function submit() {
  if (!canSubmit.value || !selected.value) return
  const payload: Parameters<typeof horary.ask>[0] = {
    question: question.value.trim(),
    category: categoryId.value,
    askNow: askNow.value,
    latitude: selected.value.latitude,
    longitude: selected.value.longitude,
    timezone: selected.value.timezone,
    city: selected.value.display_name,
  }
  if (!askNow.value) {
    const [y, m, d] = askDate.value.split('-').map(Number)
    const [hh, mm] = askTime.value.split(':').map(Number)
    Object.assign(payload, { year: y, month: m, day: d, hour: hh, minute: mm })
  }
  horary.ask(payload)
}
</script>

<template>
  <main class="wrap">
    <header class="hero">
      <h1>☽ Хорарный вопрос</h1>
      <p class="sub">Ответ на конкретный вопрос по карте момента (традиция У. Лилли)</p>
    </header>

    <section class="card form">
      <label class="field">
        <span>Ваш вопрос</span>
        <textarea
          v-model="question"
          rows="2"
          placeholder="Например: получу ли я эту работу?"
        />
      </label>
      <div class="suggest-row">
        <button type="button" class="suggest" :disabled="!question.trim() || suggesting" @click="suggestCategory">
          <span v-if="suggesting" class="spinner spinner-sm" />
          {{ suggesting ? 'Подбираем…' : '✨ Подобрать тему по вопросу' }}
        </button>
        <small v-if="suggestError" class="suggest-note err">{{ suggestError }}</small>
        <small v-else-if="suggestedNote" class="suggest-note ok">{{ suggestedNote }}</small>
      </div>

      <div class="row">
        <label class="field">
          <span>О чём вопрос</span>
          <select v-model="categoryId">
            <option value="" disabled>Выберите тему…</option>
            <option v-for="c in HORARY_CATEGORIES" :key="c.id" :value="c.id">
              {{ c.label }} · {{ c.house }}-й дом
            </option>
          </select>
          <small v-if="selectedHint" class="hint">{{ selectedHint }}</small>
        </label>

        <label class="field city">
          <span>Где задаётся вопрос</span>
          <div class="input-wrap">
            <input
              v-model="cityQuery"
              type="text"
              placeholder="Начните вводить город…"
              autocomplete="off"
              @input="onCityInput"
              @focus="showDropdown = geocode.results.value.length > 0"
              @blur="hideDropdownSoon"
            />
            <span v-if="geocode.loading.value" class="spinner" aria-label="Поиск города" />
          </div>
          <div v-if="showDropdown && (geocode.loading.value || geocode.results.value.length)" class="dropdown">
            <div v-if="geocode.loading.value" class="dd-item muted"><span class="spinner spinner-sm" /> Поиск…</div>
            <button
              v-for="loc in geocode.results.value"
              :key="loc.display_name"
              type="button"
              class="dd-item"
              @mousedown.prevent="pickCity(loc)"
            >
              <span class="dd-name">{{ loc.display_name }}</span>
              <span class="dd-tz">{{ loc.timezone }}</span>
            </button>
          </div>
          <small v-if="selected" class="ok">✓ {{ selected.timezone }}</small>
        </label>
      </div>

      <div class="row moment">
        <label class="check">
          <input v-model="askNow" type="checkbox" />
          <span>Задать вопрос прямо сейчас</span>
        </label>
        <template v-if="!askNow">
          <label class="field">
            <span>Дата вопроса</span>
            <input v-model="askDate" type="date" />
          </label>
          <label class="field">
            <span>Время вопроса</span>
            <input v-model="askTime" type="time" />
          </label>
        </template>
      </div>

      <button class="primary" :disabled="!canSubmit" @click="submit">
        {{ busy ? 'Строим карту…' : 'Получить ответ' }}
      </button>
      <p v-if="horary.status.value === 'error'" class="err">⚠ {{ horary.error.value }}</p>
    </section>

    <HoraryResult
      v-if="horary.meta.value"
      :horary="horary.meta.value.horary"
      :interpretation="horary.text.value"
      :streaming="horary.status.value === 'streaming'"
    >
      <template #footer>
        <div v-if="horary.status.value === 'done' && horary.horaryId.value" class="actions">
          <div class="feedback">
            <span class="muted">Точный ответ?</span>
            <button class="fb" :class="{ active: horary.feedback.value === 1 }" @click="horary.sendFeedback(1)">👍</button>
            <button class="fb" :class="{ active: horary.feedback.value === -1 }" @click="horary.sendFeedback(-1)">👎</button>
          </div>
          <div class="share">
            <input :value="shareUrl" readonly @focus="(e) => (e.target as HTMLInputElement).select()" />
            <button class="copy" @click="copyShare">{{ copied ? 'Скопировано ✓' : 'Поделиться' }}</button>
          </div>
        </div>
      </template>
    </HoraryResult>

    <NuxtLink to="/" class="back">← К натальному разбору</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { width: 100%; max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 5rem; flex-grow: 1; }
.hero { text-align: center; margin-bottom: 1.75rem; }
.hero h1 { margin: 0; font-size: 2rem; }
.sub { color: var(--text-dim); margin: 0.35rem 0 0; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.4rem;
  box-shadow: 0 10px 40px -20px rgba(0, 0, 0, 0.7);
}
.form .row { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; align-items: flex-start; }
.field { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 200px; position: relative; }
.field > span { font-size: 0.82rem; color: var(--text-dim); }
.field.city { min-width: 280px; flex: 1.4; }

input, textarea, select {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  font-family: inherit;
}
input:focus, textarea:focus, select:focus { border-color: var(--accent); }
textarea { resize: vertical; }

/* Date/time picker icons: black by default — tint to light lavender so they
   fit the palette yet stand out on the dark inputs (matches the natal form). */
input[type="date"]::-webkit-calendar-picker-indicator,
input[type="time"]::-webkit-calendar-picker-indicator {
  filter: invert(72%) sepia(38%) saturate(900%) hue-rotate(216deg) brightness(102%);
  opacity: 0.85;
  cursor: pointer;
}
input[type="date"]::-webkit-calendar-picker-indicator:hover,
input[type="time"]::-webkit-calendar-picker-indicator:hover {
  filter: invert(80%) sepia(60%) saturate(1200%) hue-rotate(210deg) brightness(110%);
  opacity: 1;
}
.hint { color: var(--text-dim); font-size: 0.78rem; }

.suggest-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-top: 0.55rem; }
.suggest {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg-input);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 10px;
  padding: 0.45rem 0.85rem;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.suggest:hover:not(:disabled) { background: var(--accent); color: #160f2e; }
.suggest:disabled { opacity: 0.45; cursor: not-allowed; }
.suggest-note { font-size: 0.78rem; }
.suggest-note.ok { color: #7ee0a0; }
.suggest-note.err { color: var(--danger); }

.moment { align-items: center; }
.check { display: flex; align-items: center; gap: 0.55rem; color: var(--text); font-size: 0.9rem; cursor: pointer; user-select: none; }
.check input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  flex: none;
  width: 15px;
  height: 15px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s, background 0.15s;
}
.check input[type="checkbox"]:hover { border-color: var(--accent); }
.check input[type="checkbox"]:checked {
  background: linear-gradient(135deg, var(--accent), #7c5cff);
  border-color: var(--accent);
}
.check input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 44%;
  width: 3.5px;
  height: 7px;
  border: solid #160f2e;
  border-width: 0 2px 2px 0;
  transform: translate(-50%, -50%) rotate(45deg);
}
.check input[type="checkbox"]:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(179, 136, 255, 0.3);
}

.input-wrap { position: relative; }
.input-wrap input { width: 100%; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
.input-wrap .spinner { position: absolute; right: 12px; top: calc(50% - 8px); }
.spinner-sm { width: 13px; height: 13px; vertical-align: middle; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }

.dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 10; margin-top: 4px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; max-height: 260px; overflow-y: auto; }
.dd-item { display: flex; flex-direction: column; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid var(--border); color: var(--text); padding: 0.55rem 0.75rem; cursor: pointer; font: inherit; }
.dd-item:hover { background: var(--border); }
.dd-name { font-size: 0.9rem; }
.dd-tz { font-size: 0.75rem; color: var(--text-dim); }
.muted { color: var(--text-dim); }
.ok { color: #7ee0a0; font-size: 0.78rem; }

.primary { margin-top: 1.2rem; background: linear-gradient(135deg, var(--accent), #7c5cff); color: #160f2e; font-weight: 700; border: none; border-radius: 10px; padding: 0.8rem 1.4rem; font-size: 1rem; cursor: pointer; }
.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.err { color: var(--danger); }

.actions { padding-top: 1.2rem; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
.feedback { display: flex; align-items: center; gap: 0.5rem; }
.fb { background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; padding: 0.4rem 0.7rem; font-size: 1.1rem; cursor: pointer; }
.fb:hover { border-color: var(--accent); }
.fb.active { border-color: var(--accent); background: var(--border); }
.share { display: flex; gap: 0.5rem; flex: 1; min-width: 240px; max-width: 460px; }
.share input { flex: 1; font-size: 0.82rem; color: var(--text-dim); }
.copy { background: var(--bg-input); border: 1px solid var(--accent); color: var(--accent); border-radius: 10px; padding: 0 0.9rem; cursor: pointer; white-space: nowrap; }
.copy:hover { background: var(--accent); color: #160f2e; }

.back { display: inline-block; margin-top: 1.5rem; color: var(--accent); text-decoration: none; }
.back:hover { text-decoration: underline; }
@media (max-width: 760px) { .form .row { flex-direction: column; } }
</style>
