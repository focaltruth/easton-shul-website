/* =========================================================
   Easton Shul – turn "event-submission" form entries into
   GitHub pull requests (one PR per event).

   Netlify runs this automatically after every verified form
   submission (the file name "submission-created" is what
   triggers it). Spam-flagged submissions never reach it.

   Environment variables (Netlify → Project configuration →
   Environment variables):
     GITHUB_TOKEN          fine-grained token (Contents + Pull requests: read/write)
     EVENT_FORM_PASSCODE   the passcode staff type into the form
     GITHUB_REPO           optional, default focaltruth/easton-shul-website
     GITHUB_BRANCH         optional, default main
     SITE_DIR              optional, default Beth_Av_Website
========================================================= */
import { timingSafeEqual } from "node:crypto";

const REPO = process.env.GITHUB_REPO || "focaltruth/easton-shul-website";
const BASE_BRANCH = process.env.GITHUB_BRANCH || "main";
const SITE_DIR = process.env.SITE_DIR || "Beth_Av_Website";
const EVENTS_PATH = `${SITE_DIR}/data/events.json`;
const IMAGES_DIR = `${SITE_DIR}/images/events`;

const FORM_NAME = "event-submission";
const TAGS = ["Holiday", "Shabbat", "Torah Study", "Community", "Youth", "Other"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/* ---------- small helpers ---------- */

function clean(value, max) {
  return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function slugify(text) {
  return String(text)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "event";
}

// "15:00" -> "3:00 PM"
function to12h(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23 || Number(min) > 59) return "";
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${min} ${suffix}`;
}

function httpsUrl(value) {
  const s = clean(value, 500);
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function passcodeOk(given) {
  const expected = process.env.EVENT_FORM_PASSCODE || "";
  if (!expected) return false;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function photoUrl(photo) {
  if (!photo) return "";
  if (typeof photo === "string") return photo;
  return photo.url || "";
}

/* ---------- build the events.json entry from the form ---------- */

export function buildEvent(data) {
  const errors = [];

  const title = clean(data.title, 80);
  if (!title) errors.push("missing title");

  const tag = TAGS.includes(clean(data.tag, 40)) ? clean(data.tag, 40) : "Other";

  const date = clean(data.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("bad date");

  const start = to12h(data.start_time);
  const end = to12h(data.end_time);
  if (!start) errors.push("bad start time");
  const time = end ? `${start} – ${end}` : start;

  const online = clean(data.location_type, 20) === "online";
  const location = online
    ? { type: "online", name: "Online via Zoom", joinUrl: httpsUrl(data.zoom_link) }
    : {
        type: "in-person",
        name: clean(data.location_name, 80) || "Beth Avraham",
        address: clean(data.address, 160)
      };

  const description = clean(data.description, 1500)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  if (!description.length) errors.push("missing description");

  const photo = photoUrl(data.photo);
  if (!/^https:\/\//i.test(photo)) errors.push("missing photo");

  return {
    errors,
    photo,
    event: {
      id: `${slugify(title)}-${date}`,
      title,
      tag,
      date,
      time,
      location,
      image: "", // filled in after the photo is saved
      imageAlt: title,
      imageFit: "cover",
      description,
      registerUrl: httpsUrl(data.register_url)
    }
  };
}

/* ---------- GitHub API ---------- */

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "easton-shul-event-bot"
    }
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`GitHub ${options.method || "GET"} ${path} → ${res.status}: ${body.message || text}`);
  return body;
}

function encodePath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

async function downloadPhoto(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo download failed: ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = PHOTO_TYPES[type];
  if (!ext) throw new Error(`photo type not allowed: ${type || "unknown"}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) throw new Error(`photo too large: ${buf.length} bytes`);
  return { buf, ext };
}

export async function openPullRequest(data) {
  const { errors, photo, event } = buildEvent(data);
  if (errors.length) throw new Error("invalid submission: " + errors.join(", "));

  // 1. Read events.json from main and make sure the id is unique
  const file = await gh(`/repos/${REPO}/contents/${encodePath(EVENTS_PATH)}?ref=${BASE_BRANCH}`);
  const events = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  const taken = new Set(events.map((e) => e.id));
  let id = event.id;
  for (let n = 2; taken.has(id); n++) id = `${event.id}-${n}`;
  event.id = id;

  // 2. New branch from main
  const base = await gh(`/repos/${REPO}/git/ref/heads/${BASE_BRANCH}`);
  const branch = `event/${id}-${Date.now().toString(36)}`;
  await gh(`/repos/${REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha })
  });

  // 3. Save the photo
  const { buf, ext } = await downloadPhoto(photo);
  const imagePath = `${IMAGES_DIR}/${id}.${ext}`;
  await gh(`/repos/${REPO}/contents/${encodePath(imagePath)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add photo for ${event.title}`,
      content: buf.toString("base64"),
      branch
    })
  });
  event.image = `images/events/${id}.${ext}`;

  // 4. Add the event to events.json
  events.push(event);
  await gh(`/repos/${REPO}/contents/${encodePath(EVENTS_PATH)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add event: ${event.title}`,
      content: Buffer.from(JSON.stringify(events, null, 2) + "\n").toString("base64"),
      sha: file.sha,
      branch
    })
  });

  // 5. Open the pull request
  const submitter = clean(data.submitter_name, 80) || "Unknown";
  const email = clean(data.submitter_email, 120);
  const notes = clean(data.notes, 1000);
  const pr = await gh(`/repos/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `New event: ${event.title} (${event.date})`,
      head: branch,
      base: BASE_BRANCH,
      body: [
        `**Submitted by:** ${submitter}${email ? ` (${email})` : ""}`,
        notes ? `**Notes for the reviewer:** ${notes}` : "",
        "",
        "### How to review",
        `1. Wait for Netlify's **Deploy Preview** link to appear below (about a minute).`,
        `2. Open the preview and add \`/events/${id}\` to the end of the address.`,
        "3. Looks good? Click **Merge pull request**, and the event goes live.",
        "4. Need a fix? Edit the files in this pull request first, or click **Close** to reject it.",
        "",
        "### Event data",
        "```json",
        JSON.stringify(event, null, 2),
        "```"
      ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n")
    })
  });

  return { url: pr.html_url, id };
}

/* ---------- Netlify entry point ---------- */

export const handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body || "{}");
    if (!payload || payload.form_name !== FORM_NAME) {
      return { statusCode: 200, body: "Not an event submission, ignored." };
    }

    const data = payload.data || {};
    if (!passcodeOk(data.passcode)) {
      console.warn("Event submission ignored: wrong or missing passcode.");
      return { statusCode: 200, body: "Wrong passcode, ignored." };
    }

    const result = await openPullRequest(data);
    console.log(`Opened pull request for "${result.id}": ${result.url}`);
    return { statusCode: 200, body: result.url };
  } catch (err) {
    // The submission is still saved in Netlify Forms, so nothing is lost.
    console.error("Could not open pull request:", err.message);
    return { statusCode: 200, body: "Error logged." };
  }
};