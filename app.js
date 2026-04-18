(function () {
  const state = { selfieDataUrl: null, habits: null, goals: null, weightPlan: null, prediction: null };

  const $ = (sel) => document.querySelector(sel);
  const steps = document.querySelectorAll(".step");
  const SPINNER_HTML = '<div class="spinner"></div><p id="futureLoadingText">Generating 2D face…</p>';

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
    return {
      sleep:    Math.max(4,    Math.min(9,     rnd(7,   1,   0.5))),
      exercise: Math.max(1,    Math.min(6,     rnd(3,   1,   1))),
      water:    Math.max(3,    Math.min(10,    rnd(6,   2,   1))),
      steps:    Math.max(3000, Math.min(12000, rnd(7500,2000,500))),
      diet:     Math.max(4,    Math.min(8,     rnd(6,   1,   1))),
      stress:   Math.max(3,    Math.min(7,     rnd(5,   1,   1))),
      smoking:  0,
      alcohol:  Math.max(0,    Math.min(5,     rnd(2,   1,   1))),
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
    const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    $("#watchSynced").innerHTML =
      `<span class="sync-dot"></span> Synced from ${source} · ${time}`;

    HABITS.forEach((cfg, i) => {
      const val = data[cfg.id] ?? Number(document.getElementById(cfg.id)?.value ?? 0);
      setTimeout(() => animateSliderTo(cfg, val), i * 80);
    });
  }

  function showStep(n) {
    steps.forEach(s => s.classList.toggle("hidden", Number(s.dataset.step) !== n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

  function renderProgressBars() {
    const h  = state.habits;
    const g  = state.goals;
    const p  = state.prediction;
    const r1 = x => Math.round(x * 10) / 10;

    const bars = [
      g.currentWeight > g.targetWeight ? {
        label:  'Weight',
        icon:   '⚖️',
        from:   `${g.currentWeight} kg`,
        to:     `${g.targetWeight} kg`,
        pct:    0,
        detail: `-${r1(g.currentWeight - g.targetWeight)} kg to lose`,
        color:  '#ffd580',
      } : null,
      {
        label:  'Sleep',
        icon:   '😴',
        from:   `${h.sleep} hrs`,
        to:     '8 hrs/night',
        pct:    Math.round(Math.min(h.sleep / 8, 1) * 100),
        detail: h.sleep >= 8 ? 'On target!' : `+${r1(8 - h.sleep)} hrs needed`,
        color:  '#7af0b1',
      },
      {
        label:  'Exercise',
        icon:   '🏃',
        from:   `${h.exercise} d/w`,
        to:     '5 days/week',
        pct:    Math.round(Math.min(h.exercise / 5, 1) * 100),
        detail: h.exercise >= 5 ? 'On target!' : `+${5 - h.exercise} days/week needed`,
        color:  '#7c9cff',
      },
      {
        label:  'Water',
        icon:   '💧',
        from:   `${h.water} glasses`,
        to:     '8 glasses/day',
        pct:    Math.round(Math.min(h.water / 8, 1) * 100),
        detail: h.water >= 8 ? 'On target!' : `+${8 - h.water} glasses/day needed`,
        color:  '#5be1c4',
      },
      {
        label:  'Health Score',
        icon:   '❤️',
        from:   `${p.same.score}/100`,
        to:     `${p.improve.score}/100`,
        pct:    p.same.score,
        detail: `+${p.improve.score - p.same.score} pts potential`,
        color:  '#ff9a9a',
      },
    ].filter(Boolean);

    $("#progressBars").innerHTML = bars.map(b => `
      <div class="prog-bar-row">
        <div class="prog-bar-header">
          <span class="prog-icon">${b.icon}</span>
          <span class="prog-label">${b.label}</span>
          <span class="prog-from-to">${b.from} <span class="prog-arrow">→</span> <b>${b.to}</b></span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" style="width:${b.pct}%;background:${b.color}"></div>
          <span class="prog-pct">${b.pct}%</span>
        </div>
        <div class="prog-detail">${b.detail}</div>
      </div>
    `).join('');
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
    Object.assign(state, { selfieDataUrl: null, habits: null, goals: null, weightPlan: null, prediction: null });
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
