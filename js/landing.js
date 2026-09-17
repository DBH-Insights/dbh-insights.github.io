// DBH Insights landing page: release notes, the screenshot tour, and version text.
// Like the app, it builds nodes with createElement and textContent, never innerHTML.

(() => {
  const $ = (id) => document.getElementById(id);

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Text with `backtick` spans turned into <code>. */
  function richText(parent, text) {
    text.split("`").forEach((part, i) => {
      if (!part) return;
      parent.append(i % 2 ? make("code", "", part) : document.createTextNode(part));
    });
    return parent;
  }

  /** "2026-09-17" → "September 17, 2026", fixed to UTC so the day never shifts with the time zone. */
  function formatDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const GROUPS = [
    ["new", "New"],
    ["improved", "Improved"],
    ["fixed", "Fixed"],
    ["security", "Security"],
    ["docs", "Documentation"],
  ];

  function renderReleases(notes) {
    const box = $("releases");
    box.replaceChildren();

    notes.forEach((release, index) => {
      const latest = index === 0;
      const details = make("details", `release${latest ? " latest" : ""}`);
      details.id = `v${release.version}`;
      // The newest release starts open; older ones stay tidy until asked for.
      details.open = latest;

      const summary = make("summary");
      summary.append(make("span", "version", `v${release.version}`));
      summary.append(make("span", "release-title", release.title));
      const meta = make("span", "release-meta");
      const time = make("time", "", formatDate(release.date));
      time.dateTime = release.date;
      meta.append(time);
      if (latest) meta.append(make("span", "chip chip-latest", "Latest"));
      if (release.helper) meta.append(make("span", "chip", `Helper ${release.helper}`));
      meta.append(make("span", "", `${release.changes.length} change${release.changes.length === 1 ? "" : "s"}`));
      summary.append(meta);
      details.append(summary);

      const body = make("div", "release-body");
      for (const [type, label] of GROUPS) {
        const items = release.changes.filter((c) => c.type === type);
        if (!items.length) continue;
        const group = make("section", "change-group");
        group.dataset.type = type;
        group.append(make("h4", "", label));
        const list = make("ul");
        for (const item of items) list.append(richText(make("li"), item.text));
        group.append(list);
        body.append(group);
      }
      details.append(body);
      box.append(details);
    });
  }

  function renderVersion(notes) {
    const current = notes[0];
    $("whatsNewText").textContent = `v${current.version}: ${current.title}`;
    $("whatsNew").href = `#v${current.version}`;
    $("footerVersion").textContent = `Version ${current.version} · ${formatDate(current.date)}`;
  }

  /** Opening a release by link (the hero pill, or a shared #v0.3.0 URL) expands it first. */
  function openLinkedRelease() {
    const target = location.hash.slice(1);
    if (!target.startsWith("v")) return;
    const release = document.getElementById(target);
    if (release && release.tagName === "DETAILS") {
      release.open = true;
      release.scrollIntoView({ block: "start" });
    }
  }

  // ---- screenshot tour: an ARIA tab list with arrow-key movement ----

  function setupTour() {
    const tabs = [...document.querySelectorAll(".tour-tabs [role=tab]")];
    const img = $("tourImg");
    const caption = $("tourCaption");
    const panel = $("panel-tour");
    if (!tabs.length || !img) return;

    // Fetch the other screens once the page is idle, so switching is instant.
    const preload = () => tabs.forEach((t) => { new Image().src = t.dataset.img; });
    if ("requestIdleCallback" in window) requestIdleCallback(preload);
    else setTimeout(preload, 1500);

    function select(tab, focus) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      }
      if (focus) tab.focus();
      panel.setAttribute("aria-labelledby", tab.id);
      if (img.getAttribute("src") === tab.dataset.img) return;
      img.classList.add("swapping");
      const next = new Image();
      next.onload = next.onerror = () => {
        img.src = tab.dataset.img;
        img.alt = tab.dataset.alt;
        caption.textContent = tab.dataset.caption;
        img.classList.remove("swapping");
      };
      next.src = tab.dataset.img;
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (event) => {
        const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        select(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
      });
    });
  }

  if (typeof RELEASE_NOTES !== "undefined" && RELEASE_NOTES.length) {
    renderReleases(RELEASE_NOTES);
    renderVersion(RELEASE_NOTES);
    openLinkedRelease();
    window.addEventListener("hashchange", openLinkedRelease);
  }
  setupTour();
})();
