// Rule-based prediction engine + goal calculation.

(function (global) {
  const IDEAL = {
    sleep: 8, exercise: 5, water: 8, steps: 10000,
    diet: 8, stress: 3, smoking: 0, alcohol: 3, screenTime: 2
  };

  function healthScore(h) {
    // Weights sum to 100
    const sleepScore      = clamp01(1 - Math.abs(h.sleep - IDEAL.sleep) / 4) * 14;
    const exerciseScore   = clamp01(h.exercise / IDEAL.exercise) * 16;
    const waterScore      = clamp01(h.water / IDEAL.water) * 7;
    const stepsScore      = clamp01(h.steps / IDEAL.steps) * 11;
    const dietScore       = clamp01(h.diet / IDEAL.diet) * 13;
    const stressScore     = clamp01(1 - (h.stress - IDEAL.stress) / 7) * 11;
    const smokingScore    = clamp01(1 - h.smoking / 20) * 11;
    const alcoholScore    = clamp01(1 - Math.max(0, h.alcohol - IDEAL.alcohol) / 14) * 7;
    const screenTimeScore = clamp01(1 - Math.max(0, (h.screenTime ?? 4) - IDEAL.screenTime) / 12) * 10;
    return Math.round(sleepScore + exerciseScore + waterScore + stepsScore +
                      dietScore + stressScore + smokingScore + alcoholScore + screenTimeScore);
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round1(x) { return Math.round(x * 10) / 10; }

  function idealHabits() {
    return {
      sleep: IDEAL.sleep,
      exercise: IDEAL.exercise,
      water: IDEAL.water,
      steps: IDEAL.steps,
      diet: IDEAL.diet,
      stress: IDEAL.stress,
      smoking: IDEAL.smoking,
      alcohol: IDEAL.alcohol,
      screenTime: IDEAL.screenTime,
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

  function predictBoth(habits, goalHabits) {
    const same = project(habits, "same");
    const goals = goalHabits || idealHabits();
    const improve = project(goals, "improve");
    return { same, improve, improvedHabits: goals };
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

  function scenarioAvatarPrompt(habits, goalInfo, scenario, goalHabits) {
    const goals = goalHabits || IDEAL;
    const base = 'DSLR photograph of the exact same person from the reference photo — identical clothing, identical body, full body head to toe, standing confidently on a plain white background';
    const camera = 'High-end beauty photography, shot on Canon EOS R5, 85mm f/1.4, soft studio lighting. Skin looks real with natural texture, not plastic. NO illustration, NO anime, NO cartoon, NO painting, NO 3D render, NO CGI, NO digital art.';

    if (scenario === "same") {
      const currentPath = [];

      if (goalInfo.kgToLose > 10) currentPath.push('face still looks heavier and softer around the jawline');
      else if (goalInfo.kgToLose > 3) currentPath.push('face still looks slightly fuller with only minimal jaw definition');

      if (habits.sleep < 7.5) currentPath.push('mild dark circles, faint under-eye puffiness, slightly tired eyes');
      if (habits.water < 7) currentPath.push('skin looks a little dry and less luminous');
      if (habits.stress > 5) currentPath.push('subtle tension in the forehead and expression');
      if (habits.smoking > 0) currentPath.push('slightly duller skin tone');
      if (habits.alcohol > 3) currentPath.push('a touch of facial puffiness or redness');
      if (habits.exercise < 4) currentPath.push('less athletic energy and less physical vitality');
      if (habits.diet < 7) currentPath.push('skin texture looks more uneven');
      if ((habits.screenTime ?? 4) > 6) currentPath.push('strained eyes, subtle digital fatigue visible around the eyes, slightly dull unfocused gaze');

      const desc = currentPath.length
        ? currentPath.join(', ')
        : 'mostly similar to today with only subtle natural aging and very limited improvement';

      return `${base}. This person looks like the realistic outcome of keeping mostly the same habits for 6 months: ${desc}. Keep the person recognizable and real, not glamorized, not idealized, not harshly unhealthy, just plausibly a slightly more fatigued or unchanged version of the same person. ${camera}`;
    }

    // "improve" scenario
    const improvements = [];
    if (goalInfo.kgToLose > 10) improvements.push('visibly leaner face, strikingly defined cheekbones, sharp jawline, noticeably slimmer facial structure');
    else if (goalInfo.kgToLose > 3) improvements.push('clearly leaner face, noticeably more defined jawline and cheekbones');
    if (goals.sleep >= 7.5) improvements.push('zero dark circles, no under-eye bags whatsoever, strikingly bright and wide-awake eyes, deeply rested luminous glow around the eyes');
    if (goals.water >= 7) improvements.push('visibly deeply hydrated skin, plump bouncy complexion, healthy natural luminosity, skin looks dewy and full of life');
    if (goals.stress <= 5) improvements.push('completely smooth forehead, no tension lines, relaxed open confident expression, calm radiant energy');
    if (goals.smoking === 0 && habits.smoking > 0) improvements.push('dramatically clearer even skin tone, no dullness, no yellowing, noticeably healthier fresher complexion');
    if (goals.alcohol <= 3 && habits.alcohol > 3) improvements.push('no facial redness or puffiness, clean sculpted features, noticeably reduced bloating');
    if (goals.exercise >= 4) improvements.push('vibrant healthy athletic glow, energetic alive look, noticeably more toned and fit appearance, natural rosy flush');
    if (goals.diet >= 7) improvements.push('visibly clearer brighter skin, even healthy colour throughout, smooth refined texture');
    if ((goals.screenTime ?? 4) <= 3 && (habits.screenTime ?? 4) > 5) improvements.push('eyes look noticeably more rested and alert, sharp focused gaze, no digital eye strain or fatigue');

    const desc = improvements.length ? improvements.join(', ') : 'striking luminous glowing skin, bright captivating eyes, radiant well-rested energetic look';
    return `${base}. This person looks noticeably healthier and more attractive than in the reference photo: ${desc}. The improvement must be clearly visible and striking — like a real before-and-after transformation — while still looking like the same real person, not retouched or fake. ${camera}`;
  }

  global.Predictor = { predictBoth, healthScore, calculateWeightPlan, scenarioAvatarPrompt, idealHabits };
})(window);
