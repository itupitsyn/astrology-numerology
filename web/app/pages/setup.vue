<script setup lang="ts">
/**
 * /setup — the once-only questionnaire behind the daily forecast.
 *
 * Opened as a Telegram Mini App: identity comes from the signed `initData`, so
 * the page never sends a user id of its own. Re-opening it is editing, not
 * starting over, which is why it prefills from GET /api/profile.
 */
import type { PickedPlace } from '~~/shared/types'

useHead({
  title: 'Ваши данные — Астро-нумерология',
  script: [{ src: 'https://telegram.org/js/telegram-web-app.js', defer: true }],
})

const tg = useTelegram()

const name = ref('')
const fullName = ref('')
const birthDate = ref('') // yyyy-mm-dd
const birthTime = ref('') // HH:MM
const birthTimeUnknown = ref(false)
const birthPlace = ref<PickedPlace | null>(null)
const currentPlace = ref<PickedPlace | null>(null)
const livesAtBirthPlace = ref(true)

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)
const savedSummary = ref<{ timezone: string; birthTimeUnknown: boolean } | null>(null)

interface ProfileResponse {
  name: string | null
  fullName: string | null
  year: number
  month: number
  day: number
  hour: number
  minute: number
  birthTimeUnknown: boolean
  birthPlace: PickedPlace | null
  currentPlace: PickedPlace | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Prefill from an existing profile once the Telegram bridge has answered. */
watch(
  () => tg.inside.value,
  async (inside) => {
    if (inside === null) return // still waiting
    if (!inside) {
      loading.value = false
      return
    }
    try {
      const profile = await $fetch<ProfileResponse | null>('/api/profile', {
        headers: tg.authHeaders.value,
      })
      if (profile) {
        name.value = profile.name ?? ''
        fullName.value = profile.fullName ?? ''
        birthDate.value = `${profile.year}-${pad(profile.month)}-${pad(profile.day)}`
        birthTimeUnknown.value = profile.birthTimeUnknown
        birthTime.value = profile.birthTimeUnknown
          ? ''
          : `${pad(profile.hour)}:${pad(profile.minute)}`
        birthPlace.value = profile.birthPlace
        currentPlace.value = profile.currentPlace
        livesAtBirthPlace.value = !profile.currentPlace
      } else if (tg.firstName.value) {
        name.value = tg.firstName.value
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Не удалось загрузить профиль'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const timeOk = computed(() => birthTimeUnknown.value || !!birthTime.value)
const placeOk = computed(() => !!birthPlace.value && (livesAtBirthPlace.value || !!currentPlace.value))
const canSubmit = computed(
  () => !!birthDate.value && timeOk.value && placeOk.value && !saving.value && tg.inside.value === true,
)

/** The zone that will define this user's day — what the forecast is sliced on. */
const effectiveTimezone = computed(
  () => (livesAtBirthPlace.value ? birthPlace.value : currentPlace.value)?.timezone ?? null,
)

async function submit() {
  if (!canSubmit.value || !birthPlace.value) return
  saving.value = true
  error.value = null

  const [year, month, day] = birthDate.value.split('-').map(Number)
  const [hour, minute] = birthTimeUnknown.value
    ? [12, 0]
    : birthTime.value.split(':').map(Number)

  try {
    const res = await $fetch<{ timezone: string; birthTimeUnknown: boolean }>('/api/profile', {
      method: 'POST',
      headers: tg.authHeaders.value,
      body: {
        name: name.value || undefined,
        fullName: fullName.value || undefined,
        year, month, day, hour, minute,
        birthTimeUnknown: birthTimeUnknown.value,
        birthPlace: birthPlace.value,
        // Omitting it means "same as birth place" on the server too.
        currentPlace: livesAtBirthPlace.value ? undefined : currentPlace.value,
      },
    })
    savedSummary.value = res
    saved.value = true
  } catch (err) {
    const detail = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    error.value = detail || (err instanceof Error ? err.message : 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}

function edit() {
  saved.value = false
}
</script>

<template>
  <main class="wrap">
    <header class="hero">
      <h1>✦ Ваши данные</h1>
      <p class="sub">Спросим один раз — дальше прогноз будет приходить по запросу</p>
    </header>

    <!-- Opened outside Telegram: the API cannot identify anyone here. -->
    <section v-if="tg.inside.value === false" class="card notice">
      <h2>Откройте страницу через бота</h2>
      <p>
        Эта форма работает внутри Telegram: так мы понимаем, чей это профиль, и вам не нужно
        ничего подтверждать отдельно. Вернитесь в чат с ботом и нажмите кнопку ещё раз.
      </p>
    </section>

    <section v-else-if="loading" class="card notice">
      <span class="spinner" /> Загружаем…
    </section>

    <!-- Saved -->
    <section v-else-if="saved" class="card done">
      <h2>Готово ✓</h2>
      <p>
        Данные сохранены. День будет считаться по поясу
        <strong>{{ savedSummary?.timezone }}</strong>.
      </p>
      <p v-if="savedSummary?.birthTimeUnknown" class="muted">
        Время рождения не указано, поэтому дома и Асцендент в прогнозе не участвуют — он будет
        строиться только по положениям планет.
      </p>
      <div class="row-actions">
        <button class="primary" @click="tg.close()">Вернуться в чат</button>
        <button class="ghost" @click="edit">Изменить</button>
      </div>
    </section>

    <!-- Form -->
    <section v-else class="card form">
      <div class="row">
        <label class="field">
          <span>Как к вам обращаться</span>
          <input v-model="name" type="text" placeholder="Иван" />
        </label>
        <label class="field">
          <span>ФИО полностью (необязательно)</span>
          <input v-model="fullName" type="text" placeholder="Иванов Иван Иванович" />
          <small class="hint">Нужно для чисел судьбы, души и личности</small>
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>Дата рождения</span>
          <input v-model="birthDate" type="date" />
        </label>
        <label class="field">
          <span>Время рождения</span>
          <input v-model="birthTime" type="time" :disabled="birthTimeUnknown" />
          <label class="check">
            <input v-model="birthTimeUnknown" type="checkbox" />
            <span>Не знаю точное время</span>
          </label>
          <small v-if="birthTimeUnknown" class="hint">
            Без времени не считаем дома и Асцендент — они делают полный круг за сутки, так что
            от произвольного времени получились бы не приблизительные, а выдуманные. Прогноз
            будет строиться по планетам.
          </small>
        </label>
      </div>

      <div class="row">
        <CityPicker v-model="birthPlace" label="Город рождения" />
      </div>

      <div class="row stack">
        <label class="check">
          <input v-model="livesAtBirthPlace" type="checkbox" />
          <span>Живу там же, где родился</span>
        </label>
        <CityPicker
          v-if="!livesAtBirthPlace"
          v-model="currentPlace"
          label="Где вы сейчас живёте"
          placeholder="Город, в котором живёте…"
        />
        <small class="hint">
          От этого зависит, где проходит граница ваших суток и во сколько случаются события дня:
          одно и то же вхождение Луны в знак — это 19:02 во Владивостоке и 10:02 в Лиссабоне.
        </small>
      </div>

      <p v-if="effectiveTimezone" class="tz-note">
        День будет считаться по поясу <strong>{{ effectiveTimezone }}</strong>
      </p>

      <button class="primary" :disabled="!canSubmit" @click="submit">
        {{ saving ? 'Сохраняем…' : 'Сохранить' }}
      </button>
      <p v-if="error" class="err">⚠ {{ error }}</p>
    </section>
  </main>
</template>

<style scoped>
.wrap {
  flex: 1;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 0;
}

.hero { text-align: center; margin-bottom: 1.5rem; }
.hero h1 { margin: 0 0 0.3rem; font-size: 1.6rem; }
.sub { margin: 0; color: var(--text-dim); font-size: 0.9rem; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.4rem;
  box-shadow: 0 10px 40px -20px rgba(0, 0, 0, 0.7);
}

.notice { text-align: center; color: var(--text-dim); }
.notice h2 { font-size: 1.1rem; color: var(--text); }

.done h2 { margin-top: 0; font-size: 1.2rem; }
.row-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }

.form .row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.1rem; }
.form .row.stack { flex-direction: column; gap: 0.6rem; }

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 180px;
  position: relative;
}
.field > span { font-size: 0.82rem; color: var(--text-dim); }

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
input:disabled { opacity: 0.5; cursor: not-allowed; }

/* Date/time picker icons: black by default — tint to a light lavender so they
   fit the palette yet stand out on the dark inputs. */
input[type="date"]::-webkit-calendar-picker-indicator,
input[type="time"]::-webkit-calendar-picker-indicator {
  filter: invert(72%) sepia(38%) saturate(900%) hue-rotate(216deg) brightness(102%);
  opacity: 0.85;
  cursor: pointer;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-dim);
  cursor: pointer;
  margin-top: 0.1rem;
}
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  padding: 0;
  cursor: pointer;
}

.hint { color: var(--text-dim); font-size: 0.78rem; opacity: 0.85; line-height: 1.45; }
.muted { color: var(--text-dim); font-size: 0.85rem; }

.tz-note {
  font-size: 0.85rem;
  color: var(--text-dim);
  border-top: 1px solid var(--border);
  padding-top: 0.9rem;
  margin: 0 0 1rem;
}
.tz-note strong { color: var(--accent-2); }

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

.ghost {
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  padding: 0.8rem 1.2rem;
  font-size: 0.95rem;
  cursor: pointer;
}
.ghost:hover { border-color: var(--accent); }

.err { color: var(--danger); }

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 0.5rem;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 620px) { .form .row { flex-direction: column; } }
</style>
