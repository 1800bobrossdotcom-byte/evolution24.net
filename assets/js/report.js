/* Buttons on a shared report. The page itself needs no script; these two only
   save a step: the print dialog's "Save as PDF", and copying the address. */
(() => {
  'use strict';
  const print = document.querySelector('[data-print]');
  const copy = document.querySelector('[data-copy]');
  if (print) print.addEventListener('click', () => window.print());
  if (copy) {
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        copy.textContent = 'Link copied';
      } catch {
        copy.textContent = 'Copy the address bar';
      }
      setTimeout(() => { copy.textContent = 'Copy link'; }, 2000);
    });
  }
})();
