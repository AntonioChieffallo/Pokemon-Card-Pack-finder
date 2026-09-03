# Pokemon-Card-Pack-finder
This is to scrape the internet to see good prices, where to look, and click a link straight to the good stuff, if it is cards, packs, or boxes!

## Requirements

- Node.js LTS (includes npm)
	- Download: https://nodejs.org/
	- Or install with winget: `winget install OpenJS.NodeJS.LTS`
- Windows PowerShell (for the commands below)

Optional:
- Pokemon TCG API key for higher rate limits
	- Set in terminal before start: `$env:POKEMON_TCG_API_KEY="your_api_key_here"`

## Email Restock Alerts

The server now supports email alerts when watched items come back online for sale.

Set these environment variables before start:

- `SMTP_HOST` (for example `smtp.gmail.com`)
- `SMTP_PORT` (for example `587`)
- `SMTP_USER`
- `SMTP_PASS`
- Optional: `SMTP_SECURE=true` (usually `true` for 465, otherwise `false`)
- Optional: `ALERT_FROM_EMAIL` (defaults to `SMTP_USER`)
- Optional: `ALERT_CHECK_INTERVAL_MIN` (default `15`)
- Optional: `ALERT_EBAY_DEAL_RATIO` (default `0.75`)

Alert APIs:

- `POST /api/alerts/subscribe`
	- Body:
	```json
	{
	  "email": "you@example.com",
	  "itemName": "Charizard",
	  "itemType": "cards",
	  "includeEbay": true,
	  "ebayDealRatio": 0.75
	}
	```
- `GET /api/alerts/subscriptions?email=you@example.com`
- `DELETE /api/alerts/subscriptions/:id`
- `POST /api/alerts/check-now`

eBay behavior:

- eBay is only included in alerts when the found price is a strong deal relative to the configured ratio.

## Run (development)

Svelte frontend + Express API together:

```powershell
npm run dev
```

Open:

- Frontend (Svelte): http://localhost:5173
- API server (Express): http://localhost:3000

## Run (production style)

Build frontend and run Express serving `dist/`:

```powershell
npm start
```

`npm start` installs dependencies only when they are missing, builds the frontend, and starts the server.

Then open:

- http://localhost:3000

## Legacy direct server run

Fastest one-liner to run the site:

```powershell
npm run site
```

If no frontend build exists yet, run `npm run build` first.

If this is your first time, install dependencies first:

```powershell
npm install
```

Optional verification before starting:

```powershell
npm test
```

## Run (PowerShell + venv-safe)

If `node`/`npm` are not recognized in your current terminal (common after PATH changes or old terminal tabs), run:

```powershell
. $PROFILE
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (Test-Path .\.venv\Scripts\Activate.ps1) { . .\.venv\Scripts\Activate.ps1 }
npm install
npm test
npm start
```

## One-line command

Use this one-liner from the project root to refresh PATH, activate `.venv` if present, install deps, test, and start:

```powershell
. $PROFILE; $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); if (Test-Path .\.venv\Scripts\Activate.ps1) { . .\.venv\Scripts\Activate.ps1 }; npm install; npm test; npm start
```
