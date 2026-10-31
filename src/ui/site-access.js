// GitHub Pages has no account API. Keep credentials on the actual server origin.
(() => {
  const entry = document.getElementById('public-account-link');
  const dialog = document.getElementById('account-access-dialog');
  if (!entry || !dialog || entry.getAttribute('href') !== '#account-access') return;
  const close = () => dialog.close();
  entry.addEventListener('click', event => {
    event.preventDefault();
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector('[data-close-access]').addEventListener('click', close);
  dialog.querySelector('[data-continue-analysis]').addEventListener('click', () => {
    close();
    document.getElementById('sql-input').focus();
  });
})();
