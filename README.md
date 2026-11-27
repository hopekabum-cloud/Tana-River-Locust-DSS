# Tana River Desert Locust Risk Decision Support System

Web DSS for relative desert locust risk in the Lower Tana River Basin (Tana River County), Kenya, 2018-2024.
Risk classes show relative environmental suitability, not confirmed locust presence or a forecast.

## Folders
- backend/app.py - Flask app: serves the website and the JSON API
- frontend/ - index.html, css/style.css, js/app.js (Leaflet maps, Chart.js charts)
- data/ - web-ready files made by the Step 4 build cell (map images, arrays, boundary, model info)
- processed_data/statistics/ - risk statistics (pixels, km2, %) and environment means

## Run locally
    pip install -r requirements.txt
    python backend/app.py
Open http://localhost:5000

## Deploy on Render
Push this folder to a GitHub repository, then in Render: New > Blueprint (uses render.yaml)
or New > Web Service with build command `pip install -r requirements.txt` and start command
`gunicorn --chdir backend app:app --workers 2 --timeout 60`.

## API
/api/health, /api/years, /api/meta, /api/boundary, /api/risk/<year>, /api/risk/<year>/<classes|high_very_high|score>.png,
/api/statistics, /api/statistics/<year>, /api/environment, /api/environment/<variable>/<year>.png,
/api/model, /api/importance, /api/climate, /api/climate/map/<file>.png, /api/point?year=&lat=&lng=, /api/download/<year>/<classes|score>
