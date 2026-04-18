(function () {
  const state = { selfieDataUrl: null, habits: null, prediction: null };

  const $ = (sel) => document.querySelector(sel);
  const steps = document.querySelectorAll(".step");
  const SPINNER_HTML = '<div class="spinner"></div><p>Generating 3D avatar…</p>';

  function showStep(n) {
    steps.forEach(s => s.classList.toggle("hidden", Number(s.dataset.step) !== n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --- Step 1: selfie upload ---
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
  $("#back1").addEventListener("click", () => showStep(1));

  // --- Step 2: habits -> predict ---
  $("#predict").addEventListener("click", async () => {
    state.habits = readHabits();
    state.prediction = Predictor.predictBoth(state.habits);
    showStep(3);
    renderResults();
    await Promise.all([
      generateAvatar("same"),
      generateAvatar("improve"),
      populateCoach(),
    ]);
  });

  function readHabits() {
    return Object.fromEntries(
      ["sleep", "exercise", "water", "steps", "diet", "stress", "smoking", "alcohol"]
        .map(f => [f, Number($("#" + f).value)])
    );
  }

  // --- Step 3: render metrics and badges ---
  function renderResults() {
    const { same, improve } = state.prediction;

    $("#sameBadge").textContent    = formatAgeShift(same.ageShift);
    $("#improveBadge").textContent = formatAgeShift(improve.ageShift);
    $("#sameMetrics").innerHTML    = metricsHtml(same);
    $("#improveMetrics").innerHTML = metricsHtml(improve);

    renderConditions("sameConditions",    Predictor.getHealthConditions(state.habits, "same"),    false);
    renderConditions("improveConditions", Predictor.getHealthConditions(state.habits, "improve"), true);
  }

  function renderConditions(elId, conditions, positive) {
    const el = document.getElementById(elId);
    el.innerHTML = conditions.map(c =>
      `<span class="condition-badge ${positive ? "positive" : ""}">${c.icon} ${c.label}</span>`
    ).join("");
  }

  function formatAgeShift(years) {
    if (years === 0) return "feels your age";
    return `feels ${Math.abs(years)} yrs ${years < 0 ? "younger" : "older"}`;
  }

  function metricsHtml(p) {
    return [
      ["Health score", `${p.score}/100`],
      ["Energy",       `${p.energy}/100`],
      ["Skin",         `${p.skinHealth}/100`],
      ["Sleep quality",`${p.sleepQuality}/100`],
      ["Weight drift", `${p.weightDrift > 0 ? "+" : ""}${p.weightDrift} kg`],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");
  }

  // --- Two-step: selfie → 2D modified face → 3D model ---
  async function generateAvatar(scenario) {
    const el = suffix => document.getElementById(`${scenario}${suffix}`);
    const prompt = Predictor.generateAvatarPrompt(state.habits, scenario);

    try {
      // Step 1: generate a 2D face with health state applied
      el("Loading").querySelector("p").textContent = "Generating 2D face…";
      const res2d = await fetch("/api/generate-2d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: state.selfieDataUrl, prompt }),
      });
      if (!res2d.ok) throw new Error(`2D generation failed: ${res2d.status}`);
      const { image: modifiedImage } = await res2d.json();
      // Temporary: show the 2D image in the loading area so you can inspect it
      el("Loading").innerHTML = `<img src="${modifiedImage}" style="max-width:100%;border-radius:8px" /><p style="font-size:12px;color:#888">2D generated — building 3D…</p>`;

      // Step 2: feed the modified 2D image into Hunyuan for 3D
      el("Loading").querySelector("p").textContent = "Generating 3D avatar…";
      const res3d = await fetch("/api/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: modifiedImage }),
      });
      if (!res3d.ok) throw new Error(`3D submit failed: ${res3d.status}`);
      const { jobId } = await res3d.json();

      const modelUrl = await pollJob(jobId);
      const modelEl = el("Model");
      modelEl.style.display = "block";
      el("Loading").style.display = "none";
      modelEl.setAttribute("src", `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`);
      modelEl.addEventListener("error", (e) => console.error(`model-viewer error (${scenario}):`, e), { once: true });

      if (scenario === "same" && (state.habits.sleep < 5 || state.habits.water < 3)) {
        el("Frame").classList.add("effect-dizzy");
      }
    } catch (err) {
      console.error(`Avatar error (${scenario}):`, err);
      el("Loading").innerHTML =
        `<p class="hint avatar-error">Generation unavailable.<br><small>${err.message}</small></p>`;
    }
  }

  // Poll with exponential backoff to reduce unnecessary requests during long jobs
  function pollJob(jobId, intervalMs = 5000) {
    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const res  = await fetch(`/api/avatar-status/${jobId}`);
          const data = await res.json();

          if (data.error)             return reject(new Error(data.error));
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

  // --- Coach messages ---
  async function populateCoach() {
    $("#sameCoach").textContent    = "Thinking…";
    $("#improveCoach").textContent = "Thinking…";
    const [sameMsg, improveMsg] = await Promise.all([
      Coach.coachMessage("same",    state.habits, state.prediction.same),
      Coach.coachMessage("improve", state.prediction.improvedHabits, state.prediction.improve),
    ]);
    $("#sameCoach").textContent    = sameMsg;
    $("#improveCoach").textContent = improveMsg;
  }

  // --- Speak buttons ---
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".speak");
    if (!btn) return;
    const targetId = btn.dataset.target;
    const text     = $("#" + targetId).textContent;
    const scenario = targetId === "improveCoach" ? "improve" : "same";
    const modelEl  = document.getElementById(`${scenario}Model`);

    if (btn.classList.contains("playing")) {
      AvatarVoice.stop();
      clearPlaying();
      return;
    }
    clearPlaying();
    btn.classList.add("playing");
    const utter = AvatarVoice.speak(text, scenario, modelEl);
    Promise.resolve(utter).then(u => {
      if (!u) return;
      const prevEnd = u.onend;
      u.onend = (ev) => { prevEnd?.(ev); btn.classList.remove("playing"); };
    });
  });

  function clearPlaying() {
    document.querySelectorAll(".speak.playing").forEach(b => b.classList.remove("playing"));
  }

  // --- Restart ---
  $("#restart").addEventListener("click", () => {
    AvatarVoice.stop();
    Object.assign(state, { selfieDataUrl: null, habits: null, prediction: null });
    $("#selfieInput").value        = "";
    $("#selfiePreview").innerHTML  = "";
    $("#selfiePreview").classList.add("hidden");
    $("#toStep2").classList.add("hidden");

    ["same", "improve"].forEach(resetScenarioUI);
    showStep(1);
  });

  function resetScenarioUI(scenario) {
    const el = suffix => document.getElementById(`${scenario}${suffix}`);
    el("Loading").innerHTML  = SPINNER_HTML;
    el("Loading").style.display = "";
    el("Model").removeAttribute("src");
    el("Model").style.display   = "none";
    el("Frame").classList.remove("effect-dizzy");
    el("Conditions").innerHTML  = "";
  }

  // --- API key save ---
  const existingKey = sessionStorage.getItem("anthropicKey");
  if (existingKey) $("#keyStatus").textContent = "Key loaded for this session.";
  $("#saveKey").addEventListener("click", () => {
    const val = $("#apiKey").value.trim();
    if (!val) {
      sessionStorage.removeItem("anthropicKey");
      $("#keyStatus").textContent = "Key cleared.";
      return;
    }
    sessionStorage.setItem("anthropicKey", val);
    $("#apiKey").value           = "";
    $("#keyStatus").textContent  = "Key saved for this session.";
  });
})();
