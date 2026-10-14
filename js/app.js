/* =========================================================
   DoBu Martial Arts — Front-end Application
   Handles: mobile menu, classes, membership, account
========================================================= */

(function () {
    "use strict";

    const $  = (id) => document.getElementById(id);
    const $$ = (sel) => document.querySelectorAll(sel);

    /* ---------------------------------------------------
       MOBILE MENU
    --------------------------------------------------- */
    const menuToggle = $("menuToggle");
    const navLinks   = document.querySelector(".nav-links");
    if (menuToggle && navLinks) {
        menuToggle.addEventListener("click", () => navLinks.classList.toggle("show"));
    }
    $$(".nav-links a").forEach(a => {
        a.addEventListener("click", () => navLinks && navLinks.classList.remove("show"));
    });

    /* ---------------------------------------------------
       FOOTER YEAR
    --------------------------------------------------- */
    const yearEl = document.querySelector(".footer-bottom p");
    if (yearEl) {
        yearEl.textContent = "© " + new Date().getFullYear() +
            " DoBu Martial Arts. All Rights Reserved.";
    }

    /* ===================================================
       CLASSES PAGE
    =================================================== */
    async function initClassesPage() {
        const buttons = $$(".book-btn");
        if (!buttons.length) return;

        const summary = $("bookingSummary");
        let classes = [];
        let userData = { user: null, membership: null };
        let bookings = [];

        /* Load classes from API */
        try { classes = await API.getClasses(); } catch (e) { console.error(e); }

        /* Match each button to a class ID by its data-class text */
        buttons.forEach(btn => {
            const text = btn.getAttribute("data-class");
            const match = classes.find(c =>
                `${c.day} - ${c.name} ${c.start_time} – ${c.end_time}` === text
            );
            if (match) btn.dataset.classId = match.id;
        });

        /* Load user + bookings */
        try {
            userData = await API.me();
            if (userData.user) bookings = await API.getBookings();
        } catch (e) { /* not logged in */ }

        let bookedIds = new Set(bookings.map(b => b.class_id));
        const limit = userData.membership ? userData.membership.sessions_max : 0;

        /* Refresh all buttons + summary */
        function refresh() {
            buttons.forEach(btn => {
                const id = Number(btn.dataset.classId);
                const label = btn.getAttribute("data-default-label") || "BOOK";
                btn.classList.remove("booked", "disabled");
                btn.disabled = false;
                btn.textContent = label;

                if (bookedIds.has(id)) {
                    btn.textContent = "BOOKED ✓";
                    btn.classList.add("booked");
                } else if (userData.user && limit !== -1 && bookedIds.size >= limit) {
                    btn.textContent = "LIMIT REACHED";
                    btn.classList.add("disabled");
                    btn.disabled = true;
                }
            });

            if (summary) {
                if (!userData.user) {
                    summary.textContent = "Log in to book classes.";
                } else if (!userData.membership) {
                    summary.textContent = "Choose a membership plan to start booking classes.";
                } else {
                    const max = userData.membership.sessions_max;
                    summary.textContent = max === -1
                        ? `Unlimited sessions — ${bookedIds.size} booked`
                        : `${bookedIds.size} of ${max} weekly sessions booked`;
                }
            }
        }

        /* Wire up buttons */
        buttons.forEach(btn => {
            btn.addEventListener("click", async () => {
                /* Not logged in → send to account page */
                if (!userData.user) {
                    sessionStorage.setItem("dobu_redirect_after_login", "classes.html");
                    window.location.href = "account.html";
                    return;
                }

                const id = Number(btn.dataset.classId);
                if (!id) return;

                /* Toggle: if already booked, cancel */
                if (bookedIds.has(id)) {
                    const booking = bookings.find(b => b.class_id === id);
                    if (!booking) return;
                    if (!confirm("Cancel this booking?")) return;
                    try {
                        await API.cancelBooking(booking.id);
                        bookings = bookings.filter(b => b.id !== booking.id);
                        bookedIds.delete(id);
                        refresh();
                    } catch (err) { alert(err.message); }
                    return;
                }

                /* Book */
                try {
                    await API.book(id);
                    bookings = await API.getBookings();
                    bookedIds = new Set(bookings.map(b => b.class_id));
                    refresh();
                    window.location.href = "account.html";
                } catch (err) { alert(err.message); }
            });
        });

        refresh();
    }

    /* ===================================================
       MEMBERSHIP PAGE
    =================================================== */
    async function initMembershipPage() {
        const buttons = $$(".plan-btn");
        if (!buttons.length) return;

        let userData = { user: null, membership: null };
        try { userData = await API.me(); } catch (e) {}

        /* Map display name → plan slug */
        const slugMap = {
            "Basic":                        "basic",
            "Intermediate":                 "intermediate",
            "Advanced":                     "advanced",
            "Elite":                        "elite",
            "Junior":                       "junior",
            "Private Martial Arts Tuition": "private"
        };

        function refresh() {
            buttons.forEach(btn => {
                const planName = btn.getAttribute("data-plan");
                const slug = slugMap[planName];
                const isCurrent = userData.membership && slug === userData.membership.slug;
                const label = btn.getAttribute("data-default-label") || "SELECT PLAN";
                btn.classList.toggle("selected", isCurrent);
                btn.textContent = isCurrent ? "SELECTED ✓" : label;
                const card = btn.closest(".pricing-card, .price-card");
                if (card) card.classList.toggle("selected-plan", isCurrent);
            });
        }

        buttons.forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!userData.user) {
                    sessionStorage.setItem("dobu_redirect_after_login", "membership.html");
                    window.location.href = "account.html";
                    return;
                }

                const planName = btn.getAttribute("data-plan");
                const slug = slugMap[planName];

                try {
                    await API.selectPlan(slug);
                    userData = await API.me();
                    refresh();
                    window.location.href = "account.html";
                } catch (err) { alert(err.message); }
            });
        });

        refresh();
    }

    /* ===================================================
       ACCOUNT PAGE
    =================================================== */
    async function initAccountPage() {
        const loginView     = $("loginView");
        const dashboardView = $("dashboardView");
        if (!loginView || !dashboardView) return;

        /* ---------- AUTH TABS ---------- */
        const authTabs   = $$(".auth-tab");
        const authPanels = $$(".auth-panel");
        function showAuthPanel(id) {
            authTabs.forEach(t => t.classList.toggle("active", t.dataset.authTab === id));
            authPanels.forEach(p => p.classList.toggle("active", p.id === id));
        }
        authTabs.forEach(t =>
            t.addEventListener("click", () => showAuthPanel(t.dataset.authTab))
        );
        $$(".auth-switch-link").forEach(l =>
            l.addEventListener("click", e => {
                e.preventDefault();
                showAuthPanel(l.dataset.switchTo);
            })
        );

        /* ---------- ELEMENTS ---------- */
        const loginForm      = $("loginForm");
        const loginEmail     = $("loginEmail");
        const loginPassword  = $("loginPassword");
        const loginMessage   = $("loginMessage");

        const registerForm     = $("registerForm");
        const registerName     = $("registerName");
        const registerEmail    = $("registerEmail");
        const registerPassword = $("registerPassword");
        const registerConfirm  = $("registerConfirm");
        const registerMessage  = $("registerMessage");

        const logoutBtn = $("logoutBtn");
        const menuItems = $$(".account-menu-item");
        const panels    = $$(".account-panel");

        function showMsg(el, text, isError) {
            if (!el) return;
            el.style.display = "block";
            el.textContent = text;
            el.style.borderLeftColor = isError ? "#888" : "#d71920";
        }

        function showLogin() {
            loginView.style.display = "block";
            dashboardView.style.display = "none";
        }

        async function showDashboard() {
            loginView.style.display = "none";
            dashboardView.style.display = "block";
            await renderDashboard();
        }

        /* ---------- RENDER DASHBOARD ---------- */
        async function renderDashboard() {
            let data;
            try { data = await API.me(); }
            catch { return showLogin(); }

            if (!data.user) return showLogin();

            const { user, membership } = data;
            const bookings = await API.getBookings();

            /* Sidebar + welcome */
            $("sidebarName").textContent = user.name;
            $("welcomeName").textContent =
                user.name.split(" ")[0].toUpperCase() + ".";
            const initials = user.name.split(/\s+/).slice(0, 2)
                .map(w => w[0].toUpperCase()).join("");
            $("sidebarAvatar").textContent = initials || "DB";

            /* Overview */
            $("overviewMembership").textContent =
                membership ? membership.name : "Not selected";
            $("overviewPrice").textContent =
                membership ? `£${membership.price}` : "—";
            $("overviewClass").textContent =
                bookings.length === 0
                    ? "No classes booked"
                    : `${bookings.length} booked`;

            /* Profile */
            $("profileName").textContent       = user.name;
            $("profileEmail").textContent      = user.email;
            $("profileMembership").textContent = membership ? membership.name : "Not selected";
            $("memberName").value              = user.name;
            $("memberEmail").value             = user.email;

            /* Membership tab */
            $("currentPlan").textContent      =
                membership ? membership.name : "No membership selected";
            $("currentPlanPrice").textContent =
                membership ? `£${membership.price}` : "—";

            /* Bookings tab */
            const limit = membership ? membership.sessions_max : 0;
            $("bookingsCount").textContent = bookings.length;
            $("bookingsLimit").textContent = limit === -1 ? "∞" : limit;

            const list = $("bookingList");
            if (!list) return;

            if (bookings.length === 0) {
                list.innerHTML = `
                    <p class="empty-bookings">
                        You have no classes booked.
                        <a href="classes.html">Browse the timetable →</a>
                    </p>`;
            } else {
                list.innerHTML = bookings.map((b, i) => `
                    <div class="booking-card">
                        <div class="booking-number">${String(i + 1).padStart(2, "0")}</div>
                        <div class="booking-details">
                            <span>BOOKED SESSION</span>
                            <h3>${b.day} - ${b.name} ${b.start_time} – ${b.end_time}</h3>
                            <p>Saved to your account.</p>
                        </div>
                        <button class="remove-booking" data-id="${b.id}">REMOVE</button>
                    </div>
                `).join("");

                list.querySelectorAll(".remove-booking").forEach(btn => {
                    btn.addEventListener("click", async () => {
                        if (!confirm("Remove this booking?")) return;
                        try {
                            await API.cancelBooking(Number(btn.dataset.id));
                            renderDashboard();
                        } catch (err) { alert(err.message); }
                    });
                });
            }
        }

        /* ---------- LOGIN FORM ---------- */
        if (loginForm) {
            loginForm.addEventListener("submit", async e => {
                e.preventDefault();
                const email    = loginEmail.value.trim();
                const password = loginPassword.value;

                if (!email || !password)
                    return showMsg(loginMessage, "Please enter your email and password.", true);

                try {
                    await API.login(email, password);
                    showMsg(loginMessage, "Login successful. Redirecting…");

                    const redirectTo = sessionStorage.getItem("dobu_redirect_after_login");
                    setTimeout(() => {
                        if (redirectTo) {
                            sessionStorage.removeItem("dobu_redirect_after_login");
                            window.location.href = redirectTo;
                        } else {
                            showDashboard();
                        }
                    }, 400);
                                
                } catch (err) {
                    alert("LOGIN ERROR:\n\n" + err.message);
                    showMsg(loginMessage, err.message, true);
                }
            });
        }

        /* ---------- REGISTER FORM ---------- */
        if (registerForm) {
            registerForm.addEventListener("submit", async e => {
                e.preventDefault();
                const name    = registerName.value.trim();
                const email   = registerEmail.value.trim();
                const pass    = registerPassword.value;
                const confirm = registerConfirm.value;

                if (name.length < 2)
                    return showMsg(registerMessage, "Please enter your full name.", true);
                if (!email.includes("@") || !email.includes("."))
                    return showMsg(registerMessage, "Please enter a valid email.", true);
                if (pass.length < 6)
                    return showMsg(registerMessage, "Password must be at least 6 characters.", true);
                if (pass !== confirm)
                    return showMsg(registerMessage, "Passwords do not match.", true);

                try {
                    await API.register(name, email, pass);
                    showMsg(registerMessage, "Account created. Redirecting…");

                    const redirectTo = sessionStorage.getItem("dobu_redirect_after_login");
                    setTimeout(() => {
                        if (redirectTo) {
                            sessionStorage.removeItem("dobu_redirect_after_login");
                            window.location.href = redirectTo;
                        } else {
                            showDashboard();
                        }
                    }, 400);
                                } catch (err) {
                    alert("REGISTER ERROR:\n\n" + err.message);
                    showMsg(registerMessage, err.message, true);
                }
            });
        }

        /* ---------- LOGOUT ---------- */
        if (logoutBtn) {
            logoutBtn.addEventListener("click", async () => {
                if (!confirm("Log out of your DoBu account?")) return;
                try { await API.logout(); } catch (e) {}
                if (loginForm) loginForm.reset();
                if (registerForm) registerForm.reset();
                if (loginMessage) loginMessage.style.display = "none";
                if (registerMessage) registerMessage.style.display = "none";
                showLogin();
                showAuthPanel("loginPanel");
                window.scrollTo({ top: 0, behavior: "smooth" });
            });
        }

        /* ---------- TABS ---------- */
        menuItems.forEach(item => {
            item.addEventListener("click", () => {
                menuItems.forEach(i => i.classList.remove("active"));
                panels.forEach(p => p.classList.remove("active"));
                item.classList.add("active");
                const target = document.getElementById(item.dataset.section);
                if (target) target.classList.add("active");
            });
        });

        /* ---------- PROFILE FORM ---------- */
        const profileForm    = $("profileForm");
        const profileMessage = $("profileMessage");

        if (profileForm) {
            profileForm.addEventListener("submit", async e => {
                e.preventDefault();
                const name  = $("memberName").value.trim();
                const email = $("memberEmail").value.trim();

                if (name.length < 2)
                    return showMsg(profileMessage, "Please enter a valid name.", true);
                if (!email.includes("@"))
                    return showMsg(profileMessage, "Please enter a valid email.", true);

                try {
                    await API.updateProfile(name, email);
                    showMsg(profileMessage, "Profile saved successfully.");
                    renderDashboard();
                } catch (err) {
                    showMsg(profileMessage, err.message, true);
                }
            });
        }

        /* ---------- INIT ---------- */
        try {
            const data = await API.me();
            if (data.user) await showDashboard();
            else showLogin();
        } catch {
            showLogin();
        }
    }


        /* ===================================================
       COMMUNITY PAGE
    =================================================== */
    async function initCommunityPage() {
        const form = $("postForm");
        if (!form) return;

        const nameEl    = $("communityName");
        const avatarEl  = $("communityAvatar");
        const noticeEl  = $("communityLoginNotice");
        const postsEl   = $("postsList");
        const contentEl = $("postContent");
        const counterEl = $("postCounter");
        const msgEl     = $("postMessage");

        let currentUser = null;

        /* ---------- Load user ---------- */
        try {
            const data = await API.me();
            currentUser = data.user;
        } catch (e) {}

        if (currentUser) {
            form.style.display = "block";
            noticeEl.style.display = "none";
            nameEl.textContent = currentUser.name;
            const initials = currentUser.name.split(/\s+/).slice(0, 2)
                .map(w => w[0].toUpperCase()).join("");
            avatarEl.textContent = initials || "DB";
        } else {
            form.style.display = "none";
            noticeEl.style.display = "block";
            nameEl.textContent = "Guest";
            avatarEl.textContent = "?";
        }

        /* ---------- Character counter ---------- */
        contentEl.addEventListener("input", () => {
            counterEl.textContent = contentEl.value.length;
        });

        /* ---------- Load and render posts ---------- */
        async function loadPosts() {
            try {
                const posts = await API.getPosts();
                renderPosts(posts);
            } catch (e) {
                postsEl.innerHTML =
                    '<p class="empty-bookings">Could not load posts.</p>';
            }
        }

        function formatTime(iso) {
            const d = new Date(iso);
            const diff = Math.floor((Date.now() - d.getTime()) / 1000);
            if (diff < 60) return "just now";
            if (diff < 3600) return Math.floor(diff / 60) + " min ago";
            if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
            return Math.floor(diff / 86400) + " days ago";
        }

        function escapeHtml(s) {
            return String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }

        function renderPosts(posts) {
            if (!posts.length) {
                postsEl.innerHTML =
                    '<p class="empty-bookings">No posts yet. Be the first to share something.</p>';
                return;
            }

            postsEl.innerHTML = posts.map(p => {
                const canDelete = currentUser && currentUser.id === p.user_id;
                const initials = p.author_name.split(/\s+/).slice(0, 2)
                    .map(w => w[0].toUpperCase()).join("");

                return `
                    <article class="post-card">
                        <div class="post-avatar">${escapeHtml(initials)}</div>
                        <div class="post-body">
                            <div class="post-meta">
                                <strong>${escapeHtml(p.author_name)}</strong>
                                <span>${formatTime(p.created_at)}</span>
                            </div>
                            <p class="post-content">${escapeHtml(p.content)}</p>
                        </div>
                        ${canDelete ? `<button class="post-delete" data-id="${p.id}" title="Delete">×</button>` : ""}
                    </article>
                `;
            }).join("");

            postsEl.querySelectorAll(".post-delete").forEach(btn => {
                btn.addEventListener("click", async () => {
                    if (!confirm("Delete this post?")) return;
                    try {
                        await API.deletePost(Number(btn.dataset.id));
                        loadPosts();
                    } catch (e) { alert(e.message); }
                });
            });
        }

        /* ---------- Submit new post ---------- */
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const content = contentEl.value.trim();

            if (content.length < 2) {
                msgEl.style.display = "block";
                msgEl.textContent = "Please enter at least 2 characters.";
                return;
            }

            try {
                await API.createPost(content);
                contentEl.value = "";
                counterEl.textContent = "0";
                msgEl.style.display = "none";
                loadPosts();
            } catch (err) {
                msgEl.style.display = "block";
                msgEl.textContent = err.message;
            }
        });

        /* ---------- Initial load ---------- */
        loadPosts();
    }


    /* ===================================================
       PAGE ROUTER
    =================================================== */
    async function init() {
        await initClassesPage();
        await initMembershipPage();
        await initAccountPage();
        await initCommunityPage();
    }

    init();

})();