/**
 * 主题引导：在样式表生效前把 data-theme 落到 <html> 上，避免首帧闪白/闪黑。
 * 偏好保存在 localStorage：auto | light | dark。
 */
(function () {
  var pref = 'auto';
  try {
    pref = localStorage.getItem('lingmark.theme') || 'auto';
  } catch (e) {
    /* localStorage 不可用时按 auto 处理 */
  }
  var dark =
    pref === 'dark' ||
    (pref === 'auto' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
