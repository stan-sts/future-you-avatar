require('dotenv').config();
const express = require('express');
const https = require('https');
const os = require('os');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const { generateRecommendation } = require('./recommendation');

const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('.'));

function getTencentClient(secretId, secretKey) {
  return new HunyuanClient({
    credential: {
      secretId:  secretId  || process.env.TENCENT_SECRET_ID,
      secretKey: secretKey || process.env.TENCENT_SECRET_KEY,
    },
    region: 'ap-singapore',
    profile: {
      httpProfile: { endpoint: 'hunyuan.intl.tencentcloudapi.com' },
    },
  });
}

// Wraps async route handlers — removes try/catch boilerplate from every endpoint
const wrap = fn => (req, res) =>
  fn(req, res).catch(err => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  });

// ── Health sync store (in-memory, one client at a time for demo) ─────────────
let latestHealthData = null;

// iOS companion app POSTs data here
app.post('/api/health-sync', (req, res) => {
  const { sleep, exercise, water, steps, screenTime, diet, stress, smoking, alcohol, heartRate, history } = req.body;
  if (sleep == null || steps == null) return res.status(400).json({ error: 'Missing fields' });
  latestHealthData = {
    sleep,
    exercise,
    water,
    steps,
    screenTime: screenTime ?? null,
    diet,
    stress,
    smoking,
    alcohol,
    heartRate: heartRate ?? null,
    history: history || null,
    ts: Date.now(),
  };
  console.log('Health sync received:', latestHealthData);
  res.json({ ok: true });
});

// Web app polls here after clicking "Connect"
app.get('/api/health-sync', (req, res) => {
  if (!latestHealthData) return res.json({ data: null });
  res.json({ data: latestHealthData });
});

// ── K2 Think: generate image prompt from habits ───────────────────────────────
function buildK2MetaPrompt(habits, goalHabits, scenario, goalInfo) {
  const fmt = h =>
    `sleep ${h.sleep}h/night, exercise ${h.exercise} days/week, water ${h.water} glasses/day, ` +
    `${h.steps} steps/day, screen time ${h.screenTime ?? 0}h/day, diet ${h.diet}/10, stress ${h.stress}/10, ` +
    `smoking ${h.smoking} cigs/day, alcohol ${h.alcohol} drinks/week`;

  const PREFIX = 'DSLR photograph of the exact same real person from the reference photo — identical clothing, identical body, full body head to toe, standing confidently on a plain white background';
  const SUFFIX = 'High-end beauty photography, shot on Canon EOS R5, 85mm f/1.4, soft studio lighting. Skin looks real with natural texture, not plastic. NO illustration, NO anime, NO cartoon, NO painting, NO 3D render, NO CGI, NO digital art.';

  if (scenario === 'same') {
    return `You are an expert photorealistic portrait prompt engineer for AI image generation. Your job is to write a single image generation prompt — nothing else.

Here is an example of the exact format and style required:

EXAMPLE INPUT: sleep 5h/night, exercise 1 days/week, water 3 glasses/day, 4000 steps/day, screen time 8h/day, diet 4/10, stress 8/10, smoking 0 cigs/day, alcohol 5 drinks/week. Weight context: wants to lose 4 kg but has not changed habits.
EXAMPLE OUTPUT: ${PREFIX}. This person looks like the realistic outcome of keeping mostly the same habits for 6 months: face still looks slightly fuller with only minimal jaw definition, mild dark circles, faint under-eye puffiness, slightly tired eyes, skin looks a little dry and less luminous, subtle tension in the forehead and expression, a touch of facial puffiness or redness, slight digital fatigue around the eyes with a duller gaze. Keep the person recognizable and real, not glamorized, not idealized, not harshly unhealthy, just plausibly a slightly more fatigued or unchanged version of the same person. ${SUFFIX}

Now generate a prompt for this person:

Current habits: ${fmt(habits)}
Weight context: ${goalInfo.kgToLose > 0 ? `person wants to lose ${goalInfo.kgToLose} kg but has not changed habits` : 'maintaining weight'}

Rules:
- Use the exact same sentence structure and style as the example output above
- Start with: "${PREFIX}."
- Describe realistic appearance after 6 months of THESE specific habits (low sleep → dark circles/puffiness, high stress → tension lines, low water → dry dull skin, smoking → dull skin, high alcohol → facial puffiness, low exercise → less vitality, high screen time → tired or strained eyes, low diet → uneven texture)
- End with: "${SUFFIX}"
- Return ONLY the prompt text, no preamble, no explanation, no markdown`;
  }

  const goalsDesc = goalHabits ? fmt(goalHabits) : 'optimal healthy habits';
  return `You are an expert photorealistic portrait prompt engineer for AI image generation. Your job is to write a single image generation prompt — nothing else.

The goal is a realistic but CLEARLY VISIBLE before-and-after transformation. The improvement must be striking and noticeable — like a genuine 6-month health glow-up — while still looking like the same real person, not retouched or fake.

Here is an example of the exact format and style required:

EXAMPLE INPUT: Current habits: sleep 5h/night, exercise 1 days/week, water 3 glasses/day, 4000 steps/day, screen time 8h/day, diet 4/10, stress 8/10. Goal habits: sleep 8h/night, exercise 5 days/week, water 8 glasses/day, 10000 steps/day, screen time 2h/day, diet 8/10, stress 3/10. Weight goal: lose 4 kg.
EXAMPLE OUTPUT: ${PREFIX}. This person looks noticeably healthier and more attractive than before: clearly leaner face, strikingly more defined jawline and cheekbones, zero dark circles, strikingly bright wide-awake eyes with a deeply rested luminous glow, visibly deeply hydrated plump bouncy skin with natural dewy luminosity, completely smooth forehead with no tension lines, calm radiant confident expression, vibrant healthy athletic glow with natural rosy flush, visibly clearer brighter even skin throughout, eyes that look sharper more rested and less digitally strained. The improvement is clearly visible and striking — like a real before-and-after transformation — while still looking like the same real person. ${SUFFIX}

Now generate a prompt for this person:

Current habits: ${fmt(habits)}
Goal habits: ${goalsDesc}
Weight goal: ${goalInfo.kgToLose > 0 ? `lose ${goalInfo.kgToLose} kg` : 'maintain weight'}

Rules:
- Use the exact same sentence structure and style as the example output above
- Start with: "${PREFIX}."
- Be SPECIFIC and VIVID about each visible change from the goal habits — use strong descriptive words (strikingly, visibly, noticeably, zero, completely). Good sleep → zero dark circles, strikingly bright eyes. High water → visibly plump dewy glowing skin. Low stress → completely smooth forehead, radiant expression. Exercise → healthy vibrant athletic glow. Lower screen time → more rested, focused, less strained eyes. Good diet → clear even bright skin. Weight loss → strikingly leaner face and sharper jaw.
- End with: "The improvement is clearly visible and striking — like a real before-and-after transformation — while still looking like the same real person. ${SUFFIX}"
- Return ONLY the prompt text, no preamble, no explanation, no markdown`;
}

app.post('/api/generate-prompt', wrap(async (req, res) => {
  const { habits, goalHabits, scenario, goalInfo, k2Key } = req.body;
  const apiKey = k2Key || process.env.K2_THINK_KEY;
  if (!apiKey) return res.status(400).json({ error: 'K2 Think API key not configured' });

  const response = await fetch('https://api.k2think.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MBZUAI-IFM/K2-Think-v2',
      messages: [
        { role: 'user', content: buildK2MetaPrompt(habits, goalHabits, scenario, goalInfo) },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`K2 Think error ${response.status}: ${err}`);
  }

  const data = await response.json();
  let raw = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip <think>...</think> reasoning blocks that K2 Think emits before the answer
  const prompt = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!prompt) throw new Error('No prompt returned by K2 Think');
  console.log(`K2 prompt (${scenario}):`, prompt.slice(0, 150) + '…');
  res.json({ prompt });
}));

app.post('/api/generate-2d', wrap(async (req, res) => {
  const { image, prompt, googleKey } = req.body;
  if (!image || !prompt) return res.status(400).json({ error: 'image and prompt are required' });

  const apiKey    = googleKey || process.env.GOOGLE_AI_KEY;
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: base64Data } },
          ],
        }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google AI error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const part  = parts.find(p => p.inlineData) || parts.find(p => p.inline_data);
  if (!part) {
    const textPart = parts.find(p => p.text);
    console.error('Google AI returned no image. Finish reason:', data.candidates?.[0]?.finishReason, '| Text:', textPart?.text?.slice(0, 200));
    throw new Error('No image returned by Google AI');
  }

  const blob      = part.inlineData || part.inline_data;
  const mimeType  = blob.mimeType  || blob.mime_type;
  const imgData   = blob.data;
  res.json({ image: `data:${mimeType};base64,${imgData}` });
}));

app.post('/api/generate-avatar', wrap(async (req, res) => {
  const { image, tencentId, tencentKey } = req.body;
  if (!image) return res.status(400).json({ error: 'image is required' });

  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const result = await getTencentClient(tencentId, tencentKey).request('SubmitHunyuanTo3DProJob', { ImageBase64: base64 });
  console.log('Submitted image-to-3D job:', result.JobId);
  res.json({ jobId: result.JobId });
}));

app.get('/api/avatar-status/:jobId', wrap(async (req, res) => {
  const raw = await getTencentClient().request('QueryHunyuanTo3DProJob', { JobId: req.params.jobId });
  console.log('Raw response:', JSON.stringify(raw));

  const rawStatus = (raw.Status || raw.status || '').toLowerCase();
  let status = 'processing';
  if (['succeed', 'success', 'completed', 'done'].includes(rawStatus)) status = 'succeed';
  else if (['failed', 'fail', 'error'].includes(rawStatus))            status = 'failed';

  const glbEntry = Array.isArray(raw.ResultFile3Ds) &&
    (raw.ResultFile3Ds.find(f => f.Type === 'GLB') || raw.ResultFile3Ds[0]);
  const modelUrl = raw.ModelUrl || raw.GlbUrl || raw.Url ||
    (glbEntry && glbEntry.Url) ||
    (Array.isArray(raw.ModelFileUrls) ? raw.ModelFileUrls[0] : null);

  console.log('Job', req.params.jobId, '->', status, modelUrl ? '(has URL)' : '');
  res.json({ status, modelUrl });
}));

// Proxy 3D model files to avoid browser CORS restrictions
app.get('/api/proxy-model', (req, res) => {
  const url = decodeURIComponent(req.query.url || '');
  if (!url.startsWith('https://')) return res.status(400).send('Invalid URL');

  const request = https.get(url, (upstream) => {
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Access-Control-Allow-Origin', '*');
    upstream.pipe(res);
  });

  request.on('error', (err) => {
    if (!res.headersSent) res.status(502).send(err.message);
  });

  // Kill the proxy if the upstream stalls
  request.setTimeout(30_000, () => {
    request.destroy();
    if (!res.headersSent) res.status(504).send('Upstream timeout');
  });
});

// ── K2 Think: single constrained recommendation after results ────────────────
app.post('/api/recommendation', wrap(async (req, res) => {
  const { sleep, steps, activeEnergy, heartRate, screenTime, goal, k2Key } = req.body || {};
  const recommendation = await generateRecommendation(
    { sleep, steps, activeEnergy, heartRate, screenTime, goal },
    { apiKey: k2Key || process.env.K2_THINK_KEY }
  );
  res.json(recommendation);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  const urls = Object.values(interfaces)
    .flat()
    .filter(details => details && details.family === 'IPv4' && !details.internal)
    .map(details => `http://${details.address}:${PORT}`);

  urls.forEach(url => console.log(url));
});
