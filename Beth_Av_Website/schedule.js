/* =========================================================
   Easton Shul – auto-updating weekly service schedule
   Dates roll over every Sunday; zmanim come from Hebcal.
========================================================= */
(function () {
    // ===================== CONFIG =====================
    const ZIP = "18042";               // Easton, PA
    const TZ = "America/New_York";
    const CANDLE_MINUTES = 18;         // candle lighting = sunset - 18
    const HAVDALAH_MINUTES = 72;       // Rabbeinu Tam

    // Each time is either:
    //   "HH:MM" (24-hour, fixed every week), or
    //   { zman: "candles" | "havdalah", offset: minutes }  (moves with sunset)
    const SERVICES = {
        friday: [
            {
                name: "Kabbalat Shabbat",
                start: { zman: "candles", offset: CANDLE_MINUTES } // = sunset
            }
        ],
        saturday: [
            { name: "Shacharis", start: "09:30" },
            {
                name: "Mincha",
                start: { zman: "havdalah", offset: -HAVDALAH_MINUTES } // = sunset
            },
            {
                name: "Maariv",
                start: { zman: "havdalah", offset: 10 } // 10 min after the 72-min zman
            }
        ]
    };
    // ==================================================

    const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
        "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

    const fridayEl = document.getElementById("schedule-friday");
    const saturdayEl = document.getElementById("schedule-saturday");
    const subtitleEl = document.getElementById("schedule-subtitle");
    if (!fridayEl || !saturdayEl) return;

    function nowInTZ() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    }

    // Friday of the current Shabbat week (Saturday still shows today's Shabbat;
    // Sunday rolls forward to the next one).
    function upcomingFriday() {
        const d = nowInTZ();
        d.setHours(12, 0, 0, 0);
        const day = d.getDay();
        const diff = day === 6 ? -1 : (5 - day + 7) % 7;
        d.setDate(d.getDate() + diff);
        return d;
    }

    function ymd(d) {
        return d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
    }

    function fmtClock(h, m) {
        const ampm = h >= 12 ? "pm" : "am";
        const hh = h % 12 || 12;
        return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
    }

    function fmtDate(dateObj) {
        return dateObj
            .toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
            .toLowerCase();
    }

    function resolve(t, zmanim) {
        if (!t) return null;
        if (typeof t === "string") {
            const [h, m] = t.split(":").map(Number);
            return fmtClock(h, m);
        }
        const base = zmanim && zmanim[t.zman];
        if (!base) return null;
        return fmtDate(new Date(base.getTime() + (t.offset || 0) * 60000));
    }

    function timeRange(service, zmanim, state) {
        const a = resolve(service.start, zmanim);
        const b = resolve(service.end, zmanim);
        if (!a) return state === "loading" ? "Loading times…" : "See calendar for times";
        return b ? `${a} – ${b}` : a;
    }

    function itemHTML(dateObj, weekday, service, zmanim, state) {
        return `
      <div class="schedule-item">
        <div class="schedule-date">
          <div class="schedule-date-top">${MONTHS[dateObj.getMonth()]}</div>
          <div class="schedule-date-day">${dateObj.getDate()}</div>
          <div class="schedule-date-bottom">${weekday}</div>
        </div>
        <div class="schedule-info">
          <strong>${service.name}</strong>
          <div class="schedule-time">${timeRange(service, zmanim, state)}</div>
        </div>
      </div>`;
    }

    function render(fri, sat, zmanim, state, info) {
        fridayEl.innerHTML = SERVICES.friday
            .map(s => itemHTML(fri, "FRIDAY", s, zmanim, state)).join("");
        saturdayEl.innerHTML = SERVICES.saturday
            .map(s => itemHTML(sat, "SATURDAY", s, zmanim, state)).join("");

        if (subtitleEl) {
            const parts = [];
            if (info && info.title) parts.push(info.title);
            if (zmanim && zmanim.candles) parts.push(`Candle lighting ${fmtDate(zmanim.candles)}`);
            if (zmanim && zmanim.havdalah) parts.push(`Havdalah ${fmtDate(zmanim.havdalah)}`);
            subtitleEl.textContent = parts.join(" · ");
        }
    }

    async function load() {
        const fri = upcomingFriday();
        const sat = new Date(fri);
        sat.setDate(fri.getDate() + 1);

        render(fri, sat, null, "loading");

        const url = "https://www.hebcal.com/shabbat?cfg=json" +
            `&zip=${ZIP}&b=${CANDLE_MINUTES}&m=${HAVDALAH_MINUTES}` +
            `&gy=${fri.getFullYear()}&gm=${fri.getMonth() + 1}&gd=${fri.getDate()}`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("Hebcal " + res.status);
            const data = await res.json();
            const items = data.items || [];

            const candles = items.find(i => i.category === "candles" && i.date.startsWith(ymd(fri)));
            const havdalah = items.find(i => i.category === "havdalah" && i.date.startsWith(ymd(sat)));
            const parsha = items.find(i => i.category === "parashat");
            const holiday = items.find(i => i.category === "holiday" && i.date.startsWith(ymd(sat)));

            const zmanim = {
                candles: candles ? new Date(candles.date) : null,
                havdalah: havdalah ? new Date(havdalah.date) : null
            };

            render(fri, sat, zmanim, "ready", { title: (parsha || holiday || {}).title });
        } catch (err) {
            console.warn("Schedule: could not load zmanim", err);
            render(fri, sat, null, "error");
        }
    }

    load();
})();