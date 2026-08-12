import { matchSyncSamplesToAc4, parseAndAnalyseMp4 } from './mp4-parser.js';

const fileInput = document.querySelector('#file-input');
const fileName = document.querySelector('#file-name');
const resultSummary = document.querySelector('#result-summary');
const iframeTableBody = document.querySelector('#iframe-table-body');
const statusBadge = document.querySelector('#status-badge');
const sampleCount = document.querySelector('#sample-count');
const intervalValue = document.querySelector('#interval-value');
const variabilityValue = document.querySelector('#variability-value');
const videoFrameRate = document.querySelector('#video-frame-rate');
const downloadMatchSet = document.querySelector('#download-match-set');
const downloadAc4Locations = document.querySelector('#download-ac4-locations');
let currentMatches = [];
let currentAnalysis = null;

function renderRows(samples, intervals, matches) {
  iframeTableBody.innerHTML = '';

  if (!samples.length) {
    iframeTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">No sync samples were found in this MP4.</td>
      </tr>
    `;
    return;
  }

  samples.forEach((value, index) => {
    const row = document.createElement('tr');
    const delta = index === 0 ? '—' : intervals[index - 1];
    const match = matches[index];

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${value}</td>
      <td>${delta}</td>
      <td>${match.ac4Frame}</td>
      <td>${match.ac4Sample}</td>
      <td>${match.deltaSamples > 0 ? '+' : ''}${match.deltaSamples}</td>
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
  intervalValue.textContent = analysis.interval === null ? 'N/A' : `${analysis.interval} frames`;
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

  resultSummary.textContent = `${analysis.raw}. AC-4 matches use 2048 audio samples at 48 kHz and the nearest native frame boundary.`;
  renderRows(analysis.samples, analysis.intervals, currentMatches);
}

function downloadCsv(view) {
  const isLocationsOnly = view === 'locations';
  const header = isLocationsOnly
    ? 'ac4_frame,ac4_sample'
    : 'video_sample,video_time_seconds,ac4_frame,ac4_sample,ac4_time_seconds,delta_seconds,delta_samples,is_exact';
  const rows = currentMatches.map((match) => (isLocationsOnly
    ? [match.ac4Frame, match.ac4Sample]
    : [
      match.videoSample,
      match.videoTime.toFixed(9),
      match.ac4Frame,
      match.ac4Sample,
      match.ac4Time.toFixed(9),
      match.deltaSeconds.toFixed(9),
      match.deltaSamples,
      match.isExact,
    ]).join(','));
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = isLocationsOnly ? 'ac4-iframe-locations.csv' : 'ac4-iframe-match-set.csv';
  link.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  fileName.textContent = file.name;
  setLoadingState('Reading file...');

  try {
    const bytes = await file.arrayBuffer();
    const analysis = parseAndAnalyseMp4(bytes);
    currentAnalysis = analysis;
    const frameRate = analysis.frameRate;
    if (!Number.isFinite(frameRate) || frameRate <= 0) {
      throw new Error('The MP4 does not contain a usable video frame rate');
    }
    videoFrameRate.value = frameRate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    currentMatches = matchSyncSamplesToAc4(analysis.samples, frameRate);
    downloadMatchSet.disabled = currentMatches.length === 0;
    downloadAc4Locations.disabled = currentMatches.length === 0;
    renderAnalysis(analysis);
  } catch (error) {
    resultSummary.textContent = `Unable to read MP4: ${error.message}`;
    statusBadge.textContent = 'Error';
    statusBadge.classList.remove('ok', 'warn', 'neutral');
    statusBadge.classList.add('warn');
    downloadMatchSet.disabled = true;
    downloadAc4Locations.disabled = true;
    iframeTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">The file could not be parsed as an ISO BMFF video container.</td>
      </tr>
    `;
  }
});

downloadMatchSet.addEventListener('click', () => downloadCsv('full'));
downloadAc4Locations.addEventListener('click', () => downloadCsv('locations'));

window.addEventListener('DOMContentLoaded', () => {
  resultSummary.textContent = 'Upload an MP4 file to inspect its sync samples.';
  statusBadge.textContent = 'Waiting';
  statusBadge.classList.add('neutral');
});
