// Rule-based prediction engine + goal calculation.

(function (global) {
  const IDEAL = {
    sleep: 8, exercise: 5, water: 8, steps: 10000,
    diet: 8, stress: 3, smoking: 0, alcohol: 3
  };

  function healthScore(h) {
    const sleepScore    = clamp01(1 - Math.abs(h.sleep - IDEAL.sleep) / 4) * 15;
    const exerciseScore = clamp01(h.exercise / IDEAL.exercise) * 18;
    const waterScore    = clamp01(h.water / IDEAL.water) * 8;
    const stepsScore    = clamp01(h.steps / IDEAL.steps) * 12;
    const dietScore     = clamp01(h.diet / IDEAL.diet) * 15;
    const stressScore   = clamp01(1 - (h.stress - IDEAL.stress) / 7) * 12;
    const smokingScore  = clamp01(1 - h.smoking / 20) * 12;
    const alcoholScore  = clamp01(1 - Math.max(0, h.alcohol - IDEAL.alcohol) / 14) * 8;
    return Math.round(sleepScore + exerciseScore + waterScore + stepsScore +
                      dietScore + stressScore + smokingScore + alcoholScore);
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round1(x) { return Math.round(x * 10) / 10; }

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

  function project(h, scenario) {
    const score = healthScore(h);
    const deltaFromNeutral = score - 50;
    const mult = scenario === "improve" ? 1.0 : 0.45;
    const energy       = clamp(50 + deltaFromNeutral * mult, 10, 100);
    const skinHealth   = clamp(55 + deltaFromNeutral * 0.9 * mult, 10, 100);
    const sleepQuality = clamp(50 + (h.sleep - 6) * 10 * mult + deltaFromNeutral * 0.5 * mult, 10, 100);
    const ageShift     = round1(-deltaFromNeutral / 12 * (scenario === "improve" ? 1 : 0.6));
    const weightDrift  = round1(-deltaFromNeutral / 20 * (scenario === "improve" ? 1 : 0.5));
    return {
      score,
      energy:       Math.round(energy),
      skinHealth:   Math.round(skinHealth),
      sleepQuality: Math.round(sleepQuality),
      ageShift,
      weightDrift,
    };
  }

  function predictBoth(habits) {
    const same    = project(habits, "same");
    const improved = improvedHabits(habits);
    const improve = project(improved, "improve");
    return { same, improve, improvedHabits: improved };
  }

  // Weight loss plan with calorie science (1 kg fat ≈ 7700 kcal)
  function calculateWeightPlan(currentWeight, targetWeight, months) {
    const kgToLose = currentWeight - targetWeight;
    if (kgToLose <= 0) return null;

    const days             = months * 30;
    const dailyDeficit     = Math.round((kgToLose * 7700) / days);
    const exerciseCalories = Math.round(dailyDeficit * 0.5);
    const dietCalories     = dailyDeficit - exerciseCalories;
    // ~0.05 kcal per step, rounded to nearest 500 steps
    const extraSteps = Math.round(exerciseCalories / 0.05 / 500) * 500;

    return {
      kgToLose: round1(kgToLose),
      months,
      dailyDeficit,
      dietCalories,
      exerciseCalories,
      extraSteps,
      isFeasible: dailyDeficit <= 1000,
    };
  }

  // Build a prompt describing the goal-state appearance for gpt-image-1.
  // Visual changes come from the prompt — not CSS.
  function goalAvatarPrompt(habits, goalInfo) {
    const visuals = [];

    // Weight loss → face structure
    if (goalInfo.kgToLose > 10) visuals.push('visibly leaner face, defined cheekbones, sharper jawline');
    else if (goalInfo.kgToLose > 3) visuals.push('slightly leaner face, more defined jawline');

    // Sleep → eyes
    if (habits.sleep < 6) visuals.push('bright alert eyes, no under-eye bags, no dark circles, well-rested');
    else if (habits.sleep < 7.5) visuals.push('clear rested eyes, no puffiness');

    // Hydration → skin
    if (habits.water < 5) visuals.push('hydrated glowing skin, plump and radiant complexion');

    // Stress → expression
    if (habits.stress > 6) visuals.push('smooth relaxed forehead, calm serene expression');

    // Smoking → skin tone
    if (habits.smoking > 3) visuals.push('clear even skin tone, no yellowing or dullness');

    // Alcohol → facial puffiness
    if (habits.alcohol > 6) visuals.push('no facial redness, no puffiness, clean skin');

    // Exercise → glow
    if (habits.exercise < 3) visuals.push('healthy active glow, energetic appearance');

    // Diet → skin clarity
    if (habits.diet < 5) visuals.push('clear bright skin, healthy colour');

    const desc = visuals.length
      ? visuals.join(', ')
      : 'healthy glowing skin, bright clear eyes, well-rested confident look';

    return `Realistic human bust portrait, ${desc}, natural neutral pose, photorealistic texture, plain light grey background, studio lighting, no exaggeration`;
  }

  global.Predictor = { predictBoth, healthScore, calculateWeightPlan, goalAvatarPrompt };
})(window);
