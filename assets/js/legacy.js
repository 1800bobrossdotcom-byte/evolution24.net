/* Old WordPress URLs carried the building or unit in the query string
   (/property-detail/?pid=8, /unit-detail/?uid=62). Send each to its new page. */
(() => {
  const me = document.currentScript;
  const id = new URLSearchParams(location.search).get(me.dataset.param);
  const to = JSON.parse(me.dataset.map)[id] || '/properties/';
  location.replace(to);
})();
