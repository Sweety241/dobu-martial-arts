/* ============================================================
   DoBu Martial Arts — Zero-install backend
   Uses ONLY Node.js built-in modules.
   Run with: node --experimental-sqlite server/server.js
============================================================ */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");           // project root
const DB_PATH = path.join(ROOT, "dobu.db");

/* ---------------- DATABASE ---------------- */

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8"));

console.log("[db] SQLite ready at", DB_PATH);

/* ---------------- HELPERS ---------------- */

function json(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true"
    });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try { resolve(JSON.parse(body || "{}")); }
            catch { resolve({}); }
        });
    });
}

function parseCookies(req) {
    const header = req.headers.cookie || "";
    const out = {};
    header.split(";").forEach(part => {
        const [k, ...v] = part.trim().split("=");
        if (k) out[k] = decodeURIComponent(v.join("="));
    });
    return out;
}

function setCookie(res, name, value, maxAgeSeconds) {
    const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
    const existing = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", existing ? [].concat(existing, cookie) : cookie);
}

function hashPassword(password, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, originalHash] = stored.split(":");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(originalHash, "hex")
    );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- SESSIONS ---------------- */

function createSession(userId) {
    const id = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(id, userId, expires);
    return id;
}

function getUserFromSession(req) {
    const cookies = parseCookies(req);
    const sid = cookies["dobu_sid"];
    if (!sid) return null;

    const session = db.prepare(
        "SELECT user_id, expires_at FROM sessions WHERE id = ?"
    ).get(sid);

    if (!session) return null;

    if (new Date(session.expires_at) < new Date()) {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
        return null;
    }

    const user = db.prepare(
        "SELECT id, name, email FROM users WHERE id = ?"
    ).get(session.user_id);

    return user || null;
}

function getMembership(userId) {
    return db.prepare(`
        SELECT m.id AS membership_id,
               p.id AS plan_id, p.slug, p.name, p.price, p.price_unit,
               p.sessions_max, p.description
        FROM memberships m
        JOIN plans p ON p.id = m.plan_id
        WHERE m.user_id = ?
    `).get(userId) || null;
}

/* ---------------- STATIC FILES ---------------- */

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".webp": "image/webp"
};

function serveStatic(req, res, urlPath) {
    if (urlPath === "/") urlPath = "/index.html";

    // Security: prevent directory traversal
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
        return json(res, 403, { error: "Forbidden" });
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            // 404: serve custom 404 page for unknown paths
            fs.readFile(path.join(ROOT, "404.html"), (err2, html) => {
                if (err2) return json(res, 404, { error: "Not found" });
                res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                res.end(html);
            });
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
    });
}

/* ---------------- API ROUTES ---------------- */

async function handleApi(req, res, urlPath) {
    const method = req.method;

    /* ---- POST /api/auth/register ---- */
    if (urlPath === "/api/auth/register" && method === "POST") {
        const { name, email, password } = await parseBody(req);

        if (!name || name.trim().length < 2)
            return json(res, 400, { error: "Please enter your full name." });
        if (!email || !EMAIL_RE.test(email))
            return json(res, 400, { error: "Please enter a valid email." });
        if (!password || password.length < 6)
            return json(res, 400, { error: "Password must be at least 6 characters." });

        const existing = db.prepare("SELECT id FROM users WHERE email = ?")
            .get(email.trim().toLowerCase());
        if (existing)
            return json(res, 409, { error: "An account with this email already exists." });

        const hash = hashPassword(password);
        const result = db.prepare(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
        ).run(name.trim(), email.trim().toLowerCase(), hash);

        const sid = createSession(result.lastInsertRowid);
        setCookie(res, "dobu_sid", sid, 7 * 24 * 60 * 60);

        return json(res, 201, {
            user: { id: result.lastInsertRowid, name: name.trim(), email: email.trim().toLowerCase() }
        });
    }

    /* ---- POST /api/auth/login ---- */
    if (urlPath === "/api/auth/login" && method === "POST") {
        const { email, password } = await parseBody(req);

        if (!email || !password)
            return json(res, 400, { error: "Please enter your email and password." });

        const user = db.prepare("SELECT * FROM users WHERE email = ?")
            .get(email.trim().toLowerCase());

        if (!user || !verifyPassword(password, user.password_hash))
            return json(res, 401, { error: "Incorrect email or password." });

        const sid = createSession(user.id);
        setCookie(res, "dobu_sid", sid, 7 * 24 * 60 * 60);

        return json(res, 200, {
            user: { id: user.id, name: user.name, email: user.email }
        });
    }

    /* ---- POST /api/auth/logout ---- */
    if (urlPath === "/api/auth/logout" && method === "POST") {
        const cookies = parseCookies(req);
        if (cookies["dobu_sid"]) {
            db.prepare("DELETE FROM sessions WHERE id = ?").run(cookies["dobu_sid"]);
        }
        setCookie(res, "dobu_sid", "", 0);
        return json(res, 200, { ok: true });
    }

    /* ---- GET /api/auth/me ---- */
    if (urlPath === "/api/auth/me" && method === "GET") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 200, { user: null, membership: null });
        return json(res, 200, { user, membership: getMembership(user.id) });
    }

    /* ---- GET /api/plans ---- */
    if (urlPath === "/api/plans" && method === "GET") {
        const plans = db.prepare("SELECT * FROM plans ORDER BY price ASC").all();
        return json(res, 200, plans);
    }

    /* ---- PUT /api/plans/me ---- */
    if (urlPath === "/api/plans/me" && method === "PUT") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const { plan_slug } = await parseBody(req);
        if (!plan_slug) return json(res, 400, { error: "plan_slug is required" });

        const plan = db.prepare("SELECT * FROM plans WHERE slug = ?").get(plan_slug);
        if (!plan) return json(res, 404, { error: "Plan not found" });

        const existing = db.prepare("SELECT id FROM memberships WHERE user_id = ?").get(user.id);

        if (existing) {
            db.prepare("UPDATE memberships SET plan_id = ?, started_at = CURRENT_TIMESTAMP WHERE user_id = ?")
              .run(plan.id, user.id);
        } else {
            db.prepare("INSERT INTO memberships (user_id, plan_id) VALUES (?, ?)")
              .run(user.id, plan.id);
        }

        /* Trim bookings if new plan has lower limit */
        if (plan.sessions_max !== -1) {
            const count = db.prepare(
                "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?"
            ).get(user.id).n;

            if (count > plan.sessions_max) {
                const keep = db.prepare(
                    "SELECT id FROM bookings WHERE user_id = ? ORDER BY booked_at ASC LIMIT ?"
                ).all(user.id, plan.sessions_max);
                const keepIds = new Set(keep.map(r => r.id));
                const all = db.prepare("SELECT id FROM bookings WHERE user_id = ?").all(user.id);
                for (const row of all) {
                    if (!keepIds.has(row.id)) {
                        db.prepare("DELETE FROM bookings WHERE id = ?").run(row.id);
                    }
                }
            }
        }

        return json(res, 200, { ok: true, plan });
    }

    /* ---- GET /api/classes ---- */
    if (urlPath === "/api/classes" && method === "GET") {
        const classes = db.prepare("SELECT * FROM classes ORDER BY day, start_time").all();
        return json(res, 200, classes);
    }

    /* ---- GET /api/bookings ---- */
    if (urlPath === "/api/bookings" && method === "GET") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const bookings = db.prepare(`
            SELECT b.id, b.booked_at,
                   c.id AS class_id, c.day, c.start_time, c.end_time, c.name, c.type
            FROM bookings b
            JOIN classes c ON c.id = b.class_id
            WHERE b.user_id = ?
            ORDER BY b.booked_at ASC
        `).all(user.id);

        return json(res, 200, bookings);
    }

    /* ---- POST /api/bookings ---- */
    if (urlPath === "/api/bookings" && method === "POST") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const { class_id } = await parseBody(req);
        if (!class_id) return json(res, 400, { error: "class_id is required" });

        const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
        if (!cls) return json(res, 404, { error: "Class not found" });

        const membership = getMembership(user.id);
        if (!membership)
            return json(res, 403, { error: "Please choose a membership plan before booking." });

        if (membership.sessions_max !== -1) {
            const count = db.prepare(
                "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?"
            ).get(user.id).n;

            if (count >= membership.sessions_max)
                return json(res, 403, { error: "Weekly session limit reached." });
        }

        const existing = db.prepare(
            "SELECT id FROM bookings WHERE user_id = ? AND class_id = ?"
        ).get(user.id, class_id);

        if (existing)
            return json(res, 409, { error: "You have already booked this class." });

        const result = db.prepare(
            "INSERT INTO bookings (user_id, class_id) VALUES (?, ?)"
        ).run(user.id, class_id);

        return json(res, 201, { ok: true, booking_id: result.lastInsertRowid });
    }

    /* ---- DELETE /api/bookings/:id ---- */
    const bookingMatch = urlPath.match(/^\/api\/bookings\/(\d+)$/);
    if (bookingMatch && method === "DELETE") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const bookingId = Number(bookingMatch[1]);
        const booking = db.prepare(
            "SELECT id FROM bookings WHERE id = ? AND user_id = ?"
        ).get(bookingId, user.id);

        if (!booking) return json(res, 404, { error: "Booking not found" });

        db.prepare("DELETE FROM bookings WHERE id = ?").run(bookingId);
        return json(res, 200, { ok: true });
    }

    /* ---- PUT /api/users/me ---- */
    if (urlPath === "/api/users/me" && method === "PUT") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const { name, email } = await parseBody(req);

        if (!name || name.trim().length < 2)
            return json(res, 400, { error: "Please enter a valid name." });
        if (!email || !EMAIL_RE.test(email))
            return json(res, 400, { error: "Please enter a valid email." });

        const conflict = db.prepare(
            "SELECT id FROM users WHERE email = ? AND id != ?"
        ).get(email.trim().toLowerCase(), user.id);

        if (conflict)
            return json(res, 409, { error: "That email is already in use." });

        db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?")
          .run(name.trim(), email.trim().toLowerCase(), user.id);

        const updated = db.prepare(
            "SELECT id, name, email FROM users WHERE id = ?"
        ).get(user.id);

        return json(res, 200, { user: updated });
    }

        /* ---- GET /api/posts ---- */
    if (urlPath === "/api/posts" && method === "GET") {
        const posts = db.prepare(`
            SELECT p.id, p.content, p.created_at,
                   u.id AS user_id, u.name AS author_name
            FROM posts p
            JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC
            LIMIT 100
        `).all();

        return json(res, 200, posts);
    }

    /* ---- POST /api/posts ---- */
    if (urlPath === "/api/posts" && method === "POST") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const { content } = await parseBody(req);

        if (!content || content.trim().length < 2)
            return json(res, 400, { error: "Post content is required." });
        if (content.trim().length > 500)
            return json(res, 400, { error: "Posts must be under 500 characters." });

        const result = db.prepare(
            "INSERT INTO posts (user_id, content) VALUES (?, ?)"
        ).run(user.id, content.trim());

        const post = db.prepare(`
            SELECT p.id, p.content, p.created_at,
                   u.id AS user_id, u.name AS author_name
            FROM posts p
            JOIN users u ON u.id = p.user_id
            WHERE p.id = ?
        `).get(result.lastInsertRowid);

        return json(res, 201, post);
    }

    /* ---- DELETE /api/posts/:id ---- */
    const postMatch = urlPath.match(/^\/api\/posts\/(\d+)$/);
    if (postMatch && method === "DELETE") {
        const user = getUserFromSession(req);
        if (!user) return json(res, 401, { error: "Not authenticated" });

        const postId = Number(postMatch[1]);
        const post = db.prepare(
            "SELECT user_id FROM posts WHERE id = ?"
        ).get(postId);

        if (!post) return json(res, 404, { error: "Post not found" });
        if (post.user_id !== user.id)
            return json(res, 403, { error: "You can only delete your own posts." });

        db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
        return json(res, 200, { ok: true });
    }
    
    /* ---- Unknown API endpoint ---- */
    return json(res, 404, { error: "API endpoint not found" });
}

/* ---------------- HTTP SERVER ---------------- */

const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split("?")[0];

    try {
        if (urlPath.startsWith("/api/")) {
            await handleApi(req, res, urlPath);
        } else {
            serveStatic(req, res, urlPath);
        }
    } catch (err) {
        console.error("[error]", err);
        if (!res.headersSent) {
            json(res, 500, { error: "Internal server error" });
        }
    }
});

server.listen(PORT, () => {
    console.log(`[server] DoBu running at http://localhost:${PORT}`);
});