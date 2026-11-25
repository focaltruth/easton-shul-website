/* =========================================================
   Easton Shul – events & classes
   Reads data/events.json (one-off events) and data/classes.json
   (recurring classes) and fills whichever of these exist on the page:
     #home-events      home page "Our Events" cards
     #events-list      events.html cards
     #event-detail     event.html detail page (?id=...)
     #upcoming-events  "Upcoming Events" cards at the bottom of event.html
   Past events disappear from the lists automatically.
   Upcoming events with no registerUrl get a built-in RSVP form
   (Netlify form "event-rsvp"; its hidden copy lives in event.html).
========================================================= */
(function () {
  const EVENTS_URL = "data/events.json";
  const CLASSES_URL = "data/classes.json";
  const CONTACT_EMAIL = "eastonshul@gmail.com";
  const HOME_LIMIT = 4;
  const UPCOMING_LIMIT = 3;

  /* ---------- helpers ---------- */

  // Escape text before putting it in HTML (submitted text is never trusted)
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Allow only http(s), mailto, or simple relative paths like images/x.jpg
  function safeUrl(url) {
    const s = String(url || "").trim();
    if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
    if (/^[\w\-./]+$/.test(s) && !s.startsWith("//")) return s;
    return "";
  }

  function safeColor(color) {
    const s = String(color || "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(s) ? s : "";
  }

  function parseDate(iso) {
    const parts = String(iso || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function longDate(d) {
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function shortDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function icon(name) {
    return `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
  }

  // Clean links on the live site (/events/hanukkah-2026).
  // Live Server can't do Netlify rewrites, so local testing uses event.html?id=...
  const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  function detailUrl(item) {
    const id = encodeURIComponent(item.id);
    return IS_LOCAL ? "event.html?id=" + id : "/events/" + id;
  }

  // Works with both /events/hanukkah-2026 and event.html?id=hanukkah-2026
  function currentEventId() {
    const fromQuery = new URLSearchParams(window.location.search).get("id");
    if (fromQuery) return fromQuery;
    const match = window.location.pathname.match(/\/events\/([^\/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function cardTitle(item) {
    return item.shortTitle || item.title;
  }

  function whenShort(item) {
    if (item.kind === "class") return item.schedule || "";
    return item.dateObj ? shortDate(item.dateObj) : "";
  }

  function whenLong(item) {
    if (item.kind === "class") return item.schedule || "";
    return item.dateObj ? longDate(item.dateObj) : "";
  }

  function isOnline(item) {
    return item.location && item.location.type === "online";
  }

  function locationShort(item) {
    const loc = item.location || {};
    if (isOnline(item)) return loc.name || "Online";
    return loc.address || loc.name || "";
  }

  function paragraphs(description) {
    if (Array.isArray(description)) return description;
    return String(description || "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  // Built-in RSVP form: upcoming one-off events with no outside link.
  // Add "rsvp": false to an event in events.json to turn it off.
  function usesRsvpForm(item) {
    return item.kind === "event" && item.rsvp !== false && !safeUrl(item.registerUrl);
  }

  function registerHref(item) {
    return safeUrl(item.registerUrl) ||
      "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent("Register: " + item.title);
  }

  function emptyState(text) {
    return `<div class="col-12"><p class="events-empty">${esc(text)}</p></div>`;
  }

  /* ---------- data ---------- */

  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  async function loadAll() {
    const results = await Promise.all([
      loadJSON(EVENTS_URL).catch(function (e) { console.warn("Events:", e); return []; }),
      loadJSON(CLASSES_URL).catch(function (e) { console.warn("Classes:", e); return []; })
    ]);

    const events = results[0]
      .filter(function (e) { return e && e.id && !e.hidden; })
      .map(function (e) { return Object.assign({}, e, { kind: "event", dateObj: parseDate(e.date) }); })
      .sort(function (a, b) { return (a.dateObj || 0) - (b.dateObj || 0); });

    const classes = results[1]
      .filter(function (c) { return c && c.id && !c.hidden; })
      .map(function (c) { return Object.assign({}, c, { kind: "class" }); });

    const now = today();
    const upcomingEvents = events.filter(function (e) { return e.dateObj && e.dateObj >= now; });

    return {
      all: classes.concat(events),                 // includes past events (for direct links)
      listed: classes.concat(upcomingEvents)       // what the lists show
    };
  }

  /* ---------- card templates ---------- */

  // Home page: square image, title, Learn More
  function homeCard(item) {
    return `
      <div class="col-12 col-sm-6 col-lg-3">
        <article class="event-card">
          <div class="event-img-wrap">
            <img src="${esc(safeUrl(item.image))}" alt="${esc(item.imageAlt || item.title)}" class="event-img">
          </div>
          <h3 class="event-name">${esc(cardTitle(item))}</h3>
          <a href="${detailUrl(item)}" class="event-link">
            <span>Learn More</span>
            ${icon("arrow_outward")}
          </a>
        </article>
      </div>`;
  }

  // Events page: wide card with details
  function featureCard(item) {
    return `
      <div class="col-12 col-xl-6">
        <article class="event-feature-card">
          <div class="event-feature-media">
            <img src="${esc(safeUrl(item.image))}" alt="${esc(item.imageAlt || item.title)}" class="event-feature-img" />
            ${item.tag ? `<span class="event-feature-tag">${esc(item.tag)}</span>` : ""}
          </div>
          <div class="event-feature-content">
            <div class="event-feature-date">
              ${icon(item.kind === "class" ? "event_repeat" : "calendar_month")}
              <span>${esc(whenShort(item))}</span>
            </div>
            <h2 class="event-feature-title">${esc(cardTitle(item))}</h2>
            ${item.time ? `
            <div class="event-feature-time">
              ${icon("schedule")}
              <span>${esc(item.time)}</span>
            </div>` : ""}
            <div class="event-feature-location">
              ${icon(isOnline(item) ? "videocam" : "location_on")}
              <span>${esc(locationShort(item))}</span>
            </div>
            <a href="${detailUrl(item)}" class="event-link">
              <span>Learn More</span>
              ${icon("arrow_outward")}
            </a>
          </div>
        </article>
      </div>`;
  }

  // Bottom of the detail page
  function moreCard(item) {
    return `
      <div class="col-12 col-md-6 col-lg-4">
        <a href="${detailUrl(item)}" class="event-more-card">
          <div class="event-more-img">
            <img src="${esc(safeUrl(item.image))}" alt="${esc(item.imageAlt || item.title)}">
          </div>
          <div class="event-more-body">
            <span class="event-more-date">
              ${icon(item.kind === "class" ? "event_repeat" : "calendar_month")}
              ${esc(whenShort(item))}
            </span>
            <h3 class="event-more-name">${esc(cardTitle(item))}</h3>
            <span class="event-more-link">Learn More ${icon("arrow_outward")}</span>
          </div>
        </a>
      </div>`;
  }

  /* ---------- detail page ---------- */

  function detailItem(iconName, label, value, extra) {
    return `
      <div class="event-detail-item">
        ${icon(iconName)}
        <div>
          <div class="event-detail-label">${esc(label)}</div>
          <div class="event-detail-value">${esc(value)}</div>
          ${extra || ""}
        </div>
      </div>`;
  }

  function locationBlock(item) {
    const loc = item.location || {};
    if (isOnline(item)) {
      const join = safeUrl(loc.joinUrl);
      return detailItem("videocam", "Location", loc.name || "Online",
        join ? `<a href="${esc(join)}" target="_blank" rel="noopener" class="event-detail-link">Join on Zoom</a>` : "");
    }
    const maps = safeUrl(loc.mapsUrl) ||
      (loc.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loc.address) : "");
    return detailItem("location_on", "Location", loc.name || "",
      (loc.address ? `<div class="event-detail-sub">${esc(loc.address)}</div>` : "") +
      (maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener" class="event-detail-link">Get directions</a>` : ""));
  }

  function detailHTML(item) {
    const isPast = item.kind === "event" && item.dateObj && item.dateObj < today();
    const fitClass = item.imageFit === "contain" ? " is-flyer" : "";
    const bg = safeColor(item.imageBg);
    const rsvp = !isPast && usesRsvpForm(item);
    const register = rsvp ? "#rsvp" : registerHref(item);
    const registerLabel = item.registerLabel || (rsvp ? "RSVP Now" : "Register Now");

    return `
      <a href="events.html" class="member-back">
        ${icon("arrow_back")}
        <span class="member-back-text">Back to events</span>
      </a>

      <div class="row g-4 g-lg-5 align-items-stretch">
        <div class="col-lg-8">
          <div class="event-detail-photo${fitClass}"${bg ? ` style="--photo-bg: ${bg};"` : ""}>
            <img src="${esc(safeUrl(item.image))}" alt="${esc(item.imageAlt || item.title)}">
          </div>
        </div>

        <div class="col-lg-4">
          <aside class="event-detail-card" aria-label="Event details">
            ${item.tag ? `<span class="event-detail-tag">${esc(item.tag)}</span>` : ""}
            <h1 class="event-detail-title">${esc(item.title)}</h1>
            <div class="event-detail-rule"></div>

            ${item.teacher ? detailItem("person", "Taught by", item.teacher) : ""}
            ${item.kind === "class"
              ? detailItem("event_repeat", "When", whenLong(item))
              : detailItem("calendar_month", "Date", whenLong(item))}
            ${item.time ? detailItem("schedule", "Time", item.time,
                item.timeSub ? `<div class="event-detail-sub">${esc(item.timeSub)}</div>` : "") : ""}
            ${locationBlock(item)}

            ${isPast
              ? `<p class="event-detail-sub">This event has already taken place.</p>`
              : `<a href="${esc(register)}" class="btn event-register-btn">${esc(registerLabel)}</a>`}
          </aside>
        </div>
      </div>

      <section class="event-detail-about">
        <h2>${item.kind === "class" ? "About this class" : "About this event"}</h2>
        ${paragraphs(item.description).map(function (p) { return `<p>${esc(p)}</p>`; }).join("")}
        ${isPast || rsvp ? "" : `<a href="${esc(register)}" class="btn event-register-btn">${esc(registerLabel)}</a>`}
      </section>

      ${rsvp ? rsvpHTML(item) : ""}

      <section class="event-detail-questions">
        <span class="event-detail-questions-icon">${icon("mail")}</span>
        <div>
          <h2>Questions?</h2>
          <p>Email us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
        </div>
      </section>`;
  }

  /* ---------- RSVP form ---------- */

  function rsvpHTML(item) {
    return `
      <section class="event-rsvp" id="rsvp" aria-labelledby="rsvp-title">
        <h2 id="rsvp-title">RSVP</h2>
        <p class="event-rsvp-intro">Let us know you’re coming so we can plan food and seating.</p>

        <form name="event-rsvp" method="POST" class="event-rsvp-form" id="rsvp-form" novalidate>
          <input type="hidden" name="form-name" value="event-rsvp">
          <input type="hidden" name="event_id" value="${esc(item.id)}">
          <input type="hidden" name="event_title" value="${esc(item.title)}">
          <input type="hidden" name="event_date" value="${esc(item.date || "")}">
          <p class="rsvp-hp" aria-hidden="true">
            <label>Leave this empty <input name="bot-field" tabindex="-1" autocomplete="off"></label>
          </p>

          <div class="rsvp-grid">
            <div class="rsvp-field">
              <label for="rsvp-name">Full name <span class="req">*</span></label>
              <input type="text" id="rsvp-name" name="name" autocomplete="name" required>
            </div>
            <div class="rsvp-field">
              <label for="rsvp-email">Email <span class="req">*</span></label>
              <input type="email" id="rsvp-email" name="email" autocomplete="email" required>
            </div>
            <div class="rsvp-field">
              <label for="rsvp-phone">Phone <span class="rsvp-optional">(optional)</span></label>
              <input type="tel" id="rsvp-phone" name="phone" autocomplete="tel">
            </div>
            <div class="rsvp-field rsvp-field-pair">
              <div>
                <label for="rsvp-adults">Adults <span class="req">*</span></label>
                <input type="number" id="rsvp-adults" name="adults" min="1" max="30" value="1" required>
              </div>
              <div>
                <label for="rsvp-kids">Kids</label>
                <input type="number" id="rsvp-kids" name="kids" min="0" max="30" value="0">
              </div>
            </div>
            <div class="rsvp-field rsvp-field-full">
              <label for="rsvp-notes">Anything we should know? <span class="rsvp-optional">(allergies, questions)</span></label>
              <textarea id="rsvp-notes" name="notes" rows="3"></textarea>
            </div>
          </div>

          <p class="rsvp-error" id="rsvp-error" role="alert" hidden></p>
          <button type="submit" class="btn event-register-btn rsvp-submit">Send RSVP</button>
        </form>

        <div class="rsvp-success" id="rsvp-success" tabindex="-1" hidden>
          ${icon("check_circle")}
          <div>
            <h3>You’re on the list!</h3>
            <p>Thanks for letting us know. See you at ${esc(item.title)}.
              If your plans change, email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
          </div>
        </div>
      </section>`;
  }

  function setupRsvp() {
    const form = document.getElementById("rsvp-form");
    if (!form) return;
    const errorEl = document.getElementById("rsvp-error");
    const successEl = document.getElementById("rsvp-success");
    const button = form.querySelector(".rsvp-submit");

    function showError(text) {
      errorEl.textContent = text;
      errorEl.hidden = false;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      errorEl.hidden = true;

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      if (IS_LOCAL) {
        showError("RSVPs only send on the live site (Netlify). The form looks right — test it on eastonshul.com.");
        return;
      }

      button.disabled = true;
      button.textContent = "Sending…";

      try {
        const res = await fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(new FormData(form)).toString()
        });
        if (!res.ok) throw new Error("Status " + res.status);
        form.hidden = true;
        successEl.hidden = false;
        successEl.focus();
      } catch (err) {
        console.warn("RSVP:", err);
        showError("Sorry, your RSVP didn’t go through. Please try again, or email " + CONTACT_EMAIL + ".");
        button.disabled = false;
        button.textContent = "Send RSVP";
      }
    });
  }

  function notFoundHTML() {
    return `
      <a href="events.html" class="member-back">
        ${icon("arrow_back")}
        <span class="member-back-text">Back to events</span>
      </a>
      <h1 class="event-detail-title">Event not found</h1>
      <p class="events-empty">This event may have ended or been removed. See what's coming up on our
        <a href="events.html">events page</a>.</p>`;
  }

  /* ---------- page setup ---------- */

  async function init() {
    const homeEl = document.getElementById("home-events");
    const listEl = document.getElementById("events-list");
    const detailEl = document.getElementById("event-detail");
    const moreEl = document.getElementById("upcoming-events");
    if (!homeEl && !listEl && !detailEl && !moreEl) return;

    const data = await loadAll();
    const emptyText = "No upcoming events right now. Check back soon!";

    if (homeEl) {
      homeEl.innerHTML = data.listed.length
        ? data.listed.slice(0, HOME_LIMIT).map(homeCard).join("")
        : emptyState(emptyText);
    }

    if (listEl) {
      listEl.innerHTML = data.listed.length
        ? data.listed.map(featureCard).join("")
        : emptyState(emptyText);
    }

    let currentId = null;
    if (detailEl) {
      currentId = currentEventId();
      const item = data.all.find(function (i) { return i.id === currentId; });
      detailEl.innerHTML = item ? detailHTML(item) : notFoundHTML();
      setupRsvp();
      if (item) {
        document.title = item.title + " | Easton Shul";
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute("content", paragraphs(item.description)[0] || item.title);
      }
    }

    if (moreEl) {
      const others = data.listed.filter(function (i) { return i.id !== currentId; }).slice(0, UPCOMING_LIMIT);
      const section = moreEl.closest("section");
      if (others.length) {
        moreEl.innerHTML = others.map(moreCard).join("");
      } else if (section) {
        section.hidden = true;
      }
    }
  }

  init();
})();