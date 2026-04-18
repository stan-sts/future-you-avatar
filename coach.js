// GPT motivational coach persona.
// Tries the Anthropic API if a key is saved in sessionStorage; otherwise
// falls back to a rule-based templated message so the demo always works.

(function (global) {
  const MODEL = "claude-opus-4-7";
  const SYSTEM_PROMPT = `You are "Future You", a warm, candid motivational coach
speaking directly to a person about their own 6-month future based on their
current habits. Speak in FIRST PERSON as their future self. Keep it to
3-4 sentences, concrete and specific to the habits they mentioned. No emojis,
no lists, no preamble. If the scenario is "stay the same", be honestly
concerned but caring. If "improve", be proud and encouraging.`;

  async function coachMessage(scenario, habits, projection) {
    const key = sessionStorage.getItem("anthropicKey");
    if (key) {
      try {
        return await callAnthropic(key, scenario, habits, projection);
      } catch (err) {
        console.warn("Anthropic call failed, using fallback:", err);
        return fallbackMessage(scenario, habits, projection);
      }
    }
    return fallbackMessage(scenario, habits, projection);
  }

  async function callAnthropic(key, scenario, habits, projection) {
    const userMsg = `Scenario: ${scenario === "improve" ? "I improved my habits" : "I kept the same habits"}.
Current habits: ${habitsLine(habits)}.
Projected 6-month outcome: health score ${projection.score}/100,
energy ${projection.energy}/100, skin ${projection.skinHealth}/100,
sleep quality ${projection.sleepQuality}/100, biological-age shift ${projection.ageShift} yrs,
weight drift ${projection.weightDrift} kg.
Speak to me as Future Me.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error("Empty response");
    return text;
  }

  function habitsLine(h) {
    return `sleep ${h.sleep}h, exercise ${h.exercise}d/wk, water ${h.water} glasses, ` +
      `${h.steps} steps/d, diet ${h.diet}/10, stress ${h.stress}/10, ` +
      `${h.smoking} cigs/d, ${h.alcohol} drinks/wk`;
  }

  function fallbackMessage(scenario, habits, projection) {
    const weakest = findWeakest(habits);
    const strongest = findStrongest(habits);

    if (scenario === "improve") {
      return `Six months from now, I can feel the difference. Raising ${weakest.label} ` +
        `and holding onto ${strongest.label} pushed my energy to ${projection.energy}/100 ` +
        `and shaved about ${Math.abs(projection.ageShift)} years off how old I feel. ` +
        `I'm glad you started — every small habit compounded, and I'm proud of us.`;
    }

    return `Six months from now, not much has changed — and I can feel it. ` +
      `${weakest.label} is still dragging me down, my energy sits at ${projection.energy}/100, ` +
      `and I look about ${Math.abs(projection.ageShift)} years older than I should. ` +
      `It's not too late. One small change this week would mean so much to me.`;
  }

  function findWeakest(h) {
    const gaps = [
      { label: "sleep",    gap: Math.abs(h.sleep - 8) / 8 },
      { label: "exercise", gap: (5 - h.exercise) / 5 },
      { label: "water",    gap: (8 - h.water) / 8 },
      { label: "steps",    gap: (10000 - h.steps) / 10000 },
      { label: "diet",     gap: (8 - h.diet) / 8 },
      { label: "stress",   gap: (h.stress - 3) / 7 },
      { label: "smoking",  gap: h.smoking / 20 },
      { label: "alcohol",  gap: Math.max(0, h.alcohol - 3) / 14 },
    ].filter(x => x.gap > 0);
    gaps.sort((a, b) => b.gap - a.gap);
    return gaps[0] || { label: "consistency", gap: 0 };
  }

  function findStrongest(h) {
    const strengths = [
      { label: "sleep",    s: 1 - Math.abs(h.sleep - 8) / 8 },
      { label: "exercise", s: h.exercise / 5 },
      { label: "hydration",s: h.water / 8 },
      { label: "steps",    s: h.steps / 10000 },
      { label: "diet",     s: h.diet / 10 },
      { label: "calm",     s: 1 - h.stress / 10 },
    ];
    strengths.sort((a, b) => b.s - a.s);
    return strengths[0];
  }

  global.Coach = { coachMessage };
})(window);
