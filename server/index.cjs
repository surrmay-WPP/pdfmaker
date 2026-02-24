const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { makePDF } = require('./pdfMaker.cjs');

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/generate-pdf', async (req, res) => {
  try {
    const pdfBytes = await makePDF(req.body || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('PDF generation failed:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate PDF',
    });
  }
});

const frontendCandidates = [
  path.resolve(__dirname, '..', 'dist'),
  path.resolve(__dirname, '..'),
];

const frontendDir = frontendCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'index.html')),
);

if (frontendDir) {
  app.use(express.static(frontendDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`PDF API listening on http://localhost:${port}`);
});
