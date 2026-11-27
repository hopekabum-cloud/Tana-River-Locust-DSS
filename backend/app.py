"""
Tana River Desert Locust Risk Decision Support System - Flask backend.

Serves the website (frontend/) and a JSON API built from the files in data/ and
processed_data/statistics/ (made by the Step 4 build cell in Colab).
Risk classes are RELATIVE environmental suitability, not confirmed locust presence or a forecast.
"""
import json
import os
from pathlib import Path

import numpy as np
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
STATS = BASE / "processed_data" / "statistics"
FRONTEND = BASE / "frontend"

app = Flask(__name__, static_folder=None)
app.json.sort_keys = False      # keep the order written by the build (e.g. rainfall first)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


META = load_json(DATA / "meta.json", {})
YEARS = [int(y) for y in META.get("years", [])]
RISK_STATS = load_json(STATS / "risk_statistics.json", {"by_year": {}})
ENV = load_json(DATA / "environment.json", {"variables": []})
ENV_BY_KEY = {v["key"]: v for v in ENV["variables"]}
ENV_MEANS = load_json(STATS / "environment_means.json", {})
MODEL = load_json(DATA / "model.json", {})
IMPORTANCE = load_json(DATA / "importance.json", {})
CLIMATE = load_json(DATA / "climate" / "climate.json", None)
PROJECTIONS = load_json(DATA / "projections" / "projections.json", None)
GRID = META.get("grid", {})
CLASS_BY_CODE = {c["code"]: c for c in META.get("classes", [])}


def load_array(name):
    """Arrays are stored compressed (.npz) to keep the repository small; loaded once into memory."""
    p = DATA / "arrays" / name
    if not p.exists():
        return None
    with np.load(p) as z:
        return z["a"]


CLS = load_array("risk_classes.npz")
SCORE = load_array("ensemble_score.npz")
ENV_ARR = {k: load_array(f"env_{k}.npz") for k in ENV_BY_KEY}


def year_or_404(year):
    if year not in YEARS:
        return jsonify(error=f"No risk map for {year}.", available_years=YEARS), 404
    return None


# ------------------------------------------------------------------ website
@app.route("/")
def home():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/css/<path:name>")
def css(name):
    return send_from_directory(FRONTEND / "css", name)


@app.route("/js/<path:name>")
def js(name):
    return send_from_directory(FRONTEND / "js", name)


@app.route("/vendor/<path:name>")
def vendor(name):
    return send_from_directory(FRONTEND / "vendor", name, max_age=604800)


# ------------------------------------------------------------------ information
@app.route("/api/health")
def health():
    return jsonify(status="ok" if YEARS else "no_data", years=YEARS, study_area=META.get("study_area"),
                   built=META.get("built"), environment_layers=len(ENV_BY_KEY), climate_outlook=CLIMATE is not None,
                   risk_projections=PROJECTIONS is not None)


@app.route("/api/years")
@app.route("/api/available_years")          # older name, kept so earlier code still works
def years():
    return jsonify(years=YEARS, latest=YEARS[-1] if YEARS else None)


@app.route("/api/meta")
def meta():
    return jsonify(META)


@app.route("/api/boundary")
def boundary():
    p = DATA / "boundaries" / "lower_tana_basin.geojson"
    if not p.exists():
        return jsonify(error="Boundary file missing."), 404
    return send_file(p, mimetype="application/geo+json")


# ------------------------------------------------------------------ risk maps and statistics
@app.route("/api/risk/<int:year>")
def risk_info(year):
    bad = year_or_404(year)
    if bad:
        return bad
    return jsonify(year=year, title=f"Relative desert locust risk, {year}", bounds=META["bounds"],
                   layers={"classes": f"/api/risk/{year}/classes.png",
                           "high_very_high": f"/api/risk/{year}/high_very_high.png",
                           "score": f"/api/risk/{year}/score.png"},
                   statistics=RISK_STATS["by_year"].get(str(year)))


@app.route("/api/risk/<int:year>/<layer>.png")
def risk_png(year, layer):
    if year not in YEARS or layer not in ("classes", "high_very_high", "score"):
        abort(404)
    p = DATA / "risk_maps" / str(year) / f"{layer}.png"
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="image/png", max_age=86400)


@app.route("/api/statistics")
def statistics_all():
    return jsonify(years=YEARS, by_year=RISK_STATS["by_year"])


@app.route("/api/statistics/<int:year>")
def statistics_year(year):
    bad = year_or_404(year)
    if bad:
        return bad
    return jsonify(RISK_STATS["by_year"][str(year)])


@app.route("/api/download/<int:year>/<kind>")
def download(year, kind):
    names = {"classes": f"risk_classes_{year}.tif", "score": f"ensemble_score_{year}.tif"}
    if year not in YEARS or kind not in names or not (DATA / "downloads" / names[kind]).exists():
        abort(404)
    return send_file(DATA / "downloads" / names[kind], as_attachment=True, download_name=names[kind])


# ------------------------------------------------------------------ environmental layers
@app.route("/api/environment")
def environment():
    return jsonify(variables=ENV["variables"], means=ENV_MEANS)


@app.route("/api/environment/<key>/<int:year>.png")
def environment_png(key, year):
    v = ENV_BY_KEY.get(key)
    if v is None or year not in YEARS:
        abort(404)
    p = DATA / "environmental_layers" / key / ("static.png" if v["static"] else f"{year}.png")
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="image/png", max_age=86400)


# ------------------------------------------------------------------ model
@app.route("/api/model")
def model():
    return jsonify(MODEL)


@app.route("/api/importance")
def importance():
    return jsonify(IMPORTANCE)


# ------------------------------------------------------------------ CMIP6 climate outlook
@app.route("/api/climate")
def climate():
    if CLIMATE is None:
        return jsonify(available=False, message="The CMIP6 climate outlook has not been added yet (Step 9)."), 404
    return jsonify(available=True, **CLIMATE)


# ------------------------------------------------------------------ climate-informed risk projections
@app.route("/api/projections")
def projections():
    if PROJECTIONS is None:
        return jsonify(available=False, message="Climate-informed risk projections have not been added yet (Steps 10-12)."), 404
    return jsonify(available=True, **PROJECTIONS)


@app.route("/api/projections/map/<name>")
def projection_map(name):
    if PROJECTIONS is None or not name.endswith(".png") or "/" in name or ".." in name:
        abort(404)
    p = DATA / "projections" / "maps" / name
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="image/png", max_age=86400)


@app.route("/api/climate/map/<name>")
def climate_map(name):
    if CLIMATE is None or not name.endswith(".png") or "/" in name or ".." in name:
        abort(404)
    p = DATA / "climate" / "maps" / name
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="image/png", max_age=86400)


# ------------------------------------------------------------------ point query
@app.route("/api/point")
def point():
    try:
        year = int(request.args["year"])
        lat, lng = float(request.args["lat"]), float(request.args["lng"])
    except (KeyError, ValueError):
        return jsonify(error="year, lat and lng must be numbers."), 400
    bad = year_or_404(year)
    if bad:
        return bad
    col = int(np.floor((lng - GRID["left"]) / GRID["res"]))
    row = int(np.floor((GRID["top"] - lat) / GRID["res"]))
    if not (0 <= row < GRID["height"] and 0 <= col < GRID["width"]) or CLS is None:
        return jsonify(inside=False, message="Outside the study area.")
    i = YEARS.index(year)
    code = int(CLS[i, row, col])
    if code == 0:
        return jsonify(inside=False, message="Outside the basin boundary or no prediction here.")
    env = {}
    for k, arr in ENV_ARR.items():
        if arr is None:
            continue
        v = float(arr[0 if ENV_BY_KEY[k]["static"] else min(i, arr.shape[0] - 1), row, col])
        if np.isfinite(v):
            cats = {c["code"]: c["name"] for c in ENV_BY_KEY[k].get("categories", [])}
            env[k] = cats.get(int(v), round(v, 3)) if cats else round(v, 3)
    score = float(SCORE[i, row, col]) if SCORE is not None else float("nan")
    c = CLASS_BY_CODE[code]
    return jsonify(inside=True, year=year, lat=lat, lng=lng, class_code=code, class_name=c["name"],
                   colour=c["colour"], guidance=c["guidance"],
                   score=round(score, 4) if np.isfinite(score) else None, environment=env)


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify(error="Not found.", path=request.path), 404
    return e


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
