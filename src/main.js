import './style.css';

document.querySelector('#app').innerHTML = `
  <main class="app-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">PDF Pipeline Studio</p>
        <h1>Build review-ready email PDFs</h1>
        <p class="hero-subtitle">
          Paste email HTML and convert it to a PDF in one click.
        </p>
      </div>
      <div class="hero-cards">
        <article class="hero-card">
          <p class="hero-card-label">API Status</p>
          <p class="hero-card-value">
            <span id="apiState" class="pill" data-state="pending">Checking</span>
          </p>
        </article>
        <article class="hero-card">
          <p class="hero-card-label">Output</p>
          <p class="hero-card-value">Merged PDF Bundle</p>
        </article>
      </div>
    </header>

    <section class="workspace">
      <article class="panel input-panel">
        <div class="panel-head">
          <h2>Source Inputs</h2>
          <span class="panel-note">Multi-line supported</span>
        </div>

        <label class="field-label" for="data">Email HTML</label>
        <textarea id="data" spellcheck="false" placeholder="Paste full email HTML..."></textarea>

        <label class="field-label" for="subject2">Subject Line(s)</label>
        <textarea id="subject2" spellcheck="false" placeholder="One subject per line"></textarea>

        <label class="field-label" for="preheader2">Preheader(s)</label>
        <textarea id="preheader2" spellcheck="false" placeholder="One preheader per line"></textarea>

        <fieldset class="option-box">
          <legend>Rendering Options</legend>

          <label class="option-row" for="mobileView">
            <span class="option-copy">
              <strong>Include Mobile View</strong>
              <small>Add mobile screenshot page to final PDF</small>
            </span>
            <input type="checkbox" id="mobileView" checked />
          </label>

          <label class="option-row" for="shaman">
            <span class="option-copy">
              <strong>Shaman Mode</strong>
              <small>Use shaman width rules while rendering</small>
            </span>
            <input type="checkbox" id="shaman" />
          </label>
        </fieldset>

        <div class="actions">
          <button id="generateBtn" class="primary-btn" type="button">Generate PDF</button>
          <p id="status" aria-live="polite">Ready to generate.</p>
        </div>
      </article>

      <article class="panel preview-panel">
        <div class="preview-head">
          <h2>Live Preview</h2>
          <span>Rendered from current HTML</span>
        </div>
        <iframe id="preview" title="Email Preview"></iframe>
      </article>
    </section>
  </main>
`;

const dataInput = document.getElementById('data');
const subjectInput = document.getElementById('subject2');
const preheaderInput = document.getElementById('preheader2');
const mobileCheckbox = document.getElementById('mobileView');
const shamanCheckbox = document.getElementById('shaman');
const generateButton = document.getElementById('generateBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const apiState = document.getElementById('apiState');

function parseFilename(contentDispositionHeader) {
  if (!contentDispositionHeader) return null;
  const utf8Match = contentDispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) return decodeURIComponent(utf8Match[1]);
  const fallbackMatch = contentDispositionHeader.match(/filename="?([^"]+)"?/i);
  return fallbackMatch ? fallbackMatch[1] : null;
}

function downloadBlob(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.state = isError ? 'error' : 'ok';
}

function setApiState(label, state) {
  apiState.textContent = label;
  apiState.dataset.state = state;
}

async function updateApiHealth() {
  setApiState('Checking', 'pending');

  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`Health check failed (${response.status})`);

    const responseBody = await response.json();
    if (!responseBody.ok) throw new Error('API health endpoint returned not ok');

    setApiState('Online', 'ok');
  } catch {
    setApiState('Offline', 'error');
  }
}

function updatePreview() {
  preview.srcdoc = dataInput.value;
}

updateApiHealth();
setInterval(updateApiHealth, 30000);
updatePreview();
dataInput.addEventListener('input', updatePreview);

generateButton.addEventListener('click', async () => {
  setStatus('Generating PDF... please wait.');
  generateButton.disabled = true;

  const payload = {
    data: dataInput.value.replace(/%%\[[\s\S]*?\]%%/g, ''),
    subject2: subjectInput.value,
    preheader2: preheaderInput.value,
    mobileView: mobileCheckbox.checked,
    shaman: shamanCheckbox.checked,
  };

  try {
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errorBody = await response.json();
        if (errorBody.message) message = errorBody.message;
      } else {
        const errorText = await response.text();
        if (errorText) message = errorText;
      }
      throw new Error(message);
    }

    const pdfBlob = await response.blob();
    const fileName = parseFilename(response.headers.get('content-disposition')) || 'merged.pdf';
    downloadBlob(pdfBlob, fileName);
    setStatus(`PDF downloaded: ${fileName}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  } finally {
    generateButton.disabled = false;
  }
});
