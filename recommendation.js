function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function determinePrimaryIssue({ sleep, steps, activeEnergy, heartRate, screenTime }) {
  const s = toNumber(sleep);
  const st = toNumber(screenTime);
  const stepCount = toNumber(steps);
  const kcal = toNumber(activeEnergy);
  const hr = toNumber(heartRate);

  if (s != null && s < 6) return "sleep_deficit";
  if (st != null && st > 5) return "high_screen_time";
  if ((stepCount != null && stepCount < 6000) || (kcal != null && kcal < 200)) return "low_activity";
  if (hr != null && hr > 85) return "high_stress";
  return "balanced_state";
}

const EVIDENCE_MAP = {
  sleep_deficit: [
    "Short sleep duration reduces recovery efficiency and increases fatigue.",
    "Consistently low sleep is associated with appetite dysregulation and reduced exercise performance.",
  ],
  high_screen_time: [
    "High screen time can displace movement and increase sedentary time, lowering daily energy expenditure.",
    "Evening screen exposure can delay sleep onset and reduce sleep quality, impacting recovery and hunger regulation.",
  ],
  low_activity: [
    "Low daily movement reduces calorie burn and can slow progress toward weight and fitness goals.",
    "Regular activity improves insulin sensitivity, mood, and energy levels, making healthy routines easier to sustain.",
  ],
  high_stress: [
    "Elevated resting heart rate can reflect physiological stress load and reduced recovery.",
    "Chronic stress can worsen sleep quality and increase cravings, making weight goals harder to maintain.",
  ],
  balanced_state: [
    "When sleep, movement, and recovery are in a stable range, small consistent actions compound quickly.",
    "Maintaining a balanced baseline supports steady energy and makes goal progress more predictable.",
  ],
};

function issueLabel(issue) {
  switch (issue) {
    case "sleep_deficit": return "Sleep deficit";
    case "high_screen_time": return "High screen time";
    case "low_activity": return "Low activity";
    case "high_stress": return "High stress / elevated heart rate";
    case "balanced_state": return "Balanced state";
    default: return issue;
  }
}

function buildStrictPrompt({ userState, goal, primaryIssue, evidence }) {
  const safeGoal = goal || {};
  const goalLine = [
    `currentWeight=${toNumber(safeGoal.currentWeight) ?? "unknown"}`,
    `targetWeight=${toNumber(safeGoal.targetWeight) ?? "unknown"}`,
    `timeframeMonths=${toNumber(safeGoal.timeframe) ?? "unknown"}`
  ].join(", ");

  const lines = [
    "You are K2 Think V2 acting as a constrained, evidence-grounded health decision engine.",
    "",
    "Task:",
    "- Identify the single highest-impact behavioral bottleneck.",
    "- Generate ONE personalized recommendation that improves the user's trajectory toward their goal.",
    "- Internally reason using: behavior → physiological effect → outcome.",
    "",
    "Strict rules:",
    "- Output EXACTLY one JSON object. No markdown, no commentary.",
    "- Provide ONLY one recommendation (not a list).",
    "- You MUST reference at least one of the user's actual numeric values.",
    "- You MUST quantify the recommendation (time, steps, hours, etc.).",
    "- Avoid generic advice (e.g., 'exercise more', 'sleep better').",
    "- Tie everything directly to the user's goal and timeframe.",
    "- Use the provided evidence snippets. Do NOT invent studies.",
    "",
    "Reasoning requirement:",
    "- Internally simulate the user's trajectory over the timeframe.",
    "- Choose the intervention with the highest impact on closing the gap.",
    "",
    "User state:",
    `sleepHours=${toNumber(userState.sleep) ?? "unknown"}`,
    `steps=${toNumber(userState.steps) ?? "unknown"}`,
    `activeEnergyKcal=${toNumber(userState.activeEnergy) ?? "unknown"}`,
    `heartRateBpm=${toNumber(userState.heartRate) ?? "unknown"}`,
    `screenTimeHours=${toNumber(userState.screenTime) ?? "unknown"}`,
    "",
    `Goal: ${goalLine}`,
    `PRIMARY ISSUE: ${primaryIssue} (${issueLabel(primaryIssue)})`,
    "",
    "Evidence snippets:",
    ...evidence.map((e, i) => `${i + 1}. ${e}`),
    "",
    "Output format (JSON only):",
    '{ "issue": "...", "explanation": "...", "action": "...", "impact": "...", "why_now": "..." }',
    "",
    "Field requirements:",
    '- issue: MUST equal PRIMARY ISSUE exactly.',
    '- explanation: 2–3 sentences, MUST include at least one real user number.',
    '- action: ONE sentence, starts with a verb, includes a measurable target.',
    '- impact: ONE sentence describing effect on energy/recovery/weight over timeframe.',
    '- why_now: ONE sentence explaining urgency using trajectory logic (delay, compounding, etc.).'
  ];

  return lines.join("\n");
}

function stripThinkBlocks(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonObject(text) {
  const raw = stripThinkBlocks(text);
  if (!raw) return null;
  
  // Look for JSON object starting with { and ending with }
  // K2 Think often returns reasoning before the JSON, so find the LAST {...} block
  let lastStart = -1;
  let braceCount = 0;
  let jsonStart = -1;
  
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === '}') {
      if (braceCount === 0) lastStart = i;
      braceCount++;
    } else if (raw[i] === '{') {
      braceCount--;
      if (braceCount === 0 && lastStart > i) {
        jsonStart = i;
        break;
      }
    }
  }
  
  if (jsonStart >= 0 && lastStart > jsonStart) {
    const maybe = raw.slice(jsonStart, lastStart + 1);
    try {
      // Normalize unicode dashes and quotes before parsing
      const normalized = maybe.replace(/[\u2010-\u2015]/g, "-").replace(/[\u201C\u201D]/g, '"');
      const parsed = JSON.parse(normalized);
      console.log('K2 JSON parsed successfully');
      return parsed;
    } catch (err) {
      console.warn("JSON parse failed:", err.message, "Attempted:", maybe.slice(0, 100));
    }
  }
  
  return null;
}

function fallbackRecommendation(primaryIssue, evidence = [], goal = {}, userState = {}) {
  const timeframe = toNumber(goal.timeframe);
  const timeframeLabel = timeframe ? `${timeframe} months` : "your timeframe";

  const sleep = toNumber(userState.sleep);
  const steps = toNumber(userState.steps);
  const screen = toNumber(userState.screenTime);
  const hr = toNumber(userState.heartRate);

  switch (primaryIssue) {
    case "sleep_deficit":
      return {
        issue: primaryIssue,
        explanation: `You're currently getting about ${sleep ?? "low"} hours of sleep, which is below the 7–8 hour range needed for proper recovery. This can increase fatigue and cravings, making it harder to stay consistent with your weight goal.`,
        action: "Set a fixed bedtime tonight that allows at least 7 hours of sleep and stop screen use 30 minutes before.",
        impact: `Improved recovery and energy can stabilize appetite and training consistency over ${timeframeLabel}.`,
        why_now: `At your current sleep level, fatigue compounds daily and can delay your progress by weeks over ${timeframeLabel}.`
      };

    case "high_screen_time":
      return {
        issue: primaryIssue,
        explanation: `Your screen time is around ${screen ?? "high"} hours/day, which reduces movement and often delays sleep. This combination lowers daily energy expenditure and recovery quality.`,
        action: "Set a 30-minute screen-free block tonight and replace it with a 10-minute walk.",
        impact: `Reducing sedentary time and improving sleep can increase consistency and energy over ${timeframeLabel}.`,
        why_now: `This pattern compounds daily and can significantly slow progress if not corrected early.`
      };

    case "low_activity":
      return {
        issue: primaryIssue,
        explanation: `You're averaging about ${steps ?? "low"} steps/day, which is below the ~8,000–10,000 range linked to steady fat loss and energy balance.`,
        action: "Add one 15-minute brisk walk today (~1,500–2,000 extra steps).",
        impact: `A small daily increase in activity can meaningfully improve calorie burn and momentum over ${timeframeLabel}.`,
        why_now: `Without increasing activity, your current pace may not create enough deficit to reach your target on time.`
      };

    case "high_stress":
      return {
        issue: primaryIssue,
        explanation: `Your heart rate (~${hr ?? "elevated"} bpm) suggests higher stress load, which can reduce recovery and increase cravings.`,
        action: "Do a 5-minute breathing reset now (inhale 4s, exhale 6s) and repeat once later today.",
        impact: `Lower stress improves sleep and appetite control, supporting steady progress over ${timeframeLabel}.`,
        why_now: `Unmanaged stress compounds and can quietly derail recovery and consistency.`
      };

    default:
      return {
        issue: "balanced_state",
        explanation: `Your current metrics are relatively stable, which is a strong foundation for consistent progress.`,
        action: "Take a 10-minute walk after your next meal to reinforce your routine.",
        impact: `Consistency at this level helps maintain steady improvement over ${timeframeLabel}.`,
        why_now: `Maintaining momentum now prevents regression and keeps your trajectory stable.`
      };
  }
}

async function generateRecommendation(input, opts = {}) {
  const apiKey = opts.apiKey || process.env.K2_THINK_KEY;
  const userState = {
    sleep: toNumber(input?.sleep),
    steps: toNumber(input?.steps),
    activeEnergy: toNumber(input?.activeEnergy),
    heartRate: toNumber(input?.heartRate),
    screenTime: toNumber(input?.screenTime),
  };
  const goal = {
    currentWeight: toNumber(input?.goal?.currentWeight),
    targetWeight: toNumber(input?.goal?.targetWeight),
    timeframe: toNumber(input?.goal?.timeframe),
  };
 
  const primaryIssue = determinePrimaryIssue({ ...userState });
  const evidence = EVIDENCE_MAP[primaryIssue] || [];

  if (!apiKey) {
    console.log('K2 generating recommendation without apiKey');
    return fallbackRecommendation(primaryIssue, evidence, goal);
  }

  const prompt = buildStrictPrompt({ userState, goal, primaryIssue, evidence });
  const response = await fetch("https://api.k2think.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "MBZUAI-IFM/K2-Think-v2",
      messages: [
        { role: "user", content: prompt },
      ],
      stream: false,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`K2 Think error ${response.status}:`, err);
    return fallbackRecommendation(primaryIssue, evidence, goal, userState);
  }

  const data = await response.json();
  console.log('K2 full response:', JSON.stringify(data, null, 2));
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  console.log('K2 raw response:', raw.slice(0, 300));
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    console.log('K2 parsing failed, using fallback');
    return fallbackRecommendation(primaryIssue, evidence, goal, userState);
  }

  const result = {
    issue: String(parsed.issue || primaryIssue),
    explanation: String(parsed.explanation || "").trim(),
    action: String(parsed.action || "").trim(),
    impact: String(parsed.impact || "").trim(),
    why_now: String(parsed.why_now || "").trim(),
  };

  // Enforce primary issue determinism and required fields.
  result.issue = primaryIssue;
  if (!result.explanation || !result.action || !result.impact || !result.why_now) {
    return fallbackRecommendation(primaryIssue, evidence, goal, userState);
  }

  // Basic guardrail: ensure "action" is one sentence-ish, not a list.
  if (/\n|•|\-|1\./.test(result.action) || result.action.length > 220) {
    return fallbackRecommendation(primaryIssue, evidence, goal);
  }

  return result;
}

module.exports = {
  determinePrimaryIssue,
  EVIDENCE_MAP,
  generateRecommendation,
};

