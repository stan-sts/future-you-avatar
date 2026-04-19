(function () {
  const state = {
    selfieDataUrl: null,
    habits: null,
    goals: null,
    weightPlan: null,
    prediction: null,
    syncedHealth: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const steps = document.querySelectorAll(".step");
  const stepTabs = document.querySelectorAll(".step-tab");
  const SPINNER_HTML = '<div class="spinner"></div><p id="futureLoadingText">Generating 2D face…</p>';
  const HEALTH_GOALS = { sleep: 8, activeEnergy: 300, steps: 10000 };

  // ── Habit slider config ──────────────────────────────────────────────────────
  const HABITS = [
    { id: "sleep",    optimal: 8,     max: 12,    invert: false, fmt: v => v },
    { id: "exercise", optimal: 5,     max: 7,     invert: false, fmt: v => v },
    { id: "water",    optimal: 8,     max: 20,    invert: false, fmt: v => v },
    { id: "steps",    optimal: 10000, max: 30000, invert: false, fmt: v => Number(v).toLocaleString() },
    { id: "diet",     optimal: 8,     max: 10,    invert: false, fmt: v => v },
    { id: "stress",   optimal: 3,     max: 10,    invert: true,  fmt: v => v },
    { id: "smoking",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
    { id: "alcohol",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
  ];

  function healthRatio(cfg, value) {
    if (cfg.invert) return 1 - value / cfg.max;
    return Math.min(value / cfg.optimal, 1);
  }

  function updateSlider(cfg, value, animate) {
    const input = document.getElementById(cfg.id);
    const valEl = document.getElementById(cfg.id + "Val");
    if (!input || !valEl) return;

    input.value = value;
    valEl.textContent = cfg.fmt(value);

    const ratio = healthRatio(cfg, value);
    valEl.className = "habit-val" + (ratio >= 0.75 ? " good" : ratio >= 0.4 ? " warn" : " bad");

    const pct = ((value - input.min) / (input.max - input.min)) * 100;
    const color = ratio >= 0.75 ? "#7af0b1" : ratio >= 0.4 ? "#ffd580" : "#ff7a7a";
    input.style.background =
      `linear-gradient(to right, ${color} ${pct}%, var(--border) ${pct}%)`;
    input.style.setProperty("--thumb-color", color);

    if (animate) {
      valEl.classList.remove("pop");
      void valEl.offsetWidth;
      valEl.classList.add("pop");
      valEl.addEventListener("animationend", () => valEl.classList.remove("pop"), { once: true });
    }
  }

  function initSliders() {
    HABITS.forEach(cfg => {
      const input = document.getElementById(cfg.id);
      if (!input) return;
      updateSlider(cfg, input.value, false);
      input.addEventListener("input", () => updateSlider(cfg, input.value, false));
    });
  }
  initSliders();

  function round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }

  function isoDate(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function formatShortDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return {
      dayLabel: date.toLocaleDateString([], { weekday: "short" }).toUpperCase(),
      monthDay: date.toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase(),
    };
  }

  function normalizeHistoryDay(day, fallbackDate) {
    const date = typeof day?.date === "string" && day.date ? day.date : fallbackDate;
    const sleep = Number(day?.sleep ?? 0);
    const steps = Number(day?.steps ?? 0);
    const activeEnergy = Number(day?.activeEnergy ?? 0);
    const workoutMetGoal = day?.workoutMetGoal != null ? Boolean(day.workoutMetGoal) : activeEnergy >= HEALTH_GOALS.activeEnergy;
    return {
      date,
      sleep,
      steps,
      activeEnergy,
      workoutMetGoal,
      sleepMetGoal: sleep >= HEALTH_GOALS.sleep,
      stepsMetGoal: steps >= HEALTH_GOALS.steps,
      ...formatShortDate(date),
    };
  }

  function estimatedHistoryFromHabits(habits) {
    const profile = habits || readHabits();
    const now = new Date();
    const sleepOffsets = [-0.9, -0.2, 0.4, -0.5, 0.2, 0.6, -0.1];
    const stepOffsets = [-2300, 800, -1200, 1500, -700, 1900, 400];
    const workoutQuota = Math.max(0, Math.min(7, Math.round(profile.exercise || 0)));
    const workoutDays = new Set();

    if (workoutQuota > 0) {
      for (let i = 0; i < workoutQuota; i++) {
        workoutDays.add(Math.round((i * 6) / Math.max(workoutQuota - 1, 1)));
      }
    }

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));

      const sleep = Math.max(4.5, Math.min(10, round1((profile.sleep || 0) + sleepOffsets[index])));
      const steps = Math.max(1500, Math.round((profile.steps || 0) + stepOffsets[index]));
      const activeEnergy = workoutDays.has(index)
        ? Math.max(HEALTH_GOALS.activeEnergy + 40, Math.round(220 + (profile.exercise || 0) * 35))
        : Math.max(40, Math.round(90 + index * 15));

      return normalizeHistoryDay({
        date: isoDate(date),
        sleep,
        steps,
        activeEnergy,
        workoutMetGoal: activeEnergy >= HEALTH_GOALS.activeEnergy,
      }, isoDate(date));
    });
  }

  function syncedHistoryDays() {
    const rawDays = state.syncedHealth?.raw?.history?.days;
    if (!Array.isArray(rawDays) || !rawDays.length) return [];
    return rawDays
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .slice(-7)
      .map((day, index) => {
        const fallbackDate = isoDate(new Date(Date.now() - (6 - index) * 86400000));
        return normalizeHistoryDay(day, fallbackDate);
      });
  }

  function currentStreak(days, key) {
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (!days[i][key]) break;
      streak += 1;
    }
    return streak;
  }

  function countHits(days, key) {
    return days.filter(day => day[key]).length;
  }

  function averageOf(days, key) {
    if (!days.length) return 0;
    return days.reduce((sum, day) => sum + Number(day[key] || 0), 0) / days.length;
  }

  function lastSyncLabel(timestamp) {
    if (!timestamp) return "Not synced yet";
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ── Timeframe buttons ────────────────────────────────────────────────────────
  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // ── Apple Watch simulation ───────────────────────────────────────────────────
  function simulateWatchData() {
    const rnd = (base, spread, step = 1) => {
      const raw = base + (Math.random() - 0.5) * spread * 2;
      return Math.round(raw / step) * step;
    };
    const now = new Date();
    const history = [];

    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      const sleep = Math.max(5, Math.min(9, rnd(7.2, 1.1, 0.1)));
      const steps = Math.max(3500, Math.min(14000, rnd(8300, 2600, 100)));
      const activeEnergy = Math.max(80, Math.min(620, rnd(330, 180, 10)));
      history.push({
        date: date.toISOString().slice(0, 10),
        sleep,
        steps,
        activeEnergy,
        workoutMetGoal: activeEnergy >= HEALTH_GOALS.activeEnergy,
      });
    }

    const latest = history[history.length - 1];
    const workoutDays = history.filter(day => day.workoutMetGoal).length;
    return {
      sleep:    latest.sleep,
      exercise: workoutDays,
      water:    Math.max(3,    Math.min(10,    rnd(6,   2,   1))),
      steps:    latest.steps,
      diet:     Math.max(4,    Math.min(8,     rnd(6,   1,   1))),
      stress:   Math.max(3,    Math.min(7,     rnd(5,   1,   1))),
      smoking:  0,
      alcohol:  Math.max(0,    Math.min(5,     rnd(2,   1,   1))),
      history:  { days: history },
    };
  }

  function animateSliderTo(cfg, target, duration = 900) {
    const input = document.getElementById(cfg.id);
    if (!input) return;
    const start = Number(input.value);
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      const val = start + (target - start) * ease;
      const snapped = Math.round(val / Number(input.step)) * Number(input.step);
      updateSlider(cfg, snapped, false);
      if (t < 1) requestAnimationFrame(step);
      else updateSlider(cfg, target, true);
    };
    requestAnimationFrame(step);
  }

  $("#connectWatch").addEventListener("click", () => {
    const btn = $("#connectWatch");
    btn.textContent = "Waiting for iPhone…";
    btn.classList.add("loading");

    const host = location.hostname === "localhost" ? `http://localhost:${location.port || 3030}` : location.origin;
    $("#watchSynced").classList.remove("hidden");
    $("#watchSynced").innerHTML =
      `<span class="sync-dot"></span> Open <b>HealthSync</b> on your iPhone · server: <code>${host}</code>`;

    let resolved = false;
    const deadline = Date.now() + 30_000;

    const poll = async () => {
      if (resolved) return;
      try {
        const res  = await fetch("/api/health-sync");
        const json = await res.json();
        if (json.data) {
          resolved = true;
          applyHealthData(json.data, "Apple Health");
          return;
        }
      } catch (_) {}

      if (Date.now() < deadline) {
        setTimeout(poll, 2000);
      } else {
        resolved = true;
        applyHealthData(simulateWatchData(), "simulated");
      }
    };
    poll();
  });

  function applyHealthData(data, source) {
    const btn = $("#connectWatch");
    btn.textContent = "✓ Connected";
    btn.classList.remove("loading");
    btn.classList.add("done");
    const syncedAt = Date.now();
    const historyCount = Array.isArray(data?.history?.days) ? data.history.days.length : 0;
    const time = new Date(syncedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    state.syncedHealth = { source, syncedAt, raw: data };
    $("#watchSynced").innerHTML =
      `<span class="sync-dot"></span> Synced from ${source}${historyCount ? ` · ${historyCount} daily records` : ""} · ${time}`;

    HABITS.forEach((cfg, i) => {
      const val = data[cfg.id] ?? Number(document.getElementById(cfg.id)?.value ?? 0);
      setTimeout(() => animateSliderTo(cfg, val), i * 80);
    });

    if (state.goals && state.prediction) {
      renderProgressBars();
    }
  }

  function stepAvailable(step) {
    if (step === 1) return true;
    if (step === 2) return Boolean(state.selfieDataUrl);
    if (step === 3) return Boolean(state.prediction);
    return false;
  }

  function updateStepTabs(activeStep) {
    document.body.dataset.step = String(activeStep);
    stepTabs.forEach(tab => {
      const target = Number(tab.dataset.stepTarget);
      const available = stepAvailable(target);
      tab.classList.toggle("active", target === activeStep);
      tab.classList.toggle("done", available && target < activeStep);
      tab.disabled = !available && target !== activeStep;
      tab.setAttribute("aria-disabled", tab.disabled ? "true" : "false");
    });
  }

  function showStep(n) {
    steps.forEach(s => s.classList.toggle("hidden", Number(s.dataset.step) !== n));
    updateStepTabs(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  stepTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      showStep(Number(tab.dataset.stepTarget));
    });
  });

  updateStepTabs(1);

  // ── Step 1: selfie upload ────────────────────────────────────────────────────
  $("#selfieInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      resizeImage(reader.result, 1024, (resized) => {
        state.selfieDataUrl = resized;
        const preview = $("#selfiePreview");
        preview.innerHTML = `<img src="${resized}" alt="your selfie" />`;
        preview.classList.remove("hidden");
        $("#toStep2").classList.remove("hidden");
        updateStepTabs(Number(document.body.dataset.step || 1));
      });
    };
    reader.readAsDataURL(file);
  });

  function resizeImage(dataUrl, maxSize, callback) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  }

  $("#toStep2").addEventListener("click", () => showStep(2));
  $("#back1").addEventListener("click",   () => showStep(1));
  $("#back2").addEventListener("click",   () => showStep(2));

  // ── Step 2: predict ──────────────────────────────────────────────────────────
  $("#predict").addEventListener("click", async () => {
    state.habits     = readHabits();
    state.goals      = readGoals();
    state.prediction = Predictor.predictBoth(state.habits);
    state.weightPlan = Predictor.calculateWeightPlan(
      state.goals.currentWeight, state.goals.targetWeight, state.goals.months
    );
    showStep(3);
    renderFutureResults();
    await Promise.all([
      generateFutureAvatar(),
      populateFutureCoach(),
    ]);
  });

  function readHabits() {
    return Object.fromEntries(
      ["sleep", "exercise", "water", "steps", "diet", "stress", "smoking", "alcohol"]
        .map(f => [f, Number($("#" + f).value)])
    );
  }

  function readGoals() {
    const currentWeight = parseFloat($("#currentWeight").value) || 70;
    const targetWeight  = parseFloat($("#targetWeight").value)  || 65;
    const activeBtn     = document.querySelector(".tf-btn.active");
    const months        = parseInt(activeBtn?.dataset.months || 6);
    return { currentWeight, targetWeight, months };
  }

  // ── Step 3: render results ───────────────────────────────────────────────────
  function renderFutureResults() {
    const { months } = state.goals;
    const label = months === 3 ? "3 months" : months === 12 ? "1 year" : "6 months";
    $("#futureSubtitle").textContent = `In ${label}, here's what you can achieve:`;
    renderScienceCard();
    renderProgressBars();
  }

  function renderScienceCard() {
    const wp  = state.weightPlan;
    const el  = $("#scienceCard");
    const proj = state.prediction.improve;

    if (!wp) {
      el.innerHTML = `
        <div class="science-title">Your Health Outlook</div>
        <div class="science-goal">With consistent habits, your health score can reach <b>${proj.score}/100</b></div>
        <div class="science-rows">
          <div class="science-row"><span class="science-icon">⚡</span><span>Energy: <b>${proj.energy}/100</b></span></div>
          <div class="science-row"><span class="science-icon">😴</span><span>Sleep quality: <b>${proj.sleepQuality}/100</b></span></div>
          <div class="science-row"><span class="science-icon">✨</span><span>Skin health: <b>${proj.skinHealth}/100</b></span></div>
        </div>
      `;
      return;
    }

    if (!wp.isFeasible) {
      el.innerHTML = `
        <div class="science-title">Weight Goal</div>
        <div class="science-warn">Losing ${wp.kgToLose} kg in ${wp.months} months requires a ${wp.dailyDeficit} kcal/day deficit — above the safe 1,000 kcal/day limit. Try extending your timeframe.</div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="science-title">Your ${wp.months}-Month Plan</div>
      <div class="science-goal">Lose <b>${wp.kgToLose} kg</b> in <b>${wp.months} months</b></div>
      <div class="science-rows">
        <div class="science-row">
          <span class="science-icon">🔥</span>
          <span>Daily calorie deficit: <b>${wp.dailyDeficit} kcal</b></span>
        </div>
        <div class="science-row indent">
          <span class="science-icon">👟</span>
          <span>Add <b>+${wp.extraSteps.toLocaleString()} steps/day</b> (~${wp.exerciseCalories} kcal burn)</span>
        </div>
        <div class="science-row indent">
          <span class="science-icon">🥗</span>
          <span>Reduce intake by <b>~${wp.dietCalories} kcal/day</b></span>
        </div>
      </div>
      <div class="science-tip">💡 ${getTip(wp)}</div>
    `;
  }

  function getTip(wp) {
    if (wp.dietCalories < 100) return "Skip one small cookie daily — that's all it takes.";
    if (wp.dietCalories < 200) return "Swap one soda for water and take a short walk.";
    if (wp.dietCalories < 350) return "Skip one snack and do a 20-min walk each day.";
    if (wp.dietCalories < 500) return "Cut one meal's side dish and add a daily 30-min walk.";
    return "Significant diet + exercise changes needed — consider a nutritionist.";
  }

  function buildEvidenceModel() {
    const observedDays = syncedHistoryDays();
    const observed = observedDays.length >= 3;
    const days = observed ? observedDays : estimatedHistoryFromHabits(state.habits);
    const today = days[days.length - 1];
    const sleepAvg = averageOf(days, "sleep");
    const workoutHits = countHits(days, "workoutMetGoal");
    const sleepHits = countHits(days, "sleepMetGoal");
    const stepAvg = averageOf(days, "steps");

    return {
      mode: observed ? "observed" : "estimated",
      source: observed ? (state.syncedHealth?.source || "Apple Health") : "Planner estimate",
      lastSync: observed ? lastSyncLabel(state.syncedHealth?.syncedAt) : "Connect Apple Health",
      days,
      today,
      sleepAvg,
      stepAvg,
      sleepHits,
      workoutHits,
      sleepStreak: currentStreak(days, "sleepMetGoal"),
      workoutStreak: currentStreak(days, "workoutMetGoal"),
    };
  }

  function sleepDeltaText(day) {
    const diff = round1(day.sleep - HEALTH_GOALS.sleep);
    return diff >= 0 ? `cleared by ${round1(diff)}h` : `short by ${round1(Math.abs(diff))}h`;
  }

  function workoutDetailText(day) {
    return day.workoutMetGoal
      ? `${Math.round(day.activeEnergy)} kcal active`
      : `${Math.round(day.activeEnergy)} / ${HEALTH_GOALS.activeEnergy} kcal`;
  }

  function stepChipText(day) {
    return day.stepsMetGoal
      ? `hit ${Math.round(day.steps).toLocaleString()}`
      : `${Math.round(day.steps).toLocaleString()} / ${HEALTH_GOALS.steps.toLocaleString()}`;
  }

  function streakCardMarkup(label, streak, hits, summary, note, days, key, valueFormatter) {
    return `
      <article class="streak-card">
        <div class="streak-card-label">${label}</div>
        <div class="streak-card-value">${streak ? `${streak}-day streak` : "No streak yet"}</div>
        <div class="streak-card-meta">${hits} / 7 days hit goal · ${summary}</div>
        <div class="streak-mini-track">
          ${days.map((day, index) => `
            <div class="streak-day ${day[key] ? "met" : "miss"} ${index === days.length - 1 ? "today" : ""}">
              <span class="streak-day-name">${day.dayLabel.slice(0, 3)}</span>
              <span class="streak-day-value">${valueFormatter(day)}</span>
            </div>
          `).join("")}
        </div>
        <div class="streak-card-note">${note}</div>
      </article>
    `;
  }

  function renderProgressBars() {
    const evidence = buildEvidenceModel();
    const weightLine = state.goals.currentWeight > state.goals.targetWeight
      ? `Weight target still needs ${round1(state.goals.currentWeight - state.goals.targetWeight)} kg of progress across ${state.goals.months} months.`
      : `Weight target is set for maintenance over ${state.goals.months} months.`;
    const modeCopy = evidence.mode === "observed"
      ? "Observed from Apple Health. A day only counts when the watch data clears the target."
      : "Using modeled days from the current sliders until Apple Health sends daily history.";

    $("#progressBars").innerHTML = `
      <section class="progress-ledger">
        <div class="progress-ledger-top">
          <div>
            <div class="progress-kicker">Goal Evidence / Last 7 Days</div>
            <h3 class="progress-headline">Recovery + Workout Ledger</h3>
            <p class="progress-subhead">${modeCopy} ${weightLine}</p>
          </div>
          <div class="progress-meta">
            <span class="progress-mode ${evidence.mode === "observed" ? "live" : ""}">${evidence.source}</span>
            <span class="progress-mode">${evidence.sleepHits}/7 sleep clears</span>
            <span class="progress-mode">${evidence.workoutHits}/7 workout clears</span>
            <span class="progress-mode">Avg ${Math.round(evidence.stepAvg).toLocaleString()} steps</span>
            <span class="progress-mode">Sync ${evidence.lastSync}</span>
          </div>
        </div>

        <div class="streak-board">
          ${streakCardMarkup(
            "Sleep goal",
            evidence.sleepStreak,
            evidence.sleepHits,
            `avg ${round1(evidence.sleepAvg)}h vs ${HEALTH_GOALS.sleep}h target`,
            evidence.today.sleepMetGoal
              ? `Today logged ${round1(evidence.today.sleep)}h and kept the recovery streak alive.`
              : `Today logged ${round1(evidence.today.sleep)}h, ${sleepDeltaText(evidence.today)}.`,
            evidence.days,
            "sleepMetGoal",
            day => `${round1(day.sleep)}h`
          )}
          ${streakCardMarkup(
            "Workout goal",
            evidence.workoutStreak,
            evidence.workoutHits,
            `avg ${Math.round(averageOf(evidence.days, "activeEnergy"))} kcal active`,
            evidence.today.workoutMetGoal
              ? `Today crossed the ${HEALTH_GOALS.activeEnergy} kcal movement threshold.`
              : `Today stayed below the ${HEALTH_GOALS.activeEnergy} kcal workout threshold.`,
            evidence.days,
            "workoutMetGoal",
            day => `${Math.round(day.activeEnergy)}`
          )}
        </div>

        <div class="day-ledger">
          <div class="day-ledger-head">Daily evidence by signal</div>
          ${evidence.days.map(day => `
            <div class="day-row">
              <div class="day-stamp">
                <span class="day-label">${day.dayLabel}</span>
                <span class="day-date">${day.monthDay}</span>
              </div>
              <div class="day-metric">
                <div class="metric-label">Sleep</div>
                <div class="metric-value">${round1(day.sleep)}h</div>
                <div class="metric-detail">Target ${HEALTH_GOALS.sleep}h nightly</div>
                <span class="metric-chip ${day.sleepMetGoal ? "met" : "miss"}">${day.sleepMetGoal ? "goal cleared" : sleepDeltaText(day)}</span>
              </div>
              <div class="day-metric">
                <div class="metric-label">Workout</div>
                <div class="metric-value">${Math.round(day.activeEnergy)} kcal</div>
                <div class="metric-detail">Move goal ${HEALTH_GOALS.activeEnergy} kcal</div>
                <span class="metric-chip ${day.workoutMetGoal ? "met" : "miss"}">${day.workoutMetGoal ? "workout counted" : workoutDetailText(day)}</span>
              </div>
              <div class="day-metric">
                <div class="metric-label">Steps</div>
                <div class="metric-value">${Math.round(day.steps).toLocaleString()}</div>
                <div class="metric-detail">Daily target ${HEALTH_GOALS.steps.toLocaleString()}</div>
                <span class="metric-chip ${day.stepsMetGoal ? "met" : "neutral"}">${stepChipText(day)}</span>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="ledger-footnote">
          ${evidence.mode === "observed"
            ? "Apple Health currently feeds last-night sleep, daily steps, and active energy into this board."
            : "Connect the companion app to replace estimated days with actual Apple Watch history for real streak scoring."}
        </div>
      </section>
    `;
  }

  // ── Two-step avatar generation ───────────────────────────────────────────────
  async function generateFutureAvatar() {
    const prompt = Predictor.goalAvatarPrompt(state.habits, {
      kgToLose: Math.max(0, state.goals.currentWeight - state.goals.targetWeight),
    });

    try {
      const userKeys = {
        googleKey:  sessionStorage.getItem("googleKey")  || undefined,
        tencentId:  sessionStorage.getItem("tencentId")  || undefined,
        tencentKey: sessionStorage.getItem("tencentKey") || undefined,
      };

      const loadingEl  = $("#futureLoading");
      const loadTextEl = document.getElementById("futureLoadingText");
      if (loadTextEl) loadTextEl.textContent = "Generating 2D face…";

      const res2d = await fetch("/api/generate-2d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: state.selfieDataUrl, prompt, ...userKeys }),
      });
      if (!res2d.ok) throw new Error(`2D generation failed: ${res2d.status}`);
      const { image: modifiedImage } = await res2d.json();

      loadingEl.innerHTML = `<img src="${modifiedImage}" style="max-width:100%;border-radius:8px" /><p style="font-size:12px;color:#888">2D ready — building 3D…</p>`;

      const res3d = await fetch("/api/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: modifiedImage, ...userKeys }),
      });
      if (!res3d.ok) throw new Error(`3D submit failed: ${res3d.status}`);
      const { jobId } = await res3d.json();

      const modelUrl = await pollJob(jobId);
      const modelEl  = $("#futureModel");
      modelEl.style.display = "block";
      loadingEl.style.display = "none";
      modelEl.setAttribute("src", `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`);
      modelEl.addEventListener("error", (e) => console.error("model-viewer error:", e), { once: true });
    } catch (err) {
      console.error("Future avatar error:", err);
      $("#futureLoading").innerHTML =
        `<p class="hint avatar-error">Generation unavailable.<br><small>${err.message}</small></p>`;
    }
  }

  function pollJob(jobId, intervalMs = 5000) {
    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const res  = await fetch(`/api/avatar-status/${jobId}`);
          const data = await res.json();

          if (data.error)              return reject(new Error(data.error));
          if (data.status === "succeed") {
            if (data.modelUrl) return resolve(data.modelUrl);
            return reject(new Error("Job succeeded but no model URL returned"));
          }
          if (data.status === "failed") return reject(new Error("Avatar generation failed"));

          intervalMs = Math.min(intervalMs * 1.5, 30_000);
          setTimeout(check, intervalMs);
        } catch (err) {
          reject(err);
        }
      };
      check();
    });
  }

  // ── Coach ────────────────────────────────────────────────────────────────────
  async function populateFutureCoach() {
    $("#futureCoach").textContent = "Thinking…";
    const msg = await Coach.coachMessage("improve", state.habits, state.prediction.improve);
    const wp  = state.weightPlan;
    const suffix = (wp && wp.kgToLose > 0 && wp.isFeasible)
      ? ` Your ${wp.months}-month target: lose ${wp.kgToLose} kg.`
      : "";
    $("#futureCoach").textContent = msg + suffix;
  }

  // ── Speak button ─────────────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".speak");
    if (!btn) return;
    const targetId = btn.dataset.target;
    const text     = document.getElementById(targetId)?.textContent;
    const modelEl  = $("#futureModel");

    if (btn.classList.contains("playing")) {
      AvatarVoice.stop();
      document.querySelectorAll(".speak.playing").forEach(b => b.classList.remove("playing"));
      return;
    }
    document.querySelectorAll(".speak.playing").forEach(b => b.classList.remove("playing"));
    btn.classList.add("playing");
    const utter = AvatarVoice.speak(text, "improve", modelEl);
    Promise.resolve(utter).then(u => {
      if (!u) return;
      const prevEnd = u.onend;
      u.onend = (ev) => { prevEnd?.(ev); btn.classList.remove("playing"); };
    });
  });

  // ── Restart ──────────────────────────────────────────────────────────────────
  $("#restart").addEventListener("click", () => {
    AvatarVoice.stop();
    Object.assign(state, {
      selfieDataUrl: null,
      habits: null,
      goals: null,
      weightPlan: null,
      prediction: null,
      syncedHealth: null,
    });
    $("#selfieInput").value       = "";
    $("#selfiePreview").innerHTML = "";
    $("#selfiePreview").classList.add("hidden");
    $("#toStep2").classList.add("hidden");

    const btn = $("#connectWatch");
    btn.textContent = "Connect";
    btn.classList.remove("loading", "done");
    $("#watchSynced").classList.add("hidden");
    $("#watchSynced").innerHTML =
      '<span class="sync-dot"></span> Synced from Apple Health · <span id="syncTime">just now</span>';

    $("#futureLoading").innerHTML  = SPINNER_HTML;
    $("#futureLoading").style.display = "";
    $("#futureModel").removeAttribute("src");
    $("#futureModel").style.display   = "none";
    $("#scienceCard").innerHTML    = "";
    $("#progressBars").innerHTML   = "";
    $("#futureCoach").textContent  = "Loading coach…";

    showStep(1);
  });

  // ── API key save ─────────────────────────────────────────────────────────────
  const hasKeys = sessionStorage.getItem("openaiKey") || sessionStorage.getItem("tencentId");
  if (hasKeys) $("#keyStatus").textContent = "Custom keys loaded for this session.";

  $("#saveKeys").addEventListener("click", () => {
    const tid  = $("#tencentId").value.trim();
    const tkey = $("#tencentKey").value.trim();
    const gkey = $("#googleKey").value.trim();
    const akey = $("#anthropicKey").value.trim();

    if (!tid && !tkey && !gkey && !akey) {
      ["tencentId", "tencentKey", "googleKey", "anthropicKey"].forEach(k => sessionStorage.removeItem(k));
      $("#keyStatus").textContent = "Keys cleared — using defaults.";
      return;
    }
    if (tid)  { sessionStorage.setItem("tencentId",    tid);  $("#tencentId").value    = ""; }
    if (tkey) { sessionStorage.setItem("tencentKey",   tkey); $("#tencentKey").value   = ""; }
    if (gkey) { sessionStorage.setItem("googleKey",    gkey); $("#googleKey").value    = ""; }
    if (akey) { sessionStorage.setItem("anthropicKey", akey); $("#anthropicKey").value = ""; }
    $("#keyStatus").textContent = "Keys saved for this session.";
  });
})();
