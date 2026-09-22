const { BrowserWindow, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/** Windows：关掉 DWM 非客户区渲染，尽量减弱矩形阴影 */
function disableWindowsShadow(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 8) return;
    const hwnd = '0x' + buf.readBigUInt64LE(0).toString(16);
    const script = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class LingDwm {
  [DllImport("dwmapi.dll")]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
  [DllImport("user32.dll")]
  public static extern int SetWindowRgn(IntPtr hwnd, IntPtr hRgn, bool bRedraw);
  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
'@
try { Add-Type -TypeDefinition $src -ErrorAction Stop } catch {}
$h = [IntPtr]::new(${hwnd})
$p = 1
[void][LingDwm]::DwmSetWindowAttribute($h, 2, [ref]$p, 4)
$c = 0
[void][LingDwm]::DwmSetWindowAttribute($h, 35, [ref]$c, 4)
[void][LingDwm]::DwmSetWindowAttribute($h, 34, [ref]$c, 4)
`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => {});
  } catch (err) {
    console.error('[dwm] disable shadow failed', err.message);
  }
}

/**
 * Windows 上 DWM 阴影只能尽量削弱，无法在 Electron 内彻底关闭。
 * 不用 SetWindowRgn：GDI 区域无抗锯齿，且 DPI 下易裁歪（边缘毛躁/不对称）。
 * 圆角交给渲染进程 CSS（Chromium 抗锯齿），窗口保持 transparent。
 */
function disableWindowsShadow(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 8) return;
    const hwnd = '0x' + buf.readBigUInt64LE(0).toString(16);
    const script = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class LingDwm {
  [DllImport("dwmapi.dll")]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
}
'@
try { Add-Type -TypeDefinition $src -ErrorAction Stop } catch {}
$h = [IntPtr]::new(${hwnd})
$p = 1
[void][LingDwm]::DwmSetWindowAttribute($h, 2, [ref]$p, 4)
`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => {});
  } catch (err) {
    console.error('[dwm] disable shadow failed', err.message);
  }
}

/** 不再做 HWND 裁形；保留空实现避免旧调用报错 */
function applyWindowPillShape() {}

/** 确保没有残留 region */
function clearWindowShape(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 8) return;
    const hwnd = '0x' + buf.readBigUInt64LE(0).toString(16);
    const script = `
$src = @'
using System;
using System.Runtime.InteropServices;
public static class LingRgnClear {
  [DllImport("user32.dll")]
  public static extern int SetWindowRgn(IntPtr hwnd, IntPtr hRgn, bool bRedraw);
}
'@
try { Add-Type -TypeDefinition $src -ErrorAction Stop } catch {}
$h = [IntPtr]::new(${hwnd})
[void][LingRgnClear]::SetWindowRgn($h, [IntPtr]::Zero, $true)
`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => {});
  } catch (err) {
    console.error('[shape] clear failed', err.message);
  }
}

/**
 * 灵动面板窗口
 *
 * 产品原则（用户反馈优先）：
 * 1. 默认独立悬浮于所有应用之上（screen-saver 级置顶）
 * 2. 点击胶囊必须完整展开工作台；UI 与窗口尺寸强制同步
 * 3. 点击外部 / Esc / 收起钮 可收回胶囊
 * 4. 仅在「输入框聚焦」时临时降级置顶，避免 IME 候选被挡
 */
class PanelWindow {
  constructor(store, preloadPath, rendererPath) {
    this.store = store;
    this.preloadPath = preloadPath;
    this.rendererPath = rendererPath;
    this.win = null;
    this.tray = null;
    this.state = 'compact';
    this.inputFocus = false;
    this._resizeToken = 0;
    this._blurTimer = null;
  }

  get settings() {
    return this.store.getSection('settings') || {};
  }

  create(options = {}) {
    const s = this.settings;
    const startExpanded = !!options.startExpanded || !!s._firstRunExpanded;
    const b = startExpanded ? this.expandedBounds() : this.compactBounds();
    this.state = startExpanded ? 'expanded' : 'compact';

    this.win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: startExpanded,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: startExpanded ? false : true,
      alwaysOnTop: true,
      // 真·四角透明：窗口无底色，只有页面胶囊着色
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      title: '灵动面板',
      icon: this.resolveIcon(),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    this._lastDragEnd = 0;
    this._watchdog = null;
    this._edgePoll = null;
    this.edgeHidden = false;
    this._edgeIdleTimer = null;
    this._draggingWindow = false;

    this.applyTopmost(true);
    this.win.setSkipTaskbar(this.state === 'compact');
    this.win.setAlwaysOnTop(true, 'screen-saver');
    try {
      this.win.setHasShadow(false);
    } catch (_) {}

    // show 后立刻禁用 DWM 阴影
    this.win.once('ready-to-show', () => disableWindowsShadow(this.win));
    setTimeout(() => disableWindowsShadow(this.win), 400);
    setTimeout(() => disableWindowsShadow(this.win), 1200);

    const query = { mode: this.state };
    this.win.loadFile(this.rendererPath, { query });
    this.win.webContents.session.clearCache().catch(() => {});

    // 尺寸看门狗：收起态一旦被撑大立刻拉回
    const enforceCompactSize = () => {
      if (!this.win || this.win.isDestroyed()) return;
      if (this.state !== 'compact') return;
      const cur = this.win.getBounds();
      const target = this.compactBounds();
      const maxW = target.width + 24;
      const maxH = target.height + 24;
      if (cur.width > maxW || cur.height > maxH) {
        this.win.setBounds({
          x: cur.x,
          y: cur.y,
          width: target.width,
          height: target.height,
        });
        console.log('[panel] watchdog clamped compact size', cur, '->', target.width, target.height);
      }
    };
    this.win.on('resize', enforceCompactSize);
    this.win.on('move', enforceCompactSize);
    this._watchdog = setInterval(enforceCompactSize, 200);

    // 贴边自动隐藏：光标轮询
    this._edgePoll = setInterval(() => this.tickEdgeAutoHide(), 180);

    this.win.once('ready-to-show', () => {
      if (!this.win || this.win.isDestroyed()) return;
      disableWindowsShadow(this.win);
      this.applyTopmost(true);
      this.win.show();
      this.win.focus();
      this.win.moveTop();
      this.syncRendererState(this.state);
      clearWindowShape(this.win);
      disableWindowsShadow(this.win);
      setTimeout(() => {
        if (!this.win || this.win.isDestroyed()) return;
        this.win.webContents
          .executeJavaScript(`({
            mode: window.App && window.App.mode,
            bodyMode: document.body.dataset.mode,
            expandedHidden: document.getElementById('expanded') && document.getElementById('expanded').hidden,
            compactHidden: document.getElementById('compact') && document.getElementById('compact').hidden,
            hasTabs: !!document.querySelector('.tabs')
          })`)
          .then((info) => {
            const bb2 = this.win.getBounds();
            console.log('[panel] ready', JSON.stringify({ ...info, bounds: bb2, state: this.state }));
          })
          .catch((e) => console.error('[panel] ready-check failed', e.message));
      }, 600);
    });

    this.win.on('closed', () => {
      if (this._watchdog) clearInterval(this._watchdog);
      if (this._edgePoll) clearInterval(this._edgePoll);
      if (this._edgeIdleTimer) clearTimeout(this._edgeIdleTimer);
      this._watchdog = null;
      this._edgePoll = null;
      this.edgeHidden = false;
      this.win = null;
    });

    this.win.on('focus', () => {
      this.clearBlurTimer();
      this.applyTopmost(true);
    });

    this.win.on('blur', () => {
      this.win && this.win.webContents.send('panel:blur');
      const autoCollapse = this.settings.autoCollapseOnBlur === true;
      if (!autoCollapse) return;
      if (this.state !== 'expanded') return;
      if (this.inputFocus) return;
      this.clearBlurTimer();
      this._blurTimer = setTimeout(() => {
        if (this.state === 'expanded' && !this.inputFocus) {
          this.collapse();
        }
      }, 350);
    });

    this.win.on('closed', () => {
      this.win = null;
    });

    this.win.webContents.on('did-finish-load', () => {
      this.syncRendererState(this.state);
    });

    this.win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[panel] renderer gone', details);
    });

    this.createTray();
    return this.win;
  }

  resolveIcon() {
    const p = path.join(__dirname, '..', '..', 'assets', 'app-icon.png');
    if (fs.existsSync(p)) return p;
    const fallback = path.join(__dirname, '..', '..', 'assets', 'ling-panel.png');
    if (fs.existsSync(fallback)) return fallback;
    return undefined;
  }

  clearBlurTimer() {
    if (this._blurTimer) {
      clearTimeout(this._blurTimer);
      this._blurTimer = null;
    }
  }

  createTray() {
    if (this.tray) return;
    try {
      const icon = this.createTrayIcon();
      this.tray = new Tray(icon);
      this.tray.setToolTip('灵动面板');
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '展开工作台', click: () => this.expand() },
          { label: '收起到胶囊', click: () => this.collapse() },
          { type: 'separator' },
          { label: '待办', click: () => this.expand('todo') },
          { label: '笔记', click: () => this.expand('notes') },
          { label: '设置', click: () => this.expand('settings') },
          { type: 'separator' },
          { label: '退出灵动面板', click: () => require('electron').app.quit() },
        ])
      );
      this.tray.on('click', () => this.toggle());
    } catch (err) {
      console.error('[tray] failed', err.message);
    }
  }

  createTrayIcon() {
    // 托盘用简化胶囊标识，比主方砖在 16px 更清晰
    const trayPng = path.join(__dirname, '..', '..', 'assets', 'ling-panel.png');
    if (fs.existsSync(trayPng)) {
      const img = nativeImage.createFromPath(trayPng);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
    const fileIcon = this.resolveIcon();
    if (fileIcon) {
      const img = nativeImage.createFromPath(fileIcon);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
    // 16x16 蓝色圆点 base64 PNG
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAI0fAAF3Y1z+AAAAAElFTkSuQmCC';
    return nativeImage.createFromDataURL(`data:image/png;base64,${png}`);
  }

  /**
   * 面板所在显示器：优先窗口中心命中，其次设置里记住的 displayId，最后主屏
   */
  getPanelDisplay() {
    try {
      const displays = screen.getAllDisplays();
      if (this.win && !this.win.isDestroyed()) {
        const hit = this.displayForBounds(this.win.getBounds());
        if (hit) return hit;
      }
      const id = this.settings.dockDisplayId;
      if (id != null) {
        const found = displays.find((d) => d.id === id);
        if (found) return found;
      }
      return screen.getPrimaryDisplay();
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  /**
   * 按窗口与各屏 bounds 的重叠面积选显示器。
   * 双屏接缝处 getDisplayMatching 会抖，用最大重叠更稳。
   */
  displayForBounds(bounds) {
    try {
      const displays = screen.getAllDisplays();
      if (!displays.length) return screen.getPrimaryDisplay();
      let best = displays[0];
      let bestArea = -1;
      for (const d of displays) {
        const area = this.intersectArea(bounds, d.bounds);
        if (area > bestArea) {
          bestArea = area;
          best = d;
        }
      }
      if (bestArea <= 0) {
        // 完全在缝隙外：退回最近点
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        return screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) || best;
      }
      return best;
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  intersectArea(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 <= x1 || y2 <= y1) return 0;
    return (x2 - x1) * (y2 - y1);
  }

  /**
   * 该停靠边是否与另一块显示器相邻（双屏接缝）。
   * 接缝边不能「滑出屏幕」，否则会叠到另一块屏或掉进缝里。
   */
  isSharedDockEdge(display, dock) {
    if (!display || !dock || dock === 'float-center') return false;
    try {
      const b = display.bounds;
      const eps = 8;
      for (const other of screen.getAllDisplays()) {
        if (other.id === display.id) continue;
        const o = other.bounds;
        switch (dock) {
          case 'left-edge':
            // 本屏左边紧贴另一屏右沿
            if (Math.abs(b.x - (o.x + o.width)) <= eps) return true;
            break;
          case 'right-edge':
            if (Math.abs(b.x + b.width - o.x) <= eps) return true;
            break;
          case 'top-left':
          case 'top-center':
          case 'top-right':
            // 上边紧贴另一屏下沿
            if (Math.abs(b.y - (o.y + o.height)) <= eps) return true;
            break;
          default:
            break;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 光标所在显示器 */
  getCursorDisplay(pt) {
    try {
      return screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) });
    } catch {
      return this.getPanelDisplay();
    }
  }

  isVerticalDock(dock) {
    const d = dock || this.settings.dock || 'top-center';
    return d === 'left-edge' || d === 'right-edge';
  }

  /** 当前收起态视觉尺寸（横/竖） */
  compactPillSize(display) {
    const s = this.settings;
    if (this.isVerticalDock()) {
      const w = Math.min(Math.max(Number(s.compactVerticalWidth) || 44, 32), 64);
      const h = Math.min(Math.max(Number(s.compactVerticalHeight) || 168, 80), 280);
      const pad = 4;
      return { width: w + pad * 2, height: h + pad * 2, vertical: true };
    }
    const pillW = Math.min(Math.max(Number(s.compactWidth) || 200, 140), 260);
    const pillH = Math.min(Math.max(Number(s.compactHeight) || 36, 28), 44);
    const pad = 4;
    return { width: pillW + pad * 2, height: pillH + pad * 2, vertical: false };
  }

  compactBounds(display) {
    const s = this.settings;
    const d = display || this.getPanelDisplay();
    const wa = d.workArea;
    const size = this.compactPillSize();
    const width = size.width;
    const height = size.height;
    const dock = s.dock || 'top-center';

    let x = wa.x + Math.round((wa.width - width) / 2);
    let y = wa.y + 4;

    switch (dock) {
      case 'top-left':
        x = wa.x + 16;
        y = wa.y + 4;
        break;
      case 'top-right':
        x = wa.x + wa.width - width - 16;
        y = wa.y + 4;
        break;
      case 'left-edge':
        x = wa.x + 8;
        y = wa.y + Math.round(wa.height / 2 - height / 2);
        break;
      case 'right-edge':
        x = wa.x + wa.width - width - 8;
        y = wa.y + Math.round(wa.height / 2 - height / 2);
        break;
      case 'float-center':
        x = wa.x + Math.round((wa.width - width) / 2);
        y = wa.y + Math.round((wa.height - height) / 2);
        break;
      case 'top-center':
      default:
        x = wa.x + Math.round((wa.width - width) / 2);
        y = wa.y + 4;
        break;
    }

    return { x, y, width, height };
  }

  /** 仅按 dock + 指定显示器换位置，保持 width/height */
  compactPositionOnly(width, height, display) {
    const s = this.settings;
    const d = display || this.getPanelDisplay();
    const wa = d.workArea;
    const dock = s.dock || 'top-center';
    let x = wa.x + Math.round((wa.width - width) / 2);
    let y = wa.y + 4;
    switch (dock) {
      case 'top-left':
        x = wa.x + 16;
        y = wa.y + 4;
        break;
      case 'top-right':
        x = wa.x + wa.width - width - 16;
        y = wa.y + 4;
        break;
      case 'left-edge':
        x = wa.x + 8;
        y = wa.y + Math.round(wa.height / 2 - height / 2);
        break;
      case 'right-edge':
        x = wa.x + wa.width - width - 8;
        y = wa.y + Math.round(wa.height / 2 - height / 2);
        break;
      case 'float-center':
        x = wa.x + Math.round((wa.width - width) / 2);
        y = wa.y + Math.round((wa.height - height) / 2);
        break;
      default:
        break;
    }
    return { x, y, width, height };
  }

  expandedBounds(display) {
    const s = this.settings;
    const d = display || this.getPanelDisplay();
    const wa = d.workArea;
    const width = Math.min(Math.max(s.expandedWidth || 760, 520), wa.width - 24);
    const height = Math.min(Math.max(s.expandedHeight || 560, 360), wa.height - 24);
    const dock = s.dock || 'top-center';

    if (s.floatCenter || dock === 'float-center') {
      return {
        x: wa.x + Math.round((wa.width - width) / 2),
        y: wa.y + Math.round((wa.height - height) / 2),
        width,
        height,
        resizable: true,
      };
    }

    let x = wa.x + Math.round((wa.width - width) / 2);
    let y = wa.y + 4;

    switch (dock) {
      case 'top-left':
        x = wa.x + 8;
        y = wa.y + 4;
        break;
      case 'top-right':
        x = wa.x + wa.width - width - 8;
        y = wa.y + 4;
        break;
      case 'left-edge':
        x = wa.x + 8;
        y = wa.y + Math.round((wa.height - height) / 2);
        break;
      case 'right-edge':
        x = wa.x + wa.width - width - 8;
        y = wa.y + Math.round((wa.height - height) / 2);
        break;
      default:
        x = wa.x + Math.round((wa.width - width) / 2);
        y = wa.y + 4;
        break;
    }

    return { x, y, width, height, resizable: true };
  }

  /**
   * 在指定显示器上判断停靠边（多屏：以该屏 workArea 为准）
   */
  resolveDockFromBounds(bounds) {
    const display = this.displayForBounds(bounds);
    const wa = display.workArea;
    const b = bounds;
    const th = 40;

    const distTop = b.y - wa.y;
    const distLeft = b.x - wa.x;
    const distRight = wa.x + wa.width - (b.x + b.width);
    const distBottom = wa.y + wa.height - (b.y + b.height);

    // 接缝：本屏某边紧贴其它显示器时，不把「贴着缝」判成外沿隐藏边优先
    const nearTop = distTop <= th && !this.isSharedDockEdge(display, 'top-center');
    const nearLeft = distLeft <= th;
    const nearRight = distRight <= th;
    const nearBottom = distBottom <= th;

    const centerY = b.y + b.height / 2;
    const midBandY = Math.abs(centerY - (wa.y + wa.height / 2)) < wa.height * 0.3;

    // 共用缝上的左右边仍允许停靠（用户常把面板放在双屏交界），但 edge-hide 会禁用
    if (nearTop && distLeft <= th) return 'top-left';
    if (nearTop && distRight <= th) return 'top-right';
    if (distTop <= th) return 'top-center';
    if (distLeft <= th && midBandY) return 'left-edge';
    if (distRight <= th && midBandY) return 'right-edge';
    if (!nearBottom && distTop <= th * 2) {
      return distLeft <= wa.width * 0.35 ? 'top-left' : distRight <= wa.width * 0.35 ? 'top-right' : 'top-center';
    }
    return 'float-center';
  }

  get edgeAutoHideEnabled() {
    const s = this.settings;
    if (s.edgeAutoHide === false) return false;
    const dock = s.dock || 'top-center';
    if (dock === 'float-center') return false;
    // 双屏接缝边：滑出会叠到另一屏/掉进缝里，禁用自动隐藏
    const display = this.getPanelDisplay();
    if (this.isSharedDockEdge(display, dock)) return false;
    return true;
  }

  /**
   * 拖拽结束：吸附到「当前所在显示器」的边缘
   */
  endDrag() {
    if (!this.win || this.win.isDestroyed()) {
      return { ok: false };
    }
    this.markDragging(false);
    this._lastDragEnd = Date.now();
    this.edgeHidden = false;
    const current = this.win.getBounds();
    const display = this.displayForBounds(current);
    const dock = this.resolveDockFromBounds(current);
    const s = this.settings;
    const shared = this.isSharedDockEdge(display, dock);
    const vertical = this.isVerticalDock(dock);

    let width = current.width;
    let height = current.height;
    if (this.state !== 'expanded') {
      const size = this.compactPillSize();
      // dock 切换时按横/竖目标尺寸吸附，避免竖边仍用横条尺寸
      width = size.width;
      height = size.height;
    }

    const nextSettings = {
      ...s,
      dock,
      floatCenter: dock === 'float-center',
      dockDisplayId: display.id,
    };
    if (this.state !== 'expanded') {
      if (vertical) {
        nextSettings.compactVerticalWidth = Math.min(Math.max(width - 8, 32), 64);
        nextSettings.compactVerticalHeight = Math.min(Math.max(height - 8, 80), 280);
      } else {
        nextSettings.compactWidth = Math.min(Math.max(width - 8, 140), 260);
        nextSettings.compactHeight = Math.min(Math.max(height - 8, 28), 44);
      }
    }
    this.store.setSection('settings', nextSettings);

    let target;
    if (this.state === 'expanded') {
      target = this.expandedBounds(display);
    } else {
      target = this.compactPositionOnly(width, height, display);
    }
    this.win.setBounds(target);
    if (!this.inputFocus) this.applyTopmost(true);
    this.win.webContents.send('settings:updated', this.settings);
    this.refreshWindowShape();
    // 通知渲染层切换横/竖胶囊
    this.win.webContents.send('panel:orient', { vertical: this.isVerticalDock() });
    console.log(
      '[panel] endDrag',
      JSON.stringify({
        state: this.state,
        dock,
        displayId: display.id,
        sharedEdge: shared,
        edgeHide: this.edgeAutoHideEnabled,
        bounds: target,
      })
    );
    return { ok: true, dock, bounds: target, state: this.state, displayId: display.id, sharedEdge: shared };
  }

  /** 仅削弱 DWM 阴影；圆角由 CSS 负责，不做 HWND 裁形 */
  refreshWindowShape() {
    if (!this.win || this.win.isDestroyed()) return;
    clearWindowShape(this.win);
    disableWindowsShadow(this.win);
  }

  /** 计算收起态「贴边隐藏」时的 bounds（相对面板所在显示器） */
  edgeHiddenBounds() {
    const display = this.getPanelDisplay();
    const visible = this.compactBounds(display);
    const s = this.settings;
    const wa = display.workArea;
    const peek = Math.min(Math.max(Number(s.edgePeekPx) || 4, 2), 10);
    const dock = s.dock || 'top-center';
    let x = visible.x;
    let y = visible.y;

    switch (dock) {
      case 'top-left':
      case 'top-center':
      case 'top-right':
        y = wa.y - visible.height + peek;
        break;
      case 'left-edge':
        x = wa.x - visible.width + peek;
        break;
      case 'right-edge':
        x = wa.x + wa.width - peek;
        break;
      default:
        y = wa.y - visible.height + peek;
        break;
    }
    return { x, y, width: visible.width, height: visible.height };
  }

  /** 光标是否靠近「唤出热点」（只认面板所在屏，且避开接缝误触） */
  isCursorInPeekZone(pt) {
    const s = this.settings;
    const dock = s.dock || 'top-center';
    const display = this.getPanelDisplay();
    const wa = display.workArea;
    const bounds = display.bounds;

    // 光标必须落在该显示器 bounds 内
    const inDisplay =
      pt.x >= bounds.x &&
      pt.x < bounds.x + bounds.width &&
      pt.y >= bounds.y &&
      pt.y < bounds.y + bounds.height;
    if (!inDisplay) return false;

    // 接缝边不做「滑出唤出」热点，避免另一侧扫过就弹出
    if (this.isSharedDockEdge(display, dock)) {
      // 仍允许点到已露出的胶囊唤出（isCursorOverPanel）
      return false;
    }

    const hot = 16;
    const vis = this.compactBounds(display);
    const peek = Math.min(Math.max(Number(s.edgePeekPx) || 4, 2), 10);

    switch (dock) {
      case 'top-center':
        return pt.y <= wa.y + hot && Math.abs(pt.x - (wa.x + wa.width / 2)) < vis.width / 2 + 48;
      case 'top-left':
        return pt.y <= wa.y + hot && pt.x <= wa.x + vis.width + 56;
      case 'top-right':
        return pt.y <= wa.y + hot && pt.x >= wa.x + wa.width - vis.width - 56;
      case 'left-edge':
        return pt.x <= wa.x + hot && Math.abs(pt.y - (wa.y + wa.height / 2)) < vis.height / 2 + 48;
      case 'right-edge':
        return pt.x >= wa.x + wa.width - hot && Math.abs(pt.y - (wa.y + wa.height / 2)) < vis.height / 2 + 48;
      default:
        return pt.y <= wa.y + peek + hot;
    }
  }

  /** 光标是否在可见胶囊上 */
  isCursorOverPanel(pt) {
    if (!this.win || this.win.isDestroyed()) return false;
    const b = this.win.getBounds();
    return pt.x >= b.x - 2 && pt.x <= b.x + b.width + 2 && pt.y >= b.y - 2 && pt.y <= b.y + b.height + 2;
  }

  showFromEdge() {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.edgeHidden) return;
    this.edgeHidden = false;
    if (this._edgeIdleTimer) {
      clearTimeout(this._edgeIdleTimer);
      this._edgeIdleTimer = null;
    }
    const target = this.compactBounds();
    this._setBoundsImmediate(target);
    this.applyTopmost(true);
    this.win.webContents.send('panel:edge', { hidden: false });
  }

  hideToEdge() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.state !== 'compact') return;
    if (!this.edgeAutoHideEnabled) return;
    if (this.edgeHidden) return;
    const display = this.getPanelDisplay();
    const dock = this.settings.dock || 'top-center';
    // 双屏接缝：禁止滑出（会叠到邻屏）
    if (this.isSharedDockEdge(display, dock)) return;
    this.edgeHidden = true;
    const target = this.edgeHiddenBounds();
    this._setBoundsImmediate(target);
    this.applyTopmost(true);
    this.win.webContents.send('panel:edge', { hidden: true });
  }

  /**
   * 贴边自动隐藏主循环
   * - 展开中 / 拖拽中 / 未启用 → 不处理
   * - 已隐藏：光标靠近边缘热点 → 弹出
   * - 可见：光标离开一段时间 → 收进边缘
   */
  tickEdgeAutoHide() {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.edgeAutoHideEnabled) {
      if (this.edgeHidden) this.showFromEdge();
      return;
    }
    if (this.state !== 'compact') {
      if (this.edgeHidden) {
        this.edgeHidden = false;
        if (this._edgeIdleTimer) clearTimeout(this._edgeIdleTimer);
      }
      return;
    }
    if (this._draggingWindow) return;

    let pt;
    try {
      pt = screen.getCursorScreenPoint();
    } catch {
      return;
    }

    if (this.edgeHidden) {
      if (this.isCursorInPeekZone(pt) || this.isCursorOverPanel(pt)) {
        this.showFromEdge();
      }
      return;
    }

    // 可见：光标在面板上 → 取消计时；离开 → 延迟隐藏
    const over = this.isCursorOverPanel(pt);
    const inPeek = this.isCursorInPeekZone(pt);
    if (over || inPeek) {
      if (this._edgeIdleTimer) {
        clearTimeout(this._edgeIdleTimer);
        this._edgeIdleTimer = null;
      }
      return;
    }
    if (this._edgeIdleTimer) return;
    const delay = Math.min(Math.max(Number(this.settings.edgeHideDelayMs) || 1800, 400), 8000);
    this._edgeIdleTimer = setTimeout(() => {
      this._edgeIdleTimer = null;
      if (this.state === 'compact' && this.edgeAutoHideEnabled && !this._draggingWindow) {
        try {
          const pt2 = screen.getCursorScreenPoint();
          if (this.isCursorOverPanel(pt2) || this.isCursorInPeekZone(pt2)) return;
        } catch (_) {}
        this.hideToEdge();
      }
    }, delay);
  }

  markDragging(on) {
    this._draggingWindow = !!on;
    if (on && this._edgeIdleTimer) {
      clearTimeout(this._edgeIdleTimer);
      this._edgeIdleTimer = null;
    }
    if (on && this.edgeHidden) this.showFromEdge();
  }

  /**
   * 拖拽过程：只改 x/y，锁死 w/h
   */
  moveBy(dx, dy) {
    if (!this.win || this.win.isDestroyed()) return false;
    this.markDragging(true);
    const b = this.win.getBounds();
    let width = b.width;
    let height = b.height;
    if (this.state !== 'expanded') {
      const t = this.compactBounds();
      width = t.width;
      height = t.height;
    }
    let x = b.x + Math.round(dx);
    let y = b.y + Math.round(dy);

    // 多屏：允许在所有显示器组成的虚拟桌面范围内移动
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    try {
      for (const d of screen.getAllDisplays()) {
        const wa = d.workArea;
        minX = Math.min(minX, wa.x);
        minY = Math.min(minY, wa.y);
        maxX = Math.max(maxX, wa.x + wa.width);
        maxY = Math.max(maxY, wa.y + wa.height);
      }
    } catch {
      const wa = this.getPanelDisplay().workArea;
      minX = wa.x;
      minY = wa.y;
      maxX = wa.x + wa.width;
      maxY = wa.y + wa.height;
    }
    if (!Number.isFinite(minX)) return false;

    x = Math.min(Math.max(x, minX - width + 32), maxX - 32);
    y = Math.min(Math.max(y, minY - 4), maxY - 20);
    this.win.setBounds({ x, y, width, height });
    return true;
  }

  applyTopmost(enabled) {
    if (!this.win || this.win.isDestroyed()) return;
    if (enabled) {
      // screen-saver：高于普通 floating，确保压在浏览器/IDE 之上
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.win.moveTop();
    } else {
      this.win.setAlwaysOnTop(false);
    }
  }

  enterInputFocusMode() {
    if (!this.win || this.win.isDestroyed()) return;
    this.inputFocus = true;
    this.clearBlurTimer();
    // 仅打字时临时取消置顶，给输入法候选让位
    if (this.settings.pauseTopmostOnInput !== false) {
      this.applyTopmost(false);
    }
  }

  exitInputFocusMode() {
    if (!this.win || this.win.isDestroyed()) return;
    this.inputFocus = false;
    // 输入结束后立刻恢复悬浮
    this.applyTopmost(true);
  }

  /**
   * 强制把渲染层切到对应模式：事件 + executeJavaScript 双通道
   */
  syncRendererState(state, tab) {
    if (!this.win || this.win.isDestroyed()) return;
    const payload = { state, tab: tab || this.settings.defaultTab || 'home' };
    try {
      this.win.webContents.send('panel:state', payload);
    } catch (_) {}
    const script = `
      (function(){
        try {
          var c = document.getElementById('compact');
          var e = document.getElementById('expanded');
          if (${JSON.stringify(state)} === 'expanded') {
            document.body.dataset.mode = 'expanded';
            if (c) { c.hidden = true; c.style.display = 'none'; }
            if (e) { e.hidden = false; e.style.display = 'flex'; }
            if (window.App) {
              window.App.mode = 'expanded';
              if (window.App.showExpanded) window.App.showExpanded(${JSON.stringify(payload.tab)});
            }
          } else {
            document.body.dataset.mode = 'compact';
            if (e) { e.hidden = true; e.style.display = 'none'; }
            if (c) { c.hidden = false; c.style.display = 'flex'; }
            if (window.App) {
              window.App.mode = 'compact';
              if (window.App.showCompact) window.App.showCompact();
            }
          }
          return {
            mode: window.App && window.App.mode,
            body: document.body.dataset.mode,
            cDisplay: c && getComputedStyle(c).display,
            eDisplay: e && getComputedStyle(e).display,
            h: window.innerHeight
          };
        } catch (err) { return { error: String(err && err.message) }; }
      })();
    `;
    this.win.webContents.executeJavaScript(script).then((r) => {
      console.log('[panel] sync', JSON.stringify(r));
    }).catch((e) => console.error('[panel] sync failed', e.message));
  }

  async expand(tab) {
    if (!this.win || this.win.isDestroyed()) return false;
    if (Date.now() - (this._lastDragEnd || 0) < 400) {
      console.log('[panel] expand ignored: just dragged');
      return false;
    }
    this.clearBlurTimer();
    this.edgeHidden = false;
    if (this._edgeIdleTimer) {
      clearTimeout(this._edgeIdleTimer);
      this._edgeIdleTimer = null;
    }
    this.state = 'expanded';
    const b = this.expandedBounds();
    this.win.setResizable(true);
    this.win.setMinimumSize(520, 360);
    this.win.setSkipTaskbar(false);

    this.syncRendererState('expanded', tab || this.settings.defaultTab || 'home');
    this._setBoundsImmediate(b);
    clearWindowShape(this.win);
    this.win.show();
    this.win.focus();
    this.win.moveTop();
    if (!this.inputFocus) {
      this.applyTopmost(true);
    }
    this.win.webContents.send('panel:edge', { hidden: false });
    return true;
  }

  collapse() {
    if (!this.win || this.win.isDestroyed()) return false;
    this.clearBlurTimer();
    this.state = 'compact';
    this.inputFocus = false;
    this.edgeHidden = false;
    const b = this.compactBounds();
    this.syncRendererState('compact');
    this._setBoundsImmediate(b);
    this.win.setResizable(false);
    this.win.setMinimumSize(0, 0);
    this.win.setSkipTaskbar(true);
    this.applyTopmost(true);
    this.win.showInactive();
    this.win.moveTop();
    setTimeout(() => this.refreshWindowShape(), 50);
    // 收起后按设置自动贴边隐藏
    if (this.edgeAutoHideEnabled) {
      if (this._edgeIdleTimer) clearTimeout(this._edgeIdleTimer);
      const delay = Math.min(Math.max(Number(this.settings.edgeHideDelayMs) || 1800, 400), 8000);
      this._edgeIdleTimer = setTimeout(() => {
        this._edgeIdleTimer = null;
        this.tickEdgeAutoHide();
      }, Math.min(delay, 1200));
    }
    return true;
  }

  toggle(tab) {
    if (this.state === 'expanded') return this.collapse();
    return this.expand(tab);
  }

  /**
   * 立即设置 bounds（可用短动画，但保证最终到位）
   */
  _setBoundsImmediate(target) {
    if (!this.win || this.win.isDestroyed()) return;
    const token = ++this._resizeToken;
    const start = this.win.getBounds();
    const duration = 140;
    const t0 = Date.now();

    const step = () => {
      if (token !== this._resizeToken || !this.win || this.win.isDestroyed()) return;
      const p = Math.min(1, (Date.now() - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      this.win.setBounds({
        x: Math.round(start.x + (target.x - start.x) * e),
        y: Math.round(start.y + (target.y - start.y) * e),
        width: Math.round(start.width + (target.width - start.width) * e),
        height: Math.round(start.height + (target.height - start.height) * e),
      });
      if (p < 1) setTimeout(step, 16);
      else this.win.setBounds(target);
    };
    step();
  }

  applySettings(nextSettings) {
    const merged = { ...this.settings, ...(nextSettings || {}) };
    this.store.setSection('settings', merged);
    if (!this.win || this.win.isDestroyed()) return;

    if (merged.alwaysOnTop !== false) {
      if (!this.inputFocus) this.applyTopmost(true);
    } else if (this.state === 'compact') {
      this.applyTopmost(merged.alwaysOnTopWhenDocked !== false);
    }

    // 设置里切换显示器时，按 dockDisplayId 定位
    let display = this.getPanelDisplay();
    if (merged.dockDisplayId != null) {
      try {
        const found = screen.getAllDisplays().find((d) => d.id === merged.dockDisplayId);
        if (found) display = found;
      } catch (_) {}
    }

    this.edgeHidden = false;
    if (this.state === 'compact') {
      this.win.setBounds(this.compactBounds(display));
      setTimeout(() => this.refreshWindowShape(), 20);
    } else {
      this.win.setBounds(this.expandedBounds(display));
      clearWindowShape(this.win);
    }
    this.win.webContents.send('settings:updated', merged);
    this.win.webContents.send('panel:orient', { vertical: this.isVerticalDock(merged.dock) });
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }
}

module.exports = {
  PanelWindow,
  disableWindowsShadow,
  applyWindowPillShape,
  clearWindowShape,
};
