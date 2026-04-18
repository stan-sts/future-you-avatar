require('dotenv').config();
const express = require('express');
const https = require('https');
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
  const { sleep, exercise, water, steps, diet, stress, smoking, alcohol } = req.body;
  if (sleep == null || steps == null) return res.status(400).json({ error: 'Missing fields' });
  latestHealthData = { sleep, exercise, water, steps, diet, stress, smoking, alcohol, ts: Date.now() };
  console.log('Health sync received:', latestHealthData);
  res.json({ ok: true });
});

// Web app polls here after clicking "Connect"
app.get('/api/health-sync', (req, res) => {
  if (!latestHealthData) return res.json({ data: null });
  // Only serve data that arrived in the last 60 seconds (fresh sync)
  const age = Date.now() - latestHealthData.ts;
  res.json({ data: age < 60_000 ? latestHealthData : null });
});

app.post('/api/generate-2d', wrap(async (req, res) => {
  const { image, prompt, googleKey } = req.body;
  if (!image || !prompt) return res.status(400).json({ error: 'image and prompt are required' });

  const apiKey    = googleKey || process.env.GOOGLE_AI_KEY;
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
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
  const part = data.candidates?.[0]?.content?.parts?.find(p => p.inline_data);
  if (!part) throw new Error('No image returned by Google AI');

  const { mime_type, data: imgData } = part.inline_data;
  res.json({ image: `data:${mime_type};base64,${imgData}` });
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
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
