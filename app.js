import { parseAndAnalyseMp4 } from './mp4-parser.js';

const fileInput = document.querySelector('#file-input');
const fileName = document.querySelector('#file-name');
const resultSummary = document.querySelector('#result-summary');
const iframeTableBody = document.querySelector('#iframe-table-body');
const statusBadge = document.querySelector('#status-badge');
const sampleCount = document.querySelector('#sample-count');
const intervalValue = document.querySelector('#interval-value');
const variabilityValue = document.querySelector('#variability-value');

function renderRows(samples, intervals) {
  iframeTableBody.innerHTML = '';

  if (!samples.length) {
    iframeTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty">No sync samples were found in this MP4.</td>
      </tr>
    `;
    return;
  }

  samples.forEach((value, index) => {
    const row = document.createElement('tr');
    const delta = index === 0 ? '—' : intervals[index - 1];

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${value}</td>
      <td>${delta}</td>
      <td>${index === 0 ? 'first sync sample' : (delta === intervals[0] ? 'matches interval' : 'varies')}</td>
    `;

    iframeTableBody.appendChild(row);
  });
}

function setLoadingState(message) {
  resultSummary.textContent = message;
  statusBadge.textContent = 'Analyzing';
  statusBadge.classList.remove('ok', 'warn');
  statusBadge.classList.add('neutral');
}

function renderAnalysis(analysis) {
  const totalSamples = analysis.samples.length;
  sampleCount.textContent = String(totalSamples);
  intervalValue.textContent = analysis.interval === null ? 'N/A' : `${analysis.interval} samples`;
  variabilityValue.textContent = analysis.isConstant ? 'Constant' : 'Variable';

  if (analysis.isConstant && analysis.interval !== null) {
    statusBadge.textContent = 'Constant interval';
    statusBadge.classList.remove('neutral', 'warn');
    statusBadge.classList.add('ok');
  } else {
    statusBadge.textContent = 'Variable interval';
    statusBadge.classList.remove('neutral', 'ok');
    statusBadge.classList.add('warn');
  }

  resultSummary.textContent = analysis.raw;
  renderRows(analysis.samples, analysis.intervals);
}

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  fileName.textContent = file.name;
  setLoadingState(`Reading ${file.name}...`);

  try {
    const bytes = await file.arrayBuffer();
    const analysis = parseAndAnalyseMp4(bytes);
    renderAnalysis(analysis);
  } catch (error) {
    resultSummary.textContent = `Unable to read MP4: ${error.message}`;
    statusBadge.textContent = 'Error';
    statusBadge.classList.remove('ok', 'warn', 'neutral');
    statusBadge.classList.add('warn');
    iframeTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty">The file could not be parsed as an ISO BMFF video container.</td>
      </tr>
    `;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  resultSummary.textContent = 'Upload an MP4 file to inspect its sync samples.';
  statusBadge.textContent = 'Waiting';
  statusBadge.classList.add('neutral');
});
