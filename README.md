# DoBu Martial Arts — Full-Stack Website

A multipage website for DoBu Martial Arts, built as a coursework project for WebSpace.

## Features

- Marketing pages (Home, About, Martial Arts, Classes, Membership, Fitness, Instructors, Contact)
- User accounts (register, log in, log out — passwords hashed with scrypt)
- Membership management (select/change plan, session limits enforced)
- Class booking (multi-booking, cancel, plan-limited)
- Community forum (member-only posts, create/delete)
- Social media integration (footer links on every page)
- Custom 404 page

## Tech Stack

- **Frontend:** HTML5, CSS3 (no frameworks), vanilla JavaScript
- **Backend:** Node.js built-in modules (`node:http`, `node:sqlite`, `node:crypto`)
- **Database:** SQLite (single file, no server required)
- **Dependencies:** none

## Requirements

- Node.js v22 or newer (uses the experimental `node:sqlite` module)

## Run

```bash
node --experimental-sqlite server/server.js