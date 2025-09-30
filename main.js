import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import Store from 'electron-store';

const store = new Store({ name: 'settings' });

let mainWindow;
let mergeInProgress = false;


function getDialogParent() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const [firstAvailable] = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return firstAvailable ?? null;
}


function resolveRendererPath() {
  return path.join(app.getAppPath(), 'renderer', 'index.html');

}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    webPreferences: {

      preload: path.join(app.getAppPath(), 'preload.js'),

      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'GLB Animation Merger',
  });

  await mainWindow.loadFile(resolveRendererPath());

  if (process.env.ELECTRON_START_URL === 'devtools') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function getNpxCommand() {
  if (process.platform === 'win32') {
    return 'npx.cmd';
  }
  if (process.platform === 'cygwin') {
    return 'npx.cmd';
  }
  return 'npx';
}


function resolveWorkingDirectory() {
  const configured = store.get('workDir', null);
  if (!configured) {
    return process.cwd();
  }

  try {
    const stats = fs.statSync(configured);
    if (!stats.isDirectory()) {
      throw new Error(`Configured working folder is not a directory: ${configured}`);
    }
    return configured;
  } catch (error) {
    throw new Error(`Configured working folder is not accessible: ${configured}. ${error.message}`);
  }
}

async function runMergeJob(job, workingDir) {

  const { id, files, outputDir, outputName, transforms } = job;

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No GLB files selected for this job.');
  }
  if (!outputDir) {
    throw new Error('No output directory selected.');
  }

  const outputFile = outputName?.trim() ? outputName.trim() : `merged-${id}.glb`;
  const outputPath = path.resolve(outputDir, outputFile);
  const outputParent = path.dirname(outputPath);
  if (!fs.existsSync(outputParent)) {
    throw new Error(`Output directory does not exist: ${outputParent}`);
  }

  const base = files[0];
  const rest = files.slice(1);

  const npxCmd = getNpxCommand();
  const cliArgs = [
    '@gltf-transform/cli',
    'merge',
    base,
    ...rest,
    '--join',
    '--output',
    outputPath,
  ];

  const appliedTransforms = Array.isArray(transforms) && transforms.length
    ? transforms
    : ['dedup', 'prune'];

  for (const transform of appliedTransforms) {
    cliArgs.push('-t', transform);
  }

  sendToRenderer('merge-status', { jobId: id, status: 'running', outputPath });
  sendToRenderer('merge-log', { jobId: id, type: 'info', text: `Running glTF-Transform merge for ${path.basename(outputPath)}...` });

  await new Promise((resolve, reject) => {
    const child = spawn(npxCmd, cliArgs, {

      cwd: workingDir ?? process.cwd(),

      env: { ...process.env },
    });

    child.stdout.on('data', (chunk) => {
      sendToRenderer('merge-log', { jobId: id, type: 'out', text: chunk.toString() });
    });

    child.stderr.on('data', (chunk) => {
      sendToRenderer('merge-log', { jobId: id, type: 'err', text: chunk.toString() });
    });

    child.on('error', (err) => {
      sendToRenderer('merge-log', { jobId: id, type: 'err', text: err.message });
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`glTF-Transform exited with code ${code}`);
        reject(error);
      }
    });
  });

  sendToRenderer('merge-log', { jobId: id, type: 'info', text: `Finished job ${id}. Saved to ${outputPath}` });
  sendToRenderer('merge-status', { jobId: id, status: 'success', outputPath });
}


async function runMergeQueue(jobs, workingDir) {

  for (const job of jobs) {
    sendToRenderer('merge-status', { jobId: job.id, status: 'pending' });
  }

  for (const job of jobs) {
    try {

      await runMergeJob(job, workingDir);

    } catch (err) {
      sendToRenderer('merge-log', { jobId: job.id, type: 'err', text: err?.message ?? String(err) });
      sendToRenderer('merge-status', { jobId: job.id, status: 'failed' });
    }
  }
}

ipcMain.handle('pick-files', async () => {

  const browserWindow = getDialogParent();
  const result = await dialog.showOpenDialog(browserWindow ?? undefined, {

    title: 'Pick one or more .glb files',
    filters: [{ name: 'GLB', extensions: ['glb'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('pick-output-dir', async () => {

  const browserWindow = getDialogParent();
  const result = await dialog.showOpenDialog(browserWindow ?? undefined, {
    title: 'Choose output folder',
    defaultPath: store.get('lastOutputDir', undefined),

    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = result.canceled ? null : result.filePaths[0];
  if (dir) {
    store.set('lastOutputDir', dir);
  }
  return dir;
});


ipcMain.handle('pick-work-dir', async () => {
  const browserWindow = getDialogParent();
  const result = await dialog.showOpenDialog(browserWindow ?? undefined, {
    title: 'Choose working folder',
    defaultPath: store.get('workDir', process.cwd()),

    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = result.canceled ? null : result.filePaths[0];
  if (dir) {
    store.set('workDir', dir);
  }
  return dir;
});

ipcMain.handle('clear-work-dir', async () => {
  if (store.has('workDir')) {
    store.delete('workDir');
    return true;
  }
  return false;
});


ipcMain.handle('get-pref', async (_e, key, fallback) => {
  return store.get(key, fallback);
});

ipcMain.handle('set-pref', async (_e, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('start-merge', async (_e, jobs) => {
  if (mergeInProgress) {
    throw new Error('A merge is already in progress. Please wait.');
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('No jobs to merge.');
  }

  const workingDir = resolveWorkingDirectory();

  mergeInProgress = true;
  sendToRenderer('merge-log', { jobId: null, type: 'info', text: `Starting ${jobs.length} merge job(s)...` });
  sendToRenderer('merge-log', { jobId: null, type: 'info', text: `Using working folder: ${workingDir}` });

  try {
    await runMergeQueue(jobs, workingDir);

    sendToRenderer('merge-log', { jobId: null, type: 'info', text: 'All merge jobs finished.' });
    return { ok: true };
  } catch (err) {
    sendToRenderer('merge-log', { jobId: null, type: 'err', text: err?.message ?? String(err) });
    return { ok: false, error: err?.message ?? String(err) };
  } finally {
    mergeInProgress = false;
  }
});

ipcMain.handle('is-merging', async () => mergeInProgress);
