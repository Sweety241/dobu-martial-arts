/* =========================================================
   DoBu Martial Arts — API Client
========================================================= */

const API = (() => {
        async function request(method, url, body) {
        const opts = {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin"
        };
        if (body) opts.body = JSON.stringify(body);

        let res;
        try {
            res = await fetch(url, opts);
        } catch (networkErr) {
            console.error("[API network error]", method, url, networkErr);
            throw new Error("Cannot reach server at " + url + " — is the server running?");
        }

        let data = {};
        try {
            data = await res.json();
        } catch (parseErr) {
            console.error("[API JSON error]", method, url, res.status, parseErr);
            throw new Error("Server returned invalid response (HTTP " + res.status + ") from " + url);
        }

        if (!res.ok) {
            const serverMsg = data.error || "Unknown error";
            console.error("[API " + res.status + "]", method, url, serverMsg);
            throw new Error(serverMsg + " (HTTP " + res.status + " at " + url + ")");
        }
        return data;
    }

    return {
        register: (name, email, password) =>
            request("POST", "/api/auth/register", { name, email, password }),
        login: (email, password) =>
            request("POST", "/api/auth/login", { email, password }),
        logout: () => request("POST", "/api/auth/logout"),
        me: () => request("GET", "/api/auth/me"),

        getPlans: () => request("GET", "/api/plans"),
        selectPlan: (plan_slug) => request("PUT", "/api/plans/me", { plan_slug }),

        getClasses: () => request("GET", "/api/classes"),

        getBookings: () => request("GET", "/api/bookings"),
        book: (class_id) => request("POST", "/api/bookings", { class_id }),
        cancelBooking: (id) => request("DELETE", `/api/bookings/${id}`),

                updateProfile: (name, email) =>
            request("PUT", "/api/users/me", { name, email }),

        getPosts: () => request("GET", "/api/posts"),
        createPost: (content) => request("POST", "/api/posts", { content }),
        deletePost: (id) => request("DELETE", `/api/posts/${id}`)
    };
})();