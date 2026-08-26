<script setup lang="ts">
/**
 * City autocomplete backed by /api/geocode.
 *
 * Selecting a result yields coordinates *and* an IANA timezone, which is why
 * the timezone is never asked for anywhere: the geocoder already knows it, and
 * a wrong one silently shifts a whole forecast by a day near midnight.
 *
 * `modelValue` is null until a result is actually picked — typing a city name
 * that was never resolved must not count as a choice.
 */
import type { GeoLocation, PickedPlace } from '~~/shared/types'

const props = defineProps<{
  modelValue: PickedPlace | null
  label: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [PickedPlace | null] }>()

const query = ref(props.modelValue?.city ?? '')
const showDropdown = ref(false)
const geocode = useGeocode()

// Keep the visible text in step when the value is set from outside (prefill).
// Clearing is not mirrored: the parent nulls the value on every keystroke, and
// wiping the box mid-typing would be maddening.
watch(
  () => props.modelValue,
  (place) => {
    if (place && place.city !== query.value) query.value = place.city
  },
)

function onInput() {
  // Editing the text invalidates the previous choice: what is in the box is no
  // longer a resolved place.
  emit('update:modelValue', null)
  showDropdown.value = true
  geocode.search(query.value)
}

function pick(loc: GeoLocation) {
  emit('update:modelValue', {
    latitude: loc.latitude,
    longitude: loc.longitude,
    timezone: loc.timezone,
    city: loc.display_name,
  })
  query.value = loc.display_name
  showDropdown.value = false
  geocode.clear()
}

function hideDropdownSoon() {
  setTimeout(() => (showDropdown.value = false), 150)
}
</script>

<template>
  <label class="field city">
    <span>{{ label }}</span>
    <div class="input-wrap">
      <input
        v-model="query"
        type="text"
        :placeholder="placeholder ?? 'Начните вводить город…'"
        :disabled="disabled"
        autocomplete="off"
        @input="onInput"
        @focus="showDropdown = geocode.results.value.length > 0"
        @blur="hideDropdownSoon"
      />
      <span v-if="geocode.loading.value" class="spinner" aria-label="Поиск города" />
    </div>

    <div
      v-if="showDropdown && (geocode.loading.value || geocode.results.value.length)"
      class="dropdown"
    >
      <div v-if="geocode.loading.value" class="dd-item muted">
        <span class="spinner spinner-sm" /> Поиск…
      </div>
      <button
        v-for="loc in geocode.results.value"
        :key="loc.display_name"
        type="button"
        class="dd-item"
        @mousedown.prevent="pick(loc)"
      >
        <span class="dd-name">{{ loc.display_name }}</span>
        <span class="dd-tz">{{ loc.timezone }}</span>
      </button>
    </div>

    <small v-if="modelValue" class="ok">✓ {{ modelValue.timezone }}</small>
    <small v-else-if="geocode.error.value" class="err">⚠ {{ geocode.error.value }}</small>
    <small v-else-if="query.trim().length > 1" class="hint">Выберите город из списка</small>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 180px;
  position: relative;
}
.field > span { font-size: 0.82rem; color: var(--text-dim); }
.field.city { min-width: 260px; flex: 2; }

input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  width: 100%;
}
input:focus { border-color: var(--accent); }
input:disabled { opacity: 0.5; cursor: not-allowed; }

.input-wrap { position: relative; }
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
.spinner-sm { width: 13px; height: 13px; vertical-align: middle; margin-right: 6px; }
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
.err { color: var(--danger); font-size: 0.78rem; }
.hint { color: var(--text-dim); font-size: 0.78rem; opacity: 0.8; }
</style>
