// Rule-based prediction engine.
// Takes a habits object and returns projected 6-month outcomes
// for two scenarios: "same" and "improve".

(function (global) {
  const IDEAL = {
    sleep: 8, exercise: 5, water: 8, steps: 10000,
    diet: 8, stress: 3, smoking: 0, alcohol: 3
  };

  // Weights for a simple "health score" (0-100).
  // Higher is better. Stress, smoking, alcohol are penalties.
  function healthScore(h) {
    const sleepScore    = clamp01(1 - Math.abs(h.sleep - IDEAL.sleep) / 4) * 15;
    const exerciseScore = clamp01(h.exercise / IDEAL.exercise) * 18;
    const waterScore    = clamp01(h.water / IDEAL.water) * 8;
    const stepsScore    = clamp01(h.steps / IDEAL.steps) * 12;
    const dietScore     = clamp01(h.diet / IDEAL.diet) * 15;
    const stressScore   = clamp01(1 - (h.stress - IDEAL.stress) / 7) * 12;
    const smokingScore  = clamp01(1 - h.smoking / 20) * 12;
    const alcoholScore  = clamp01(1 - Math.max(0, h.alcohol - IDEAL.alcohol) / 14) * 8;
    const total = sleepScore + exerciseScore + waterScore + stepsScore +
                  dietScore + stressScore + smokingScore + alcoholScore;
    return Math.round(total);
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // Improvement model: move each habit ~40% toward the ideal over 6 months.
  function improvedHabits(h) {
    const step = (v, ideal) => v + (ideal - v) * 0.4;
    return {
      sleep:    round1(step(h.sleep,    IDEAL.sleep)),
      exercise: Math.round(step(h.exercise, IDEAL.exercise)),
      water:    Math.round(step(h.water,    IDEAL.water)),
      steps:    Math.round(step(h.steps,    IDEAL.steps) / 500) * 500,
      diet:     Math.round(step(h.diet,     IDEAL.diet)),
      stress:   Math.round(step(h.stress,   IDEAL.stress)),
      smoking:  Math.round(step(h.smoking,  IDEAL.smoking)),
      alcohol:  Math.round(step(h.alcohol,  IDEAL.alcohol)),
    };
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // Project weight/energy/skin/age-feel over 6 months.
  // Coarse heuristics -- good enough for MVP.
  function project(h, scenario) {
    const score = healthScore(h);
    const deltaFromNeutral = score - 50;  // -50..+50

    // Scenario multiplier: "same" just compounds the current trajectory;
    // "improve" uses the improved habits with a +boost.
    const mult = scenario === "improve" ? 1.0 : 0.45;

    const energy = clamp(50 + deltaFromNeutral * mult, 10, 100);
    const skinHealth = clamp(55 + deltaFromNeutral * 0.9 * mult, 10, 100);
    const sleepQuality = clamp(50 + (h.sleep - 6) * 10 * mult + deltaFromNeutral * 0.5 * mult, 10, 100);

    // "Biological age shift" in years: negative score -> you look/feel older.
    const ageShift = round1(-deltaFromNeutral / 12 * (scenario === "improve" ? 1 : 0.6));

    // Weight drift: poor habits tend to drift up; good habits stable/down.
    const weightDrift = round1(-deltaFromNeutral / 20 * (scenario === "improve" ? 1 : 0.5));

    return {
      score,
      energy: Math.round(energy),
      skinHealth: Math.round(skinHealth),
      sleepQuality: Math.round(sleepQuality),
      ageShift,      // years (negative = younger-looking)
      weightDrift,   // kg (negative = loss)
    };
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function predictBoth(habits) {
    const same = project(habits, "same");
    const improved = improvedHabits(habits);
    const improve = project(improved, "improve");
    return { same, improve, improvedHabits: improved };
  }

  // Build a descriptive text prompt for the Hunyuan text-to-3D API
  function generateAvatarPrompt(habits, scenario) {
    if (scenario === 'improve') {
      return 'Realistic 3D human bust portrait of a healthy adult, clear bright eyes, smooth glowing skin, ' +
        'well-rested relaxed expression, natural neutral pose, photorealistic texture, plain light grey background, ' +
        'studio lighting, no exaggeration';
    }

    const issues = [];
    if (habits.water < 4)      issues.push('mild dark circles under eyes');
    if (habits.sleep < 5)      issues.push('tired droopy eyelids, slight puffiness under eyes');
    else if (habits.sleep < 7) issues.push('slightly puffy eyes');
    if (habits.stress > 7)     issues.push('furrowed brow, tense expression');
    if (habits.smoking > 5)    issues.push('dull slightly yellowish skin tone');
    if (habits.alcohol > 7)    issues.push('slight facial redness and puffiness');
    if (habits.exercise < 2)   issues.push('pale complexion, low energy look');
    if (habits.diet < 4)       issues.push('slightly dull skin');

    const desc = issues.length
      ? issues.join(', ')
      : 'neutral expression, average appearance';

    return `Realistic 3D human bust portrait of an adult, ${desc}, natural neutral pose, photorealistic texture, plain light grey background, studio lighting, no exaggeration`;
  }

  // Conditions shown as badge chips in the UI
  function getHealthConditions(habits, scenario) {
    if (scenario === 'improve') {
      const good = [];
      const imp = improvedHabits(habits);
      if (imp.water >= 6)    good.push({ icon: '✨', label: 'Clear eyes' });
      if (imp.sleep >= 7)    good.push({ icon: '⚡', label: 'Well-rested' });
      if (imp.exercise >= 4) good.push({ icon: '💪', label: 'Active glow' });
      if (imp.stress <= 4)   good.push({ icon: '😊', label: 'Calm skin' });
      good.push({ icon: '🌟', label: 'Healthy glow' });
      return good;
    }

    const bad = [];
    if (habits.water < 4)    bad.push({ icon: '🐼', label: 'Panda eyes' });
    if (habits.sleep < 6)    bad.push({ icon: '💫', label: 'Dizziness' });
    if (habits.stress > 7)   bad.push({ icon: '😰', label: 'Stress lines' });
    if (habits.smoking > 5)  bad.push({ icon: '🫁', label: 'Skin aging' });
    if (habits.alcohol > 7)  bad.push({ icon: '🥴', label: 'Inflammation' });
    if (habits.exercise < 2) bad.push({ icon: '😴', label: 'Low energy' });
    if (habits.diet < 4)     bad.push({ icon: '🫶', label: 'Nutrient deficit' });
    return bad;
  }

  global.Predictor = { predictBoth, healthScore, generateAvatarPrompt, getHealthConditions };
})(window);
