# Corner Café

Online pickup ordering for a small café. Customers order from a phone without an account, follow the order live and pick up the bag from a pickup shelf. Staff work from a shared order board, and the manager sees statistics and edits the menu.

ICT team project, group SE-2624, Astana IT University: Nazymkhan Bexultan, Amangeldi Alikhan, Arsen Suleimen.

**Live site:** https://cornercafese2624.netlify.app/

## What is in this repository

| Folder | What it holds |
| --- | --- |
| `site/` | The website: plain HTML, CSS and JavaScript, no build step |
| `database/` | SQL scripts for the Supabase (PostgreSQL) database, run in order 00 → 10 |
| `analysis/` | Data analysis: SQL queries and the Python script that draws the charts |
| `iot/` | Command-line simulator of the smart pickup shelf |
| `tests/` | Browser tests (Playwright) and exported test results |

## Test accounts

Customers do not need an account. Staff sign in on the **Staff** page.

| Role | E-mail | Password | What the role can do |
| --- | --- | --- | --- |
| Customer | no account | – | Order, follow the order, rate it after pickup |
| Staff | `demo.staff@corner-cafe.test` | `CafeStaff-2624` | Order board, pickup shelf |
| Manager | `demo.manager@corner-cafe.test` | `CafeManager-2624` | Everything staff can do, plus Insights and menu and prices |

These are demo accounts made for checking the project. They work on the live site and in a local copy. Please put back any price or availability you change.

**Demo mode** works without any account or internet connection to the database: open the site and choose “Switch to demo mode” at the bottom of the page. Data is then kept only in your browser.

## Run it locally

1. Download or clone this repository.
2. Start a local web server in the `site` folder:
   - Windows: double-click `start_windows.bat` (needs Python), or
   - any system: `cd site` and then `python -m http.server 8000`
3. Open http://localhost:8000 in the browser.

The local copy uses the same live database as the public site. Without the internet, switch to demo mode in the footer.

## Set up your own database (optional)

1. Create a free project at https://supabase.com.
2. In the SQL Editor run the files in `database/` in order: `00_schema_new_database.sql` to `10_privacy_retention.sql`. File `05` adds generated test orders for the charts; skip it for an empty café.
3. Create staff users in Authentication → Users and link each one to a row of `staff_users` with `03_link_staff_example.sql`.
4. Put your project URL and publishable key in `site/js/config.js`.

## Pickup shelf simulator

The shelf has four weight sensors. When a ready order’s bag is lifted, the order becomes Collected by itself.

- In the browser: Staff → Pickup shelf → “Open the shelf simulator”, or `site/shelf-simulator.html`.
- On the command line: `node iot/shelf-sim.mjs <device key>` (Node.js 18 or newer).

The device key is not stored in this repository, because the repository is public. The database keeps only its SHA-256 hash. Ask the team for the key.

## Pages

| Page | Who uses it |
| --- | --- |
| `index.html` | Customers (menu, cart, order page) and staff (`#staff`) |
| `screen.html` | TV at the counter: order numbers in progress and ready |
| `poster.html` | Printable A4 poster with a scan-to-order QR code |
| `shelf-simulator.html` | Stands in for the shelf’s sensor board |
| `test-lab.html` | Runs our success criteria tests and the security check |

## Run the tests

The tests in `tests/` use Playwright and a local server on port 8766:

```
cd site && python -m http.server 8766
node tests/e2e.js <folder for screenshots>
```

Most tests run in demo mode, so they do not touch the live database.
