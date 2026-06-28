<script setup lang="ts">
import type { GeoLocation } from '~~/shared/types'
// Display helpers (SIGN/POINT/pointLine/numList/point) are auto-imported from app/utils/astroDisplay.ts

const fullName = ref('')
const birthDate = ref('') // yyyy-mm-dd
const birthTime = ref('') // HH:MM
const cityQuery = ref('')
const focus = ref('')
const selected = ref<GeoLocation | null>(null)
const showDropdown = ref(false)

const geocode = useGeocode()
const interp = useInterpretation()

const origin = ref('')
const copied = ref(false)
onMounted(() => { origin.value = window.location.origin })
const shareUrl = computed(() =>
  interp.readingId.value ? `${origin.value}/r/${interp.readingId.value}` : '',
)
async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch { /* clipboard blocked — user can select manually */ }
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

const busy = computed(() => interp.status.value === 'loading' || interp.status.value === 'streaming')
const canSubmit = computed(
  () => !!birthDate.value && !!birthTime.value && !!selected.value && !busy.value,
)

function submit() {
  if (!canSubmit.value || !selected.value) return
  const [y, m, d] = birthDate.value.split('-').map(Number)
  const [hh, mm] = birthTime.value.split(':').map(Number)
  interp.generate({
    fullName: fullName.value || undefined,
    name: fullName.value || undefined,
    year: y!, month: m!, day: d!, hour: hh!, minute: mm!,
    latitude: selected.value.latitude,
    longitude: selected.value.longitude,
    timezone: selected.value.timezone,
    city: selected.value.display_name,
    focus: focus.value || undefined,
  })
}
</script>

<template>
  <main class="wrap">
    <header class="hero">
      <h1>✦ Астро-нумерология</h1>
      <p class="sub">Натальная карта, числа судьбы и живая интерпретация</p>
    </header>

    <!-- ФОРМА -->
    <section class="card form">
      <div class="row">
        <label class="field">
          <span>Имя (необязательно)</span>
          <input v-model="fullName" type="text" placeholder="Иван" />
        </label>
        <label class="field">
          <span>Дата рождения</span>
          <input v-model="birthDate" type="date" />
        </label>
        <label class="field">
          <span>Время рождения</span>
          <input v-model="birthTime" type="time" />
        </label>
      </div>

      <div class="row">
        <label class="field city">
          <span>Город рождения</span>
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
            <div v-if="geocode.loading.value" class="dd-item muted">
              <span class="spinner spinner-sm" /> Поиск…
            </div>
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
          <small v-if="selected" class="ok">✓ {{ selected.timezone }}, {{ selected.latitude.toFixed(3) }}, {{ selected.longitude.toFixed(3) }}</small>
        </label>
        <label class="field">
          <span>Фокус (необязательно)</span>
          <input v-model="focus" type="text" placeholder="карьера, отношения…" />
        </label>
      </div>

      <button class="primary" :disabled="!canSubmit" @click="submit">
        {{ busy ? 'Считаем…' : 'Построить разбор' }}
      </button>
      <p v-if="interp.status.value === 'error'" class="err">⚠ {{ interp.error.value }}</p>
    </section>

    <!-- РЕЗУЛЬТАТ -->
    <ReadingResult
      v-if="interp.meta.value"
      :chart="interp.meta.value.chart"
      :numerology="interp.meta.value.numerology"
      :interpretation="interp.text.value"
      :streaming="interp.status.value === 'streaming'"
    >
      <template #footer>
        <div v-if="interp.status.value === 'done' && interp.readingId.value" class="actions">
          <div class="feedback">
            <span class="muted">Как вам разбор?</span>
            <button class="fb" :class="{ active: interp.feedback.value === 1 }" @click="interp.sendFeedback(1)">👍</button>
            <button class="fb" :class="{ active: interp.feedback.value === -1 }" @click="interp.sendFeedback(-1)">👎</button>
          </div>
          <div class="share">
            <input :value="shareUrl" readonly @focus="(e) => (e.target as HTMLInputElement).select()" />
            <button class="copy" @click="copyShare">{{ copied ? 'Скопировано ✓' : 'Поделиться' }}</button>
          </div>
        </div>
      </template>
    </ReadingResult>
  </main>
</template>

<style scoped>
.wrap { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
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

.form .row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
.field { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 180px; position: relative; }
.field > span { font-size: 0.82rem; color: var(--text-dim); }
.field.city { min-width: 280px; flex: 2; }

input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
}
input:focus { border-color: var(--accent); }

/* Date/time picker icons: black by default — tint to a light lavender so they
   fit the palette yet stand out on the dark inputs. */
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

/* City input with inline loader */
.input-wrap { position: relative; }
.input-wrap input { width: 100%; }
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
/* top via calc (no translate) so the spin animation's transform stays free */
.input-wrap .spinner {
  position: absolute;
  right: 12px;
  top: calc(50% - 8px);
}
.spinner-sm {
  width: 13px;
  height: 13px;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  margin-top: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  max-height: 260px;
  overflow-y: auto;
}
.dd-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  font: inherit;
}
.dd-item:hover { background: var(--border); }
.dd-name { font-size: 0.9rem; }
.dd-tz { font-size: 0.75rem; color: var(--text-dim); }
.muted { color: var(--text-dim); }
.ok { color: #7ee0a0; font-size: 0.78rem; }

.primary {
  background: linear-gradient(135deg, var(--accent), #7c5cff);
  color: #160f2e;
  font-weight: 700;
  border: none;
  border-radius: 10px;
  padding: 0.8rem 1.4rem;
  font-size: 1rem;
  cursor: pointer;
}
.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.err { color: var(--danger); }

@media (max-width: 760px) { .form .row { flex-direction: column; } }

.actions {
  margin-top: 0;
  padding-top: 1.2rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}
.feedback { display: flex; align-items: center; gap: 0.5rem; }
.fb {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.4rem 0.7rem;
  font-size: 1.1rem;
  cursor: pointer;
}
.fb:hover { border-color: var(--accent); }
.fb.active { border-color: var(--accent); background: var(--border); }
.share { display: flex; gap: 0.5rem; flex: 1; min-width: 240px; max-width: 460px; }
.share input { flex: 1; font-size: 0.82rem; color: var(--text-dim); }
.copy {
  background: var(--bg-input);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 10px;
  padding: 0 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}
.copy:hover { background: var(--accent); color: #160f2e; }
</style>
