require('dotenv').config();
const express = require('express');
const https = require('https');
const os = require('os');
const tencentcloud = require('tencentcloud-sdk-nodejs');

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
  const { sleep, exercise, water, steps, diet, stress, smoking, alcohol, heartRate, history } = req.body;
  if (sleep == null || steps == null) return res.status(400).json({ error: 'Missing fields' });
  latestHealthData = {
    sleep,
    exercise,
    water,
    steps,
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
    `${h.steps} steps/day, diet ${h.diet}/10, stress ${h.stress}/10, ` +
    `smoking ${h.smoking} cigs/day, alcohol ${h.alcohol} drinks/week`;

  const PREFIX = 'DSLR photograph of the exact same real person from the reference photo — identical clothing, identical body, full body head to toe, standing confidently on a plain white background.';
  const SUFFIX = 'High-end beauty photography, shot on Canon EOS R5, 85mm f/1.4, soft studio lighting. Skin looks real with natural texture, not plastic. NO illustration, NO anime, NO cartoon, NO painting, NO 3D render, NO CGI, NO digital art.';

  if (scenario === 'same') {
    return `You are an expert photorealistic portrait prompt engineer for AI image generation.

Generate a prompt describing a person after 6 months of maintaining their CURRENT habits unchanged.

Current habits: ${fmt(habits)}
Weight context: ${goalInfo.kgToLose > 0 ? `person wants to lose ${goalInfo.kgToLose} kg but has not changed habits` : 'maintaining weight'}

Rules:
- Start with exactly: "${PREFIX}"
- Describe realistic appearance after 6 months of these habits. Low sleep → dark circles. High stress → tension lines. Low water → dry skin. Smoking → dull skin. High alcohol → puffiness. Low exercise → less vitality. Be specific and realistic, not harsh.
- End with exactly: "${SUFFIX}"
- Return ONLY the prompt, no explanation, no markdown.`;
  }

  const goalsDesc = goalHabits ? fmt(goalHabits) : 'optimal healthy habits';
  return `You are an expert photorealistic portrait prompt engineer for AI image generation.

Generate a prompt describing a person after 6 months of achieving their GOAL habits.

Current habits: ${fmt(habits)}
Goal habits: ${goalsDesc}
Weight goal: ${goalInfo.kgToLose > 0 ? `lose ${goalInfo.kgToLose} kg` : 'maintain weight'}

Rules:
- Start with exactly: "${PREFIX}"
- Describe realistic positive appearance changes from achieving the goal habits. Better sleep → bright eyes, no dark circles. More water → hydrated glowing skin. Lower stress → relaxed expression. More exercise → healthy glow. Better diet → even skin tone. Weight loss → leaner face. Be specific.
- End with exactly: "${SUFFIX}"
- Return ONLY the prompt, no explanation, no markdown.`;
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
  const prompt = data.choices?.[0]?.message?.content?.trim();
  if (!prompt) throw new Error('No prompt returned by K2 Think');
  console.log(`K2 prompt (${scenario}):`, prompt.slice(0, 120) + '…');
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
  if (!part) throw new Error('No image returned by Google AI');

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
