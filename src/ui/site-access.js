// GitHub Pages has no account API. Keep credentials on the actual server origin.
(() => {
  const entries = document.querySelectorAll('a[href="#account-access"]');
  const dialog = document.getElementById('account-access-dialog');
  if (!entries.length || !dialog) return;
  const close = () => dialog.close();
  for (const entry of entries) entry.addEventListener('click', event => {
    event.preventDefault();
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector('[data-close-access]').addEventListener('click', close);
  dialog.querySelector('[data-continue-analysis]').addEventListener('click', () => {
    close();
    document.getElementById('sql-input').focus();
  });
})();
