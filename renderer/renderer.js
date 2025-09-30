const $ = (selector, parent = document) => parent.querySelector(selector);

const jobsContainer = $('#jobsContainer');
const jobTemplate = $('#jobTemplate');
const logEl = $('#log');
const clearLogBtn = $('#clearLogBtn');
const addJobBtn = $('#addJobBtn');
const mergeAllBtn = $('#mergeAllBtn');

let jobIdCounter = 1;
let jobs = [];

function makeJob(partial = {}) {
  return {
    id: jobIdCounter++,
    files: [],
    outputDir: null,
    outputName: '',
    status: 'Idle',
    transforms: ['dedup', 'prune'],
    ...partial,
  };
}

function baseName(filepath) {
  return filepath ? filepath.split(/[/\\]/).pop() : '';
}

function uniqueAppend(list, items) {
  const set = new Set(list);
  for (const item of items) {
    if (!set.has(item)) {
      list.push(item);
      set.add(item);
    }
  }
}

function renderJobs() {
  jobsContainer.innerHTML = '';

  if (jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <h2>No jobs yet</h2>
      <p>Add a merge job to start combining GLB animations.</p>
    `;
    jobsContainer.appendChild(empty);
    return;
  }

  jobs.forEach((job, index) => {
    const fragment = jobTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.job');
    root.dataset.jobId = String(job.id);

    const title = $('.job-title', root);
    title.textContent = `Job ${index + 1}`;

    const statusEl = $('.job-status', root);
    statusEl.textContent = job.status;
    statusEl.className = `job-status status-${job.status.toLowerCase()}`;

    const filesContainer = $('[data-role="files"]', root);
    filesContainer.innerHTML = '';

    if (job.files.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'file-placeholder';
      placeholder.textContent = 'No files selected. Add at least one .glb file.';
      filesContainer.appendChild(placeholder);
    } else {
      job.files.forEach((file, idx) => {
        const pill = document.createElement('div');
        pill.className = 'file-pill';
        pill.dataset.index = String(idx);

        const label = document.createElement('span');
        label.className = 'file-label';
        label.textContent = `${baseName(file)}${idx === 0 ? ' (base)' : ''}`;
        pill.appendChild(label);

        const controls = document.createElement('div');
        controls.className = 'file-pill-actions';

        const upBtn = document.createElement('button');
        upBtn.className = 'ghost';
        upBtn.textContent = '↑';
        upBtn.title = 'Move up';
        upBtn.dataset.action = 'move-up';
        upBtn.disabled = idx === 0;

        const downBtn = document.createElement('button');
        downBtn.className = 'ghost';
        downBtn.textContent = '↓';
        downBtn.title = 'Move down';
        downBtn.dataset.action = 'move-down';
        downBtn.disabled = idx === job.files.length - 1;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'ghost';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove';
        removeBtn.dataset.action = 'remove-file';

        controls.append(upBtn, downBtn, removeBtn);
        pill.appendChild(controls);
        filesContainer.appendChild(pill);
      });
    }

    const outputDirEl = $('[data-role="output-dir"]', root);
    outputDirEl.textContent = job.outputDir || 'Not set';

    const outputNameInput = $('[data-role="output-name"]', root);
    outputNameInput.value = job.outputName;
    outputNameInput.addEventListener('input', (event) => {
      job.outputName = event.target.value;
    });

    root.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      switch (action) {
        case 'remove':
          jobs = jobs.filter((j) => j.id !== job.id);
          renderJobs();
          break;
        case 'duplicate': {
          const clone = makeJob({
            files: [...job.files],
            outputDir: job.outputDir,
            outputName: job.outputName,
            status: 'Idle',
            transforms: [...job.transforms],
          });
          jobs.splice(index + 1, 0, clone);
          renderJobs();
          break;
        }
        case 'add-files':
          pickFilesForJob(job);
          break;
        case 'clear-files':
          job.files = [];
          renderJobs();
          break;
        case 'choose-output':
          chooseOutputDir(job);
          break;
        case 'move-up': {
          const idx = Number(target.closest('.file-pill')?.dataset.index ?? -1);
          if (idx > 0) {
            [job.files[idx - 1], job.files[idx]] = [job.files[idx], job.files[idx - 1]];
            renderJobs();
          }
          break;
        }
        case 'move-down': {
          const idx = Number(target.closest('.file-pill')?.dataset.index ?? -1);
          if (idx >= 0 && idx < job.files.length - 1) {
            [job.files[idx + 1], job.files[idx]] = [job.files[idx], job.files[idx + 1]];
            renderJobs();
          }
          break;
        }
        case 'remove-file': {
          const idx = Number(target.closest('.file-pill')?.dataset.index ?? -1);
          if (idx >= 0) {
            job.files.splice(idx, 1);
            renderJobs();
          }
          break;
        }
        default:
          break;
      }
    });

    jobsContainer.appendChild(fragment);
  });
}

async function pickFilesForJob(job) {
  const selections = await window.glbMerger.pickFiles();
  if (!selections || selections.length === 0) {
    return;
  }
  uniqueAppend(job.files, selections);
  job.status = 'Idle';
  renderJobs();
}

async function chooseOutputDir(job) {
  const dir = await window.glbMerger.pickOutputDir();
  if (dir) {
    job.outputDir = dir;
    await window.glbMerger.setPref('lastOutputDir', dir);
    job.status = 'Idle';
    renderJobs();
  }
}

function log(message, type = 'info', jobId = null) {
  const prefix = jobId ? `[Job ${jobIndex(jobId) ?? jobId}]` : '[App]';
  const decorated = `${new Date().toLocaleTimeString()} ${prefix} ${message}`;
  logEl.textContent += `${decorated}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  logEl.dataset.lastType = type;
}

function jobIndex(jobId) {
  const idx = jobs.findIndex((j) => j.id === jobId);
  return idx >= 0 ? idx + 1 : null;
}

async function handleMergeAll() {
  if (await window.glbMerger.isMerging()) {
    log('A merge is already running. Please wait for it to finish.', 'warn');
    return;
  }

  if (jobs.length === 0) {
    log('Add at least one job before merging.', 'warn');
    return;
  }

  const invalidJobs = jobs.filter((job) => job.files.length === 0 || !job.outputDir);
  if (invalidJobs.length > 0) {
    invalidJobs.forEach((job) => {
      if (job.files.length === 0) {
        log(`Job ${jobIndex(job.id) ?? job.id} has no files selected.`, 'error', job.id);
      }
      if (!job.outputDir) {
        log(`Job ${jobIndex(job.id) ?? job.id} has no output directory.`, 'error', job.id);
      }
    });
    return;
  }

  jobs.forEach((job) => {
    job.status = 'Queued';
  });
  renderJobs();

  const payload = jobs.map((job) => ({
    id: job.id,
    files: job.files,
    outputDir: job.outputDir,
    outputName: job.outputName,
    transforms: job.transforms,
  }));

  try {
    const result = await window.glbMerger.startMerge(payload);
    if (!result?.ok) {
      log(result?.error || 'Merge failed to start.', 'error');
    }
  } catch (error) {
    log(error?.message || String(error), 'error');
  }
}

function updateJobStatus(jobId, status, extra = {}) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.status = statusLabel(status);
  if (extra.outputPath) {
    job.outputName = extra.outputPath.split(/[/\\]/).pop();
  }
  renderJobs();
}

function statusLabel(status) {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'success':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status ?? 'Idle';
  }
}

function setupLogListeners() {
  window.glbMerger.onMergeLog(({ jobId, type, text }) => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      log(line, type, jobId ?? undefined);
    }
  });

  window.glbMerger.onMergeStatus(({ jobId, status, outputPath }) => {
    if (jobId != null) {
      updateJobStatus(jobId, status, { outputPath });
    }
  });
}

function setupUi() {
  addJobBtn.addEventListener('click', async () => {
    const lastOutputDir = await window.glbMerger.getPref('lastOutputDir', null);
    const job = makeJob({ outputDir: lastOutputDir });
    jobs.push(job);
    renderJobs();
  });

  mergeAllBtn.addEventListener('click', handleMergeAll);

  clearLogBtn.addEventListener('click', () => {
    logEl.textContent = '';
  });
}

function init() {
  setupUi();
  setupLogListeners();

  (async () => {
    const lastOutputDir = await window.glbMerger.getPref('lastOutputDir', null);
    jobs.push(makeJob({ outputDir: lastOutputDir }));
    renderJobs();
  })();
}

init();
