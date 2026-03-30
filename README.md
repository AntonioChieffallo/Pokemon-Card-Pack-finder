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

## Run (standard)

Fastest one-liner to run the site:

```powershell
npm run site
```

Then open:

`http://localhost:3000`

If this is your first time, install dependencies first:

```powershell
npm install
```

Optional verification before starting:

```powershell
npm test
```

## Run (dynamic dev mode)

For automatic server restart and browser reload when files change:

```powershell
npm run dev
```

Open:

`http://localhost:3001`

Notes:
- Changes in `public/` reload automatically in the browser.
- Changes in `server.js` trigger server restart automatically.

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
