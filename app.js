(function () {
  const state = {
    selfieDataUrl: null,
    habits: null,
    goalHabits: null,
    goals: null,
    weightPlan: null,
    prediction: null,
    syncedHealth: null,
    affirmationPromptIndex: 0,
    affirmationAudioUrl: null,
    affirmationAudioBlob: null,
    questionnaire: null,
    recommendation: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const steps = document.querySelectorAll(".step");
  const stepTabs = document.querySelectorAll(".step-tab");
  const HEALTH_GOALS = { sleep: 8, activeEnergy: 300, steps: 10000 };
  const HEART_RATE_BAND = { low: 50, high: 90 };
  const QUESTIONNAIRE_STORAGE_KEY = "future-you-reflection-draft";
  const AFFIRMATION_PROMPTS = [
    "Say out loud what your future self will thank you for 6 months from now.",
    "Record one sentence about the version of you that protects sleep instead of sacrificing it.",
    "Name the habit that makes you feel most alive when you actually follow through.",
    "Describe how you want your energy to feel at the end of a normal weekday.",
    "Speak to yourself like a coach: what do you need to remember when stress pushes you into scrolling?",
    "What would a calmer, more rested version of you want tonight to look like?",
  ];
  const AVATAR_SCENARIOS = {
    same: {
      loadingId: "sameFutureLoading",
      loadingTextId: "sameFutureLoadingText",
      modelId: "sameFutureModel",
      img2dId: "same2dImg",
      toggleId: "sameViewToggle",
      coachId: "sameFutureCoach",
      scenario: "same",
      loadingLabel: "Generating current-path face…",
      previewLabel: "2D current-path preview ready — building 3D…",
    },
    improve: {
      loadingId: "idealFutureLoading",
      loadingTextId: "idealFutureLoadingText",
      modelId: "idealFutureModel",
      img2dId: "ideal2dImg",
      toggleId: "idealViewToggle",
      coachId: "idealFutureCoach",
      scenario: "improve",
      loadingLabel: "Generating ideal future face…",
      previewLabel: "2D ideal-future preview ready — building 3D…",
    },
  };

  // ── Habit slider configs ─────────────────────────────────────────────────────
  const GOAL_HABIT_DEFAULTS = { gSleep: 8, gExercise: 5, gWater: 8, gSteps: 10000, gScreenTime: 3, gDiet: 8, gStress: 3, gSmoking: 0, gAlcohol: 3 };

  const GOAL_HABITS = [
    { id: "gSleep",    optimal: 8,     max: 12,    invert: false, fmt: v => v },
    { id: "gExercise", optimal: 5,     max: 7,     invert: false, fmt: v => v },
    { id: "gWater",    optimal: 8,     max: 20,    invert: false, fmt: v => v },
    { id: "gSteps",    optimal: 10000, max: 30000, invert: false, fmt: v => Number(v).toLocaleString() },
    { id: "gScreenTime", optimal: 2,   max: 16,    invert: true,  fmt: v => v },
    { id: "gDiet",     optimal: 8,     max: 10,    invert: false, fmt: v => v },
    { id: "gStress",   optimal: 3,     max: 10,    invert: true,  fmt: v => v },
    { id: "gSmoking",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
    { id: "gAlcohol",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
  ];

  const HABITS = [
    { id: "sleep",    optimal: 8,     max: 12,    invert: false, fmt: v => v },
    { id: "exercise", optimal: 5,     max: 7,     invert: false, fmt: v => v },
    { id: "water",    optimal: 8,     max: 20,    invert: false, fmt: v => v },
    { id: "steps",    optimal: 10000, max: 30000, invert: false, fmt: v => Number(v).toLocaleString() },
    { id: "screenTime", optimal: 2,   max: 16,    invert: true,  fmt: v => v },
    { id: "diet",     optimal: 8,     max: 10,    invert: false, fmt: v => v },
    { id: "stress",   optimal: 3,     max: 10,    invert: true,  fmt: v => v },
    { id: "smoking",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
    { id: "alcohol",  optimal: 0,     max: 40,    invert: true,  fmt: v => v },
  ];

  let affirmationRecorder = null;
  let affirmationStream = null;
  let affirmationChunks = [];
  let affirmationTimeout = null;
  let affirmationStopReason = "Recording saved.";
  let discardAffirmationOnStop = false;

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

  function initSliders() {
    HABITS.forEach(cfg => {
      const input = document.getElementById(cfg.id);
      if (!input) return;
      updateSlider(cfg, input.value, false);
      input.addEventListener("input", () => updateSlider(cfg, input.value, false));
    });
  }
  initSliders();

  function initGoalSliders() {
    GOAL_HABITS.forEach(cfg => {
      const input = document.getElementById(cfg.id);
      if (!input) return;
      updateSlider(cfg, input.value, false);
      input.addEventListener("input", () => updateSlider(cfg, input.value, false));
    });
  }
  initGoalSliders();

  function round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }

  function spinnerMarkup(textId, label) {
    return `<div class="spinner"></div><p id="${textId}">${label}</p>`;
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
    const rawHeartRate = day?.heartRate;
    const heartRate = rawHeartRate == null || rawHeartRate === "" ? null : Number(rawHeartRate);
    const workoutMetGoal = day?.workoutMetGoal != null ? Boolean(day.workoutMetGoal) : activeEnergy >= HEALTH_GOALS.activeEnergy;
    return {
      date,
      sleep,
      steps,
      activeEnergy,
      heartRate,
      heartRateAvailable: heartRate != null && Number.isFinite(heartRate),
      workoutMetGoal,
      sleepMetGoal: sleep >= HEALTH_GOALS.sleep,
      stepsMetGoal: steps >= HEALTH_GOALS.steps,
      ...formatShortDate(date),
    };
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

  function parseOptionalNumber(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  function readTodayInputs() {
    return {
      sleep: parseOptionalNumber($("#todaySleep")?.value),
      activeEnergy: parseOptionalNumber($("#todayActiveEnergy")?.value),
      steps: parseOptionalNumber($("#todaySteps")?.value),
      heartRate: parseOptionalNumber($("#todayHeartRate")?.value),
    };
  }

  function setTodayInputs(values = {}) {
    const fieldMap = {
      sleep: "todaySleep",
      activeEnergy: "todayActiveEnergy",
      steps: "todaySteps",
      heartRate: "todayHeartRate",
    };

    Object.entries(fieldMap).forEach(([key, id]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const nextValue = values[key];
      input.value = nextValue == null ? "" : String(nextValue);
    });
  }

  function syncedTodayDay() {
    const todayKey = isoDate(new Date());
    const days = syncedHistoryDays();
    const latest = days[days.length - 1];
    if (!latest || latest.date !== todayKey) return null;
    return latest;
  }

  function todayMetricSourceLabel(source) {
    return source === "slider_override"
      ? "Slider override"
      : source === "apple_health"
        ? "Apple Health"
        : source === "manual"
          ? "Manual entry"
          : "Waiting";
  }

  function currentSliderOverrides() {
    const sleep = parseOptionalNumber($("#sleep")?.value);
    const steps = parseOptionalNumber($("#steps")?.value);

    return {
      sleep,
      steps,
    };
  }

  function applySliderOverridesToSyncedDay(day) {
    if (!day) return null;

    const overrides = currentSliderOverrides();
    const next = { ...day };

    if (overrides.sleep != null) {
      next.sleep = overrides.sleep;
      next.sleepMetGoal = overrides.sleep >= HEALTH_GOALS.sleep;
    }

    if (overrides.steps != null) {
      next.steps = overrides.steps;
      next.stepsMetGoal = overrides.steps >= HEALTH_GOALS.steps;
    }

    return next;
  }

  function heartRateDetail(metric) {
    if (metric.value == null) return "Add a manual bpm value or sync Apple Health.";
    if (metric.value < HEART_RATE_BAND.low) return `Below the ${HEART_RATE_BAND.low}-${HEART_RATE_BAND.high} bpm recovery band.`;
    if (metric.value <= HEART_RATE_BAND.high) return `Inside the ${HEART_RATE_BAND.low}-${HEART_RATE_BAND.high} bpm recovery band.`;
    return `Above the ${HEART_RATE_BAND.low}-${HEART_RATE_BAND.high} bpm recovery band.`;
  }

  function heartRateChip(metric) {
    if (metric.value == null) return { label: "awaiting heart rate", tone: "neutral" };
    if (metric.value < HEART_RATE_BAND.low) return { label: "below band", tone: "warn" };
    if (metric.value <= HEART_RATE_BAND.high) return { label: "steady pulse", tone: "met" };
    return { label: "elevated pulse", tone: "warn" };
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function dailyGoalMetricRows(today) {
    const heartMid = (HEART_RATE_BAND.low + HEART_RATE_BAND.high) / 2;
    const heartHalfRange = (HEART_RATE_BAND.high - HEART_RATE_BAND.low) / 2;
    const rows = [
      {
        label: "Sleep",
        source: today.sleep.source,
        valueText: today.sleep.value == null ? "Awaiting" : `${round1(today.sleep.value)}h`,
        ratio: today.sleep.value == null ? null : clamp01(today.sleep.value / HEALTH_GOALS.sleep),
      },
      {
        label: "Move",
        source: today.activeEnergy.source,
        valueText: today.activeEnergy.value == null ? "Awaiting" : `${Math.round(today.activeEnergy.value)} kcal`,
        ratio: today.activeEnergy.value == null ? null : clamp01(today.activeEnergy.value / HEALTH_GOALS.activeEnergy),
      },
      {
        label: "Steps",
        source: today.steps.source,
        valueText: today.steps.value == null ? "Awaiting" : `${Math.round(today.steps.value).toLocaleString()}`,
        ratio: today.steps.value == null ? null : clamp01(today.steps.value / HEALTH_GOALS.steps),
      },
      {
        label: "Heart",
        source: today.heartRate.source,
        valueText: today.heartRate.value == null ? "Awaiting" : `${Math.round(today.heartRate.value)} bpm`,
        ratio: today.heartRate.value == null ? null : clamp01(1 - Math.abs(today.heartRate.value - heartMid) / heartHalfRange),
      },
    ];

    const available = rows.filter(row => row.ratio != null);
    const overall = available.length
      ? Math.round((available.reduce((sum, row) => sum + row.ratio, 0) / available.length) * 100)
      : null;

    return { rows, availableCount: available.length, overall };
  }

  function buildTodayProgressModel() {
    const syncedDay = syncedTodayDay();
    const sliderOverrides = syncedDay ? currentSliderOverrides() : {};
    const manual = readTodayInputs();
    const pickMetric = (key) => {
      if (syncedDay && sliderOverrides[key] != null) {
        return { value: sliderOverrides[key], source: "slider_override" };
      }
      if (syncedDay) {
        if (key !== "heartRate" || syncedDay.heartRateAvailable) {
          return { value: syncedDay[key], source: "apple_health" };
        }
      }
      if (manual[key] != null) {
        return { value: manual[key], source: "manual" };
      }
      return { value: null, source: "missing" };
    };

    const sleep = pickMetric("sleep");
    const activeEnergy = pickMetric("activeEnergy");
    const steps = pickMetric("steps");
    const heartRate = pickMetric("heartRate");
    const hasAny = [sleep, activeEnergy, steps, heartRate].some(metric => metric.value != null);

    return {
      hasAny,
      syncedTodayAvailable: Boolean(syncedDay),
      sleep,
      activeEnergy,
      steps,
      heartRate,
    };
  }

  // ── Timeframe buttons ────────────────────────────────────────────────────────
  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

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
        btn.textContent = "Retry Sync";
        btn.classList.remove("loading", "done");
        $("#watchSynced").innerHTML =
          '<span class="sync-dot off"></span> No Apple Health history received yet. Open <b>HealthSync</b> on your iPhone and sync again.';
        if (state.goals && state.prediction) {
          renderProgressBars();
        }
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
    if (step === 3) return Boolean(state.selfieDataUrl);
    if (step === 4) return Boolean(state.prediction);
    if (step === 5) return Boolean(state.prediction);
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
        preview.innerHTML = `<img src="${resized}" alt="your uploaded reference" />`;
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
  $("#toStep3").addEventListener("click", () => showStep(3));
  $("#back2").addEventListener("click",   () => showStep(2));
  $("#back3").addEventListener("click",   () => showStep(3));
  $("#toStep5").addEventListener("click", () => showStep(5));
  $("#back4").addEventListener("click",   () => showStep(4));

  // ── Step 3: generate ─────────────────────────────────────────────────────────
  $("#generate").addEventListener("click", async () => {
    state.habits      = readHabits();
    state.goalHabits  = readGoalHabits();
    state.goals       = readGoals();
    state.prediction  = Predictor.predictBoth(state.habits, state.goalHabits);
    state.weightPlan  = Predictor.calculateWeightPlan(
      state.goals.currentWeight, state.goals.targetWeight, state.goals.months
    );
    showStep(4);
    renderFutureResults();
    refreshRecommendation();
    await Promise.all([
      generateComparisonAvatars(),
      populateFutureCoaches(),
    ]);
  });

  function readHabits() {
    return Object.fromEntries(
      ["sleep", "exercise", "water", "steps", "screenTime", "diet", "stress", "smoking", "alcohol"]
        .map(f => [f, Number($("#" + f).value)])
    );
  }

  function readGoalHabits() {
    return {
      sleep:    Number($("#gSleep").value),
      exercise: Number($("#gExercise").value),
      water:    Number($("#gWater").value),
      steps:    Number($("#gSteps").value),
      screenTime: Number($("#gScreenTime").value),
      diet:     Number($("#gDiet").value),
      stress:   Number($("#gStress").value),
      smoking:  Number($("#gSmoking").value),
      alcohol:  Number($("#gAlcohol").value),
    };
  }

  function readGoals() {
    const currentWeight = parseFloat($("#currentWeight").value) || 70;
    const targetWeight  = parseFloat($("#targetWeight").value)  || 65;
    const activeBtn     = document.querySelector(".tf-btn.active");
    const months        = parseInt(activeBtn?.dataset.months || 6);
    return { currentWeight, targetWeight, months };
  }

  function randomAffirmationIndex(excluding = state.affirmationPromptIndex) {
    if (AFFIRMATION_PROMPTS.length <= 1) return 0;
    let next = excluding;
    while (next === excluding) {
      next = Math.floor(Math.random() * AFFIRMATION_PROMPTS.length);
    }
    return next;
  }

  function setAffirmationPrompt(index) {
    state.affirmationPromptIndex = index;
    const el = $("#affirmationPrompt");
    if (el) el.textContent = AFFIRMATION_PROMPTS[index];
  }

  function setAffirmationStatus(text, tone = "neutral") {
    const el = $("#affirmationStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function stopAffirmationStream() {
    if (affirmationStream) {
      affirmationStream.getTracks().forEach(track => track.stop());
      affirmationStream = null;
    }
  }

  function clearAffirmationTimeout() {
    if (affirmationTimeout) {
      clearTimeout(affirmationTimeout);
      affirmationTimeout = null;
    }
  }

  function setAffirmationAudio(blob) {
    if (state.affirmationAudioUrl) {
      URL.revokeObjectURL(state.affirmationAudioUrl);
    }
    state.affirmationAudioBlob = blob || null;
    state.affirmationAudioUrl = blob ? URL.createObjectURL(blob) : null;

    const audio = $("#affirmationPlayback");
    const wrap = $("#affirmationPlaybackWrap");
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = state.affirmationAudioUrl || "";
    }
    if (wrap) wrap.classList.toggle("hidden", !state.affirmationAudioUrl);
  }

  function updateAffirmationButtons() {
    const isRecording = Boolean(affirmationRecorder && affirmationRecorder.state !== "inactive");
    const hasAudio = Boolean(state.affirmationAudioUrl);
    if ($("#recordAffirmation")) $("#recordAffirmation").disabled = isRecording;
    if ($("#stopAffirmation")) $("#stopAffirmation").disabled = !isRecording;
    if ($("#playAffirmation")) $("#playAffirmation").disabled = !hasAudio;
    if ($("#clearAffirmation")) $("#clearAffirmation").disabled = !hasAudio && !isRecording;
    if ($("#shuffleAffirmation")) $("#shuffleAffirmation").disabled = isRecording;
  }

  async function startAffirmationRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAffirmationStatus("Audio recording is not supported in this browser.", "warn");
      return;
    }
    if (affirmationRecorder && affirmationRecorder.state !== "inactive") return;

    try {
      affirmationStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      affirmationChunks = [];
      affirmationStopReason = "Recording saved.";
      discardAffirmationOnStop = false;
      affirmationRecorder = new MediaRecorder(affirmationStream);
      affirmationRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) affirmationChunks.push(event.data);
      };
      affirmationRecorder.onerror = () => {
        clearAffirmationTimeout();
        stopAffirmationStream();
        affirmationRecorder = null;
        updateAffirmationButtons();
        setAffirmationStatus("Recording failed. Please try again.", "bad");
      };
      affirmationRecorder.onstop = () => {
        clearAffirmationTimeout();
        stopAffirmationStream();
        const blob = affirmationChunks.length ? new Blob(affirmationChunks, { type: affirmationRecorder?.mimeType || "audio/webm" }) : null;
        affirmationRecorder = null;
        affirmationChunks = [];
        if (discardAffirmationOnStop) {
          discardAffirmationOnStop = false;
          setAffirmationAudio(null);
          setAffirmationStatus(affirmationStopReason, "neutral");
        } else if (blob) {
          setAffirmationAudio(blob);
          setAffirmationStatus(affirmationStopReason, "good");
        } else if (!state.affirmationAudioUrl) {
          setAffirmationStatus("No audio was captured this time.", "warn");
        }
        updateAffirmationButtons();
      };
      affirmationRecorder.start();
      setAffirmationStatus("Recording... keep it under 2 minutes.", "recording");
      clearAffirmationTimeout();
      affirmationTimeout = setTimeout(() => {
        affirmationStopReason = "Max length reached. Recording saved.";
        stopAffirmationRecording();
      }, 120000);
      updateAffirmationButtons();
    } catch (err) {
      console.error("Affirmation recording error:", err);
      stopAffirmationStream();
      setAffirmationStatus("Microphone access was blocked. Allow it to record an affirmation.", "bad");
      updateAffirmationButtons();
    }
  }

  function stopAffirmationRecording() {
    if (!affirmationRecorder || affirmationRecorder.state === "inactive") return;
    affirmationRecorder.stop();
  }

  function clearAffirmationRecording() {
    if (affirmationRecorder && affirmationRecorder.state !== "inactive") {
      discardAffirmationOnStop = true;
      affirmationStopReason = "Recording cleared.";
      stopAffirmationRecording();
      return;
    }
    setAffirmationAudio(null);
    setAffirmationStatus("Recording cleared. You can make a new one anytime.", "neutral");
    updateAffirmationButtons();
  }

  function playAffirmationRecording() {
    const audio = $("#affirmationPlayback");
    if (!audio || !state.affirmationAudioUrl) {
      setAffirmationStatus("Record a note first, then play it back here.", "warn");
      return;
    }
    audio.play().catch((err) => {
      console.error("Playback error:", err);
      setAffirmationStatus("Playback was blocked by the browser.", "warn");
    });
  }

  function questionnaireDraft() {
    return {
      mood: Number($("#questionMood")?.value || 3),
      motivation: Number($("#questionMotivation")?.value || 3),
      win: $("#questionWin")?.value.trim() || "",
      blocker: $("#questionBlocker")?.value.trim() || "",
      commitment: $("#questionCommitment")?.value.trim() || "",
    };
  }

  function syncQuestionnaireLabels() {
    if ($("#questionMoodVal")) $("#questionMoodVal").textContent = $("#questionMood")?.value || "3";
    if ($("#questionMotivationVal")) $("#questionMotivationVal").textContent = $("#questionMotivation")?.value || "3";
  }

  function saveQuestionnaireDraft() {
    const draft = questionnaireDraft();
    state.questionnaire = draft;
    localStorage.setItem(QUESTIONNAIRE_STORAGE_KEY, JSON.stringify(draft));
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if ($("#questionnaireSaved")) $("#questionnaireSaved").textContent = `Answers saved locally at ${stamp}.`;
  }

  function loadQuestionnaireDraft() {
    try {
      const raw = localStorage.getItem(QUESTIONNAIRE_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if ($("#questionMood")) $("#questionMood").value = String(draft.mood ?? 3);
      if ($("#questionMotivation")) $("#questionMotivation").value = String(draft.motivation ?? 3);
      if ($("#questionWin")) $("#questionWin").value = draft.win ?? "";
      if ($("#questionBlocker")) $("#questionBlocker").value = draft.blocker ?? "";
      if ($("#questionCommitment")) $("#questionCommitment").value = draft.commitment ?? "";
      state.questionnaire = draft;
      if ($("#questionnaireSaved")) $("#questionnaireSaved").textContent = "Loaded your last local reflection draft.";
    } catch (err) {
      console.warn("Questionnaire draft load failed:", err);
    }
    syncQuestionnaireLabels();
  }

  function resetQuestionnaire() {
    localStorage.removeItem(QUESTIONNAIRE_STORAGE_KEY);
    if ($("#questionMood")) $("#questionMood").value = "3";
    if ($("#questionMotivation")) $("#questionMotivation").value = "3";
    if ($("#questionWin")) $("#questionWin").value = "";
    if ($("#questionBlocker")) $("#questionBlocker").value = "";
    if ($("#questionCommitment")) $("#questionCommitment").value = "";
    syncQuestionnaireLabels();
    if ($("#questionnaireSaved")) $("#questionnaireSaved").textContent = "Answers save locally on this device.";
    state.questionnaire = null;
  }

  function resetReflection() {
    clearAffirmationTimeout();
    if (affirmationRecorder && affirmationRecorder.state !== "inactive") {
      discardAffirmationOnStop = true;
      affirmationStopReason = "Recording cleared.";
      affirmationRecorder.stop();
    }
    stopAffirmationStream();
    affirmationRecorder = null;
    affirmationChunks = [];
    setAffirmationAudio(null);
    setAffirmationPrompt(0);
    setAffirmationStatus("No recording yet. Your clip stays in this browser session.", "neutral");
    updateAffirmationButtons();
    resetQuestionnaire();
  }

  function initReflectionTools() {
    if ($("#affirmationPrompt")) {
      setAffirmationPrompt(randomAffirmationIndex(-1));
      setAffirmationStatus("No recording yet. Your clip stays in this browser session.", "neutral");
      updateAffirmationButtons();
      $("#shuffleAffirmation")?.addEventListener("click", () => setAffirmationPrompt(randomAffirmationIndex()));
      $("#recordAffirmation")?.addEventListener("click", startAffirmationRecording);
      $("#stopAffirmation")?.addEventListener("click", () => {
        affirmationStopReason = "Recording saved.";
        stopAffirmationRecording();
      });
      $("#playAffirmation")?.addEventListener("click", playAffirmationRecording);
      $("#clearAffirmation")?.addEventListener("click", clearAffirmationRecording);
    }

    [
      "#questionMood",
      "#questionMotivation",
      "#questionWin",
      "#questionBlocker",
      "#questionCommitment",
    ].forEach((sel) => {
      $(sel)?.addEventListener("input", () => {
        syncQuestionnaireLabels();
        saveQuestionnaireDraft();
      });
    });
    loadQuestionnaireDraft();
  }

  // ── Step 3: render results ───────────────────────────────────────────────────
  function renderFutureResults() {
    const { months } = state.goals;
    const label = months === 3 ? "3 months" : months === 12 ? "1 year" : "6 months";
    $("#futureSubtitle").textContent = `In ${label}, compare your likely current-path self with your evidence-based ideal self.`;
    renderScienceCard();
    renderProgressBars();
    renderRecommendationCard();
  }

  function recommendationModeLabel() {
    return state.syncedHealth?.raw ? "Based on your data" : "Based on your inputs";
  }

  function prettyRecommendationIssue(issue) {
    switch (issue) {
      case "sleep_deficit": return "Sleep deficit";
      case "high_screen_time": return "High screen time";
      case "low_activity": return "Low activity";
      case "high_stress": return "High stress";
      case "balanced_state": return "Balanced state";
      default: return String(issue || "");
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderRecommendationCard() {
    const el = $("#recommendationCard");
    if (!el) return;

    const mode = recommendationModeLabel();
    const recState = state.recommendation;

    if (recState?.loading) {
      el.innerHTML = `
        <div class="recommendation-head">
          <div class="science-title">Today&rsquo;s Recommendation</div>
          <div class="recommendation-source">${mode}</div>
        </div>
        <p class="recommendation-loading">Generating one focused recommendation…</p>
      `;
      return;
    }

    if (recState?.error) {
      el.innerHTML = `
        <div class="recommendation-head">
          <div class="science-title">Today&rsquo;s Recommendation</div>
          <div class="recommendation-source">${mode}</div>
        </div>
        <p class="recommendation-error">Unable to load a recommendation right now.</p>
      `;
      return;
    }

    if (!recState?.data) {
      el.innerHTML = `
        <div class="recommendation-head">
          <div class="science-title">Today&rsquo;s Recommendation</div>
          <div class="recommendation-source">${mode}</div>
        </div>
        <p class="recommendation-loading">Run your projection to see a grounded, single action for today.</p>
      `;
      return;
    }

    const issue = prettyRecommendationIssue(recState.data.issue);
    const explanation = escapeHtml(recState.data.explanation);
    const action = escapeHtml(recState.data.action);
    const impact = escapeHtml(recState.data.impact);

    el.innerHTML = `
      <div class="recommendation-head">
        <div class="science-title">Today&rsquo;s Recommendation</div>
        <div class="recommendation-source">${mode}</div>
      </div>
      <div class="recommendation-issue"><b>${issue}</b></div>
      <p class="recommendation-explanation">${explanation}</p>
      <div class="recommendation-action">Action: ${action}</div>
      <p class="recommendation-impact">Impact: ${impact}</p>
    `;
  }

  function readOptionalUiNumber(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const val = Number(el.value);
      if (Number.isFinite(val)) return val;
    }
    return null;
  }

  let recommendationRequestId = 0;
  async function refreshRecommendation() {
    if (!state.habits || !state.goals) return;
    if (!$("#recommendationCard")) return;

    const requestId = ++recommendationRequestId;
    state.recommendation = { loading: true, error: null, data: null };
    renderRecommendationCard();

    const payload = {
      sleep: state.habits.sleep,
      steps: state.habits.steps,
      screenTime: state.habits.screenTime,
      activeEnergy: readOptionalUiNumber(["#activeEnergy", "#todayActiveEnergy"]),
      heartRate: readOptionalUiNumber(["#heartRate", "#todayHeartRate"]),
      goal: {
        currentWeight: state.goals.currentWeight,
        targetWeight: state.goals.targetWeight,
        timeframe: state.goals.months,
      },
    };

    try {
      const res = await fetch("/api/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (requestId !== recommendationRequestId) return;
      state.recommendation = { loading: false, error: null, data: json };
      renderRecommendationCard();
    } catch (err) {
      if (requestId !== recommendationRequestId) return;
      console.error("Recommendation error:", err);
      state.recommendation = { loading: false, error: err, data: null };
      renderRecommendationCard();
    }
  }

  function renderScienceCard() {
    const wp  = state.weightPlan;
    const el  = $("#scienceCard");
    const currentPath = state.prediction.same;
    const idealPath = state.prediction.improve;

    if (!wp) {
      el.innerHTML = `
        <div class="science-title">Six-Month Comparison</div>
        <div class="science-goal">Two plausible futures from the same face scan: your current self in 6 months versus your ideal self in 6 months.</div>
        <div class="science-compare-grid">
          <article class="science-compare-card">
            <div class="science-compare-label">Current self path</div>
            <div class="science-compare-score">${currentPath.score}<span>/100</span></div>
            <div class="science-rows">
              <div class="science-row"><span class="science-icon">⚡</span><span>Energy <b>${currentPath.energy}/100</b></span></div>
              <div class="science-row"><span class="science-icon">😴</span><span>Sleep quality <b>${currentPath.sleepQuality}/100</b></span></div>
              <div class="science-row"><span class="science-icon">✨</span><span>Skin health <b>${currentPath.skinHealth}/100</b></span></div>
            </div>
          </article>
          <article class="science-compare-card accent">
            <div class="science-compare-label">Ideal self path</div>
            <div class="science-compare-score">${idealPath.score}<span>/100</span></div>
            <div class="science-rows">
              <div class="science-row"><span class="science-icon">⚡</span><span>Energy <b>${idealPath.energy}/100</b></span></div>
              <div class="science-row"><span class="science-icon">😴</span><span>Sleep quality <b>${idealPath.sleepQuality}/100</b></span></div>
              <div class="science-row"><span class="science-icon">✨</span><span>Skin health <b>${idealPath.skinHealth}/100</b></span></div>
            </div>
          </article>
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
      <div class="science-goal">Lose <b>${wp.kgToLose} kg</b> in <b>${wp.months} months</b>, while comparing your likely current-path self against an ideal self following evidence-based health targets.</div>
      <div class="science-compare-grid">
        <article class="science-compare-card">
          <div class="science-compare-label">Current self path</div>
          <div class="science-compare-score">${currentPath.score}<span>/100</span></div>
          <div class="science-rows">
            <div class="science-row"><span class="science-icon">⚡</span><span>Energy <b>${currentPath.energy}/100</b></span></div>
            <div class="science-row"><span class="science-icon">😴</span><span>Sleep <b>${currentPath.sleepQuality}/100</b></span></div>
            <div class="science-row"><span class="science-icon">⏳</span><span>Age shift <b>${currentPath.ageShift} yrs</b></span></div>
          </div>
        </article>
        <article class="science-compare-card accent">
          <div class="science-compare-label">Ideal self path</div>
          <div class="science-compare-score">${idealPath.score}<span>/100</span></div>
          <div class="science-rows">
            <div class="science-row"><span class="science-icon">⚡</span><span>Energy <b>${idealPath.energy}/100</b></span></div>
            <div class="science-row"><span class="science-icon">😴</span><span>Sleep <b>${idealPath.sleepQuality}/100</b></span></div>
            <div class="science-row"><span class="science-icon">⏳</span><span>Age shift <b>${idealPath.ageShift} yrs</b></span></div>
          </div>
        </article>
      </div>
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
    const rawDays = syncedHistoryDays();
    const todayKey = isoDate(new Date());
    const days = rawDays.map((day) =>
      day.date === todayKey ? applySliderOverridesToSyncedDay(day) : day
    );
    if (!days.length) {
      return {
        mode: "missing",
        source: "Awaiting Apple Health",
        lastSync: state.syncedHealth ? lastSyncLabel(state.syncedHealth.syncedAt) : "Not synced yet",
        dayCount: 0,
      };
    }

    const today = days[days.length - 1];
    const sleepAvg = averageOf(days, "sleep");
    const workoutHits = countHits(days, "workoutMetGoal");
    const sleepHits = countHits(days, "sleepMetGoal");
    const stepAvg = averageOf(days, "steps");

    return {
      mode: "observed",
      source: state.syncedHealth?.source || "Apple Health",
      lastSync: lastSyncLabel(state.syncedHealth?.syncedAt),
      dayCount: days.length,
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

  function renderTodayProgress(today) {
    const dailyGoal = dailyGoalMetricRows(today);
    const sleepChip = today.sleep.value == null
      ? { label: "awaiting sleep", tone: "neutral" }
      : today.sleep.value >= HEALTH_GOALS.sleep
        ? { label: "goal cleared", tone: "met" }
        : { label: sleepDeltaText({ sleep: today.sleep.value }), tone: "miss" };
    const activeChip = today.activeEnergy.value == null
      ? { label: "awaiting move", tone: "neutral" }
      : today.activeEnergy.value >= HEALTH_GOALS.activeEnergy
        ? { label: "workout counted", tone: "met" }
        : { label: `${Math.round(today.activeEnergy.value)} / ${HEALTH_GOALS.activeEnergy} kcal`, tone: "miss" };
    const stepChip = today.steps.value == null
      ? { label: "awaiting steps", tone: "neutral" }
      : today.steps.value >= HEALTH_GOALS.steps
        ? { label: "goal cleared", tone: "met" }
        : { label: `${Math.round(today.steps.value).toLocaleString()} / ${HEALTH_GOALS.steps.toLocaleString()}`, tone: "neutral" };
    const bpmChip = heartRateChip(today.heartRate);

    const card = (label, valueText, detail, chip, source) => `
      <article class="today-progress-card">
        <div class="today-progress-label">${label}</div>
        <div class="today-progress-value">${valueText}</div>
        <div class="today-progress-detail">${detail}</div>
        <div class="today-progress-foot">
          <span class="metric-chip ${chip.tone}">${chip.label}</span>
          <span class="today-progress-source">${todayMetricSourceLabel(source)}</span>
        </div>
      </article>
    `;

    return `
      <section class="today-progress-board">
        <div class="today-progress-head">
          <div>
            <div class="progress-kicker">Today&rsquo;s Progress</div>
            <h3 class="today-progress-title">Live Daily Signals</h3>
            <p class="progress-subhead">This block mixes Apple Health and manual fallback input so you can still track today even if the watch sync is missing a field. The goal-match bars update every day to show how close today is to your ideal path.</p>
          </div>
        </div>
        <div class="goal-match-board">
          <div class="goal-match-head">
            <div>
              <div class="goal-match-label">Today vs Ideal Path</div>
              <div class="goal-match-score">${dailyGoal.overall == null ? "Awaiting data" : `${dailyGoal.overall}% match`}</div>
            </div>
            <div class="goal-match-meta">${dailyGoal.availableCount}/4 signals available today</div>
          </div>
          <div class="goal-match-bars">
            ${dailyGoal.rows.map(row => `
              <div class="goal-match-row">
                <div class="goal-match-copy">
                  <span class="goal-match-name">${row.label}</span>
                  <span class="goal-match-value">${row.valueText}</span>
                </div>
                <div class="goal-match-track">
                  <div class="goal-match-fill ${row.ratio == null ? "empty" : row.ratio >= 0.8 ? "strong" : row.ratio >= 0.55 ? "mid" : "weak"}" style="width:${row.ratio == null ? 0 : Math.round(row.ratio * 100)}%"></div>
                </div>
                <div class="goal-match-side">
                  <span class="goal-match-percent">${row.ratio == null ? "—" : `${Math.round(row.ratio * 100)}%`}</span>
                  <span class="goal-match-source">${todayMetricSourceLabel(row.source)}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="today-progress-grid">
          ${card(
            "Sleep",
            today.sleep.value == null ? "Awaiting" : `${round1(today.sleep.value)}h`,
            `Target ${HEALTH_GOALS.sleep}h nightly`,
            sleepChip,
            today.sleep.source
          )}
          ${card(
            "Active Energy",
            today.activeEnergy.value == null ? "Awaiting" : `${Math.round(today.activeEnergy.value)} kcal`,
            `Move goal ${HEALTH_GOALS.activeEnergy} kcal`,
            activeChip,
            today.activeEnergy.source
          )}
          ${card(
            "Steps",
            today.steps.value == null ? "Awaiting" : `${Math.round(today.steps.value).toLocaleString()}`,
            `Target ${HEALTH_GOALS.steps.toLocaleString()} steps`,
            stepChip,
            today.steps.source
          )}
          ${card(
            "Heart Rate",
            today.heartRate.value == null ? "Awaiting" : `${Math.round(today.heartRate.value)} bpm`,
            heartRateDetail(today.heartRate),
            bpmChip,
            today.heartRate.source
          )}
        </div>
      </section>
    `;
  }

  function streakCardMarkup(label, streak, hits, summary, note, days, key, valueFormatter) {
    return `
      <article class="streak-card">
        <div class="streak-card-label">${label}</div>
        <div class="streak-card-value">${streak ? `${streak}-day streak` : "No streak yet"}</div>
        <div class="streak-card-meta">${hits} / ${days.length} days hit goal · ${summary}</div>
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
    const today = buildTodayProgressModel();
    const weightLine = state.goals.currentWeight > state.goals.targetWeight
      ? `Weight target still needs ${round1(state.goals.currentWeight - state.goals.targetWeight)} kg of progress across ${state.goals.months} months.`
      : `Weight target is set for maintenance over ${state.goals.months} months.`;
    const modeCopy = evidence.mode === "observed"
      ? "Observed from Apple Health, with the current baseline sliders overriding overlapping metrics like sleep or steps when you adjust them."
      : "This board now stays empty until real Apple Health history is synced, so streaks are never inferred from sliders.";

    if (evidence.mode === "missing") {
      $("#progressBars").innerHTML = `
        ${today.hasAny ? renderTodayProgress(today) : ""}
        <section class="progress-ledger">
          <div class="progress-ledger-top">
            <div>
              <div class="progress-kicker">Goal Evidence / Awaiting Sync</div>
              <h3 class="progress-headline">Recovery + Workout Ledger</h3>
              <p class="progress-subhead">${modeCopy} ${weightLine}</p>
            </div>
            <div class="progress-meta">
              <span class="progress-mode">${evidence.source}</span>
              <span class="progress-mode">Sleep clears unavailable</span>
              <span class="progress-mode">Workout clears unavailable</span>
              <span class="progress-mode">Sync ${evidence.lastSync}</span>
            </div>
          </div>

          <div class="progress-empty">
            <div class="progress-empty-title">No synced Apple Health history yet</div>
            <p class="progress-empty-copy">Open the <b>HealthSync</b> iPhone app, point it at this server, and sync your last 7 days. Once those records arrive, this section will show real streaks, real daily sleep, real active energy, real steps, and heart-rate-aware daily progress.</p>
          </div>

          <div class="ledger-footnote">
            Streak scoring is disabled until actual Apple Health days are received.
          </div>
        </section>
      `;
      return;
    }

    $("#progressBars").innerHTML = `
      ${renderTodayProgress(today)}
      <section class="progress-ledger">
        <div class="progress-ledger-top">
          <div>
            <div class="progress-kicker">Goal Evidence / Last 7 Days</div>
            <h3 class="progress-headline">Recovery + Workout Ledger</h3>
            <p class="progress-subhead">${modeCopy} ${weightLine}</p>
          </div>
          <div class="progress-meta">
            <span class="progress-mode ${evidence.mode === "observed" ? "live" : ""}">${evidence.source}</span>
            <span class="progress-mode">${evidence.sleepHits}/${evidence.dayCount} sleep clears</span>
            <span class="progress-mode">${evidence.workoutHits}/${evidence.dayCount} workout clears</span>
            <span class="progress-mode">Avg ${Math.round(evidence.stepAvg).toLocaleString()} steps</span>
            <span class="progress-mode">Sync ${evidence.lastSync}</span>
          </div>
        </div>

        <div class="streak-board">
          ${streakCardMarkup(
            "Sleep goal",
            evidence.sleepStreak,
            evidence.sleepHits,
            `avg ${round1(evidence.sleepAvg)}h vs ${HEALTH_GOALS.sleep}h target across ${evidence.dayCount} synced days`,
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
            `avg ${Math.round(averageOf(evidence.days, "activeEnergy"))} kcal active across ${evidence.dayCount} synced days`,
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
          Apple Health currently feeds last-night sleep, daily steps, active energy, and heart rate into today&rsquo;s progress. The 7-day ledger remains based on synced sleep, movement, and steps.
        </div>
      </section>
    `;
  }

  // ── Two-step avatar generation ───────────────────────────────────────────────
  function avatarUserKeys() {
    return {
      googleKey:  sessionStorage.getItem("googleKey")  || undefined,
      tencentId:  sessionStorage.getItem("tencentId")  || undefined,
      tencentKey: sessionStorage.getItem("tencentKey") || undefined,
    };
  }

  async function call2D(prompt, userKeys) {
    const res = await fetch("/api/generate-2d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: state.selfieDataUrl, prompt, ...userKeys }),
    });
    if (!res.ok) throw new Error(`2D generation failed: ${res.status}`);
    return (await res.json()).image;
  }

  async function generateScenarioAvatar(kind) {
    const cfg = AVATAR_SCENARIOS[kind];
    const goalInfo = { kgToLose: Math.max(0, state.goals.currentWeight - state.goals.targetWeight) };
    const userKeys = avatarUserKeys();
    const ruleBasedPrompt = Predictor.scenarioAvatarPrompt(state.habits, goalInfo, cfg.scenario, state.goalHabits);

    const loadingEl = document.getElementById(cfg.loadingId);
    const loadTextEl = document.getElementById(cfg.loadingTextId);
    const modelEl = document.getElementById(cfg.modelId);
    const img2dEl = document.getElementById(cfg.img2dId);
    const toggleEl = document.getElementById(cfg.toggleId);

    let modifiedImage = null;
    try {
      if (loadTextEl) loadTextEl.textContent = cfg.loadingLabel;

      // Get K2 prompt, fall back to rule-based if K2 API fails
      let prompt = ruleBasedPrompt;
      try {
        const k2Res = await fetch("/api/generate-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ habits: state.habits, goalHabits: state.goalHabits, scenario: cfg.scenario, goalInfo }),
        });
        if (k2Res.ok) ({ prompt } = await k2Res.json());
      } catch { /* keep ruleBasedPrompt */ }

      // Try 2D with K2 prompt; if Gemini rejects it, retry with rule-based fallback
      try {
        modifiedImage = await call2D(prompt, userKeys);
      } catch (e) {
        if (prompt !== ruleBasedPrompt) {
          console.warn("K2 prompt rejected by Gemini, retrying with rule-based prompt:", e.message);
          modifiedImage = await call2D(ruleBasedPrompt, userKeys);
        } else {
          throw e;
        }
      }

      // 2D ready — show it immediately, reveal toggle with 3D as "generating"
      if (img2dEl) { img2dEl.src = modifiedImage; img2dEl.classList.remove("hidden"); }
      loadingEl.style.display = "none";
      if (toggleEl) {
        toggleEl.classList.remove("hidden");
        const btn3d = toggleEl.querySelector('[data-view="3d"]');
        const btn2d = toggleEl.querySelector('[data-view="2d"]');
        if (btn2d) { btn2d.classList.add("active"); }
        if (btn3d) { btn3d.disabled = true; btn3d.classList.remove("active"); btn3d.textContent = "3D Generating…"; }
      }

      const res3d = await fetch("/api/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: modifiedImage, ...userKeys }),
      });
      if (!res3d.ok) throw new Error(`3D submit failed: ${res3d.status}`);
      const { jobId } = await res3d.json();

      const modelUrl = await pollJob(jobId);
      // 3D ready — switch to 3D view and enable toggle
      if (img2dEl) img2dEl.classList.add("hidden");
      modelEl.style.display = "block";
      modelEl.setAttribute("src", `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`);
      modelEl.addEventListener("error", (e) => console.error("model-viewer error:", e), { once: true });
      if (toggleEl) {
        const btn3d = toggleEl.querySelector('[data-view="3d"]');
        const btn2d = toggleEl.querySelector('[data-view="2d"]');
        if (btn3d) { btn3d.disabled = false; btn3d.textContent = "3D Model"; btn3d.classList.add("active"); }
        if (btn2d) btn2d.classList.remove("active");
      }
    } catch (err) {
      console.error(`${kind} future avatar error:`, err);
      if (modifiedImage && img2dEl) {
        // 3D failed but 2D succeeded — show 2D directly
        loadingEl.style.display = "none";
        img2dEl.classList.remove("hidden");
        if (toggleEl) {
          toggleEl.classList.remove("hidden");
          const btn3d = toggleEl.querySelector('[data-view="3d"]');
          if (btn3d) { btn3d.disabled = true; btn3d.classList.remove("active"); }
          const btn2d = toggleEl.querySelector('[data-view="2d"]');
          if (btn2d) btn2d.classList.add("active");
        }
      } else {
        loadingEl.innerHTML =
          `<p class="hint avatar-error">Generation unavailable.<br><small>${err.message}</small></p>`;
      }
    }
  }

  async function generateComparisonAvatars() {
    await Promise.allSettled([
      generateScenarioAvatar("same"),
      generateScenarioAvatar("improve"),
    ]);
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
  async function populateScenarioCoach(kind) {
    const cfg = AVATAR_SCENARIOS[kind];
    const coachEl = document.getElementById(cfg.coachId);
    coachEl.textContent = "Thinking…";
    const projection = cfg.scenario === "same" ? state.prediction.same : state.prediction.improve;
    const msg = await Coach.coachMessage(cfg.scenario, state.habits, projection);
    const wp  = state.weightPlan;
    const suffix = (wp && wp.kgToLose > 0 && wp.isFeasible && cfg.scenario === "improve")
      ? ` Your ${wp.months}-month target: lose ${wp.kgToLose} kg.`
      : "";
    coachEl.textContent = msg + suffix;
  }

  async function populateFutureCoaches() {
    await Promise.allSettled([
      populateScenarioCoach("same"),
      populateScenarioCoach("improve"),
    ]);
  }

  // ── 2D / 3D view toggle ──────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn || btn.disabled) return;
    const target = btn.dataset.target; // "same" or "ideal"
    const view   = btn.dataset.view;   // "2d" or "3d"
    const cfg    = AVATAR_SCENARIOS[target === "same" ? "same" : "improve"];
    if (!cfg) return;

    const modelEl  = document.getElementById(cfg.modelId);
    const img2dEl  = document.getElementById(cfg.img2dId);
    const toggleEl = document.getElementById(cfg.toggleId);

    toggleEl?.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    if (view === "3d") {
      if (modelEl) modelEl.style.display = "block";
      if (img2dEl) img2dEl.classList.add("hidden");
    } else {
      if (modelEl) modelEl.style.display = "none";
      if (img2dEl) img2dEl.classList.remove("hidden");
    }
  });

  // ── Speak button ─────────────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".speak");
    if (!btn) return;
    const targetId = btn.dataset.target;
    const text     = document.getElementById(targetId)?.textContent;
    const modelEl  = document.getElementById(btn.dataset.model);
    const scenario = btn.dataset.scenario || "improve";

    if (btn.classList.contains("playing")) {
      AvatarVoice.stop();
      document.querySelectorAll(".speak.playing").forEach(b => b.classList.remove("playing"));
      return;
    }
    document.querySelectorAll(".speak.playing").forEach(b => b.classList.remove("playing"));
    btn.classList.add("playing");
    const utter = AvatarVoice.speak(text, scenario, modelEl);
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
      goalHabits: null,
      goals: null,
      weightPlan: null,
      prediction: null,
      syncedHealth: null,
      affirmationPromptIndex: 0,
      affirmationAudioUrl: null,
      affirmationAudioBlob: null,
      questionnaire: null,
      recommendation: null,
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

    Object.values(AVATAR_SCENARIOS).forEach(cfg => {
      const loadingEl = document.getElementById(cfg.loadingId);
      const modelEl   = document.getElementById(cfg.modelId);
      const coachEl   = document.getElementById(cfg.coachId);
      const img2dEl   = document.getElementById(cfg.img2dId);
      const toggleEl  = document.getElementById(cfg.toggleId);
      loadingEl.innerHTML = spinnerMarkup(cfg.loadingTextId, cfg.loadingLabel);
      loadingEl.style.display = "";
      modelEl.removeAttribute("src");
      modelEl.style.display = "none";
      coachEl.textContent = "Loading coach…";
      if (img2dEl) { img2dEl.src = ""; img2dEl.classList.add("hidden"); }
      if (toggleEl) {
        toggleEl.classList.add("hidden");
        toggleEl.querySelectorAll(".view-btn").forEach((b, i) => {
          b.disabled = false;
          b.classList.toggle("active", i === 0);
        });
      }
    });

    // Reset goal sliders to defaults
    GOAL_HABITS.forEach(cfg => {
      const input = document.getElementById(cfg.id);
      if (input) {
        input.value = GOAL_HABIT_DEFAULTS[cfg.id];
        updateSlider(cfg, GOAL_HABIT_DEFAULTS[cfg.id], false);
      }
    });
    $("#scienceCard").innerHTML    = "";
    $("#progressBars").innerHTML   = "";
    $("#recommendationCard").innerHTML = "";
    setTodayInputs();
    resetReflection();

    showStep(1);
  });

  $("#restartFromReflection").addEventListener("click", () => $("#restart").click());

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

  initReflectionTools();
})();
