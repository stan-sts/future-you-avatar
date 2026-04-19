// Motivational coach — uses K2 Think via the server endpoint.
// Falls back to rule-based template if K2 is unavailable.

(function (global) {
  async function coachMessage(scenario, habits, projection) {
    try {
      const k2Key = sessionStorage.getItem("k2Key") || undefined;
      const res = await fetch("/api/coach-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, habits, projection, k2Key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { message } = await res.json();
      if (message) return message;
      throw new Error("Empty response");
    } catch (err) {
      console.warn("K2 coach failed, using fallback:", err);
      return fallbackMessage(scenario, habits, projection);
    }
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
      { label: "screen-time balance", gap: Math.max(0, (h.screenTime ?? 2) - 2) / 10 },
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
      { label: "screen-time boundaries", s: 1 - Math.max(0, (h.screenTime ?? 2) - 2) / 10 },
      { label: "diet",     s: h.diet / 10 },
      { label: "calm",     s: 1 - h.stress / 10 },
    ];
    strengths.sort((a, b) => b.s - a.s);
    return strengths[0];
  }

  global.Coach = { coachMessage };
})(window);
