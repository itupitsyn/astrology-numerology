<template>
  <div class="app">
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <footer class="disclaimer">
      <span>✨ Расчёты выполняются по классическим астрологическим и нумерологическим методикам. Сервис создан для интереса и саморефлексии и не заменяет медицинскую, психологическую, юридическую или финансовую консультацию.</span>
    </footer>
  </div>
</template>

<style>
:root {
  --bg: #0e0b1a;
  --bg-card: #1a1430;
  --bg-input: #221a3d;
  --border: #322a52;
  --text: #ece8ff;
  --text-dim: #a99fce;
  --accent: #b388ff;
  --accent-2: #ffcb6b;
  --danger: #ff6b8a;
  --radius: 14px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: radial-gradient(1200px 600px at 70% -10%, #2a1f52 0%, var(--bg) 55%);
  color: var(--text);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  line-height: 1.6;
}

a { color: var(--accent); }

.app {
  display: flex;
  flex-direction: column;
  min-height: 100svh;
}

.disclaimer {
  max-width: 1000px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 2rem;
  text-align: center;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-dim);
  opacity: 0.7;
}
.disclaimer span {
  display: inline-block;
  max-width: 620px;
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

h1, h2, h3 { line-height: 1.25; }

::selection { background: var(--accent); color: #1a1430; }
</style>
