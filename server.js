require('dotenv').config();
const express = require('express');
const https = require('https');
const { OpenAI } = require('openai');
const tencentcloud = require('tencentcloud-sdk-nodejs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('.'));

const client = new HunyuanClient({
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: 'ap-singapore',
  profile: {
    httpProfile: { endpoint: 'hunyuan.intl.tencentcloudapi.com' },
  },
});

// Wraps async route handlers — removes try/catch boilerplate from every endpoint
const wrap = fn => (req, res) =>
  fn(req, res).catch(err => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  });

app.post('/api/generate-2d', wrap(async (req, res) => {
  const { image, prompt } = req.body;
  if (!image || !prompt) return res.status(400).json({ error: 'image and prompt are required' });

  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const imageFile = new File([Buffer.from(base64Data, 'base64')], 'selfie.jpg', { type: 'image/jpeg' });

  const response = await openai.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt,
    n: 1,
    size: '1024x1024',
  });

  res.json({ image: `data:image/png;base64,${response.data[0].b64_json}` });
}));

app.post('/api/generate-avatar', wrap(async (req, res) => {
  const { image, prompt } = req.body;
  if (!image) return res.status(400).json({ error: 'image is required' });

  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const result = await client.request('SubmitHunyuanTo3DProJob', { ImageBase64: base64 });
  console.log('Submitted image-to-3D job:', result.JobId);
  res.json({ jobId: result.JobId });
}));

app.get('/api/avatar-status/:jobId', wrap(async (req, res) => {
  const raw = await client.request('QueryHunyuanTo3DProJob', { JobId: req.params.jobId });
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
