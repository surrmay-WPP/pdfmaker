const { app, BrowserWindow } = require('electron');

function startBackendServer() {
    require('./server/index.cjs');
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 900,
        title: "PDF Pipeline Studio"
    });
    win.loadURL('http://localhost:8787');
}

app.whenReady().then(() => {
    startBackendServer();
    setTimeout(createWindow, 800);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});